# Phase 6: Download Pipeline & Queue — Detailed Spec

> **Goal**: The agent receives download commands, runs the full Real-Debrid pipeline, downloads files, organizes them into Plex-compatible structure, and reports progress. When a device is offline, downloads queue in the relay and get delivered automatically on reconnect.

---

## Table of Contents

1. [Overview](#overview)
2. [Relay: Download Queue Service](#relay-download-queue-service)
3. [Agent: Real-Debrid Client](#agent-real-debrid-client)
4. [Agent: Download Handler](#agent-download-handler)
5. [Agent: File Download Service](#agent-file-download-service)
6. [Agent: Media Organizer](#agent-media-organizer)
7. [Download Pipeline Phases](#download-pipeline-phases)
8. [Progress Event Streaming](#progress-event-streaming)
9. [Error Handling & RD Key Rotation](#error-handling--rd-key-rotation)
10. [Testing Strategy](#testing-strategy)
11. [Implementation Order & Verification](#implementation-order--verification)
12. [Common Pitfalls](#common-pitfalls)

---

## Overview

### Components Involved

- **Relay**: `download_queue` table + delivery logic on `agent:hello`
- **Agent**: RD client, download handler, file downloader, media organizer
- **Shared**: Message types, validation schemas, utility functions

### Key Decisions

> **✅ RESOLVED**: Use `got@~14.0.0` for all agent HTTP operations. Battle-tested streaming, retry logic, and timeout handling built-in. Saves significant code compared to manual fetch implementation.

---

## Relay: Download Queue Service

### Database Schema

The `download_queue` table already exists in the Drizzle schema (see ARCHITECTURE.md lines 240–247):

```typescript
// packages/shared/src/schema.ts (pseudo-code for Drizzle)
export const downloadQueue = pgTable('download_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').references(() => profiles.id),
  deviceId: uuid('device_id').references(() => devices.id),
  payload: jsonb('payload'), // Full download:request payload
  status: text('status'), // "queued" | "delivered" | "cancelled" | "expired"
  createdAt: timestamp('created_at').defaultNow(),
  deliveredAt: timestamp('delivered_at'),
});
```

### Service Logic (in `packages/relay/src`)

#### 1. **Queue a Download When Agent is Offline**

Endpoint: `POST /api/download` (called by relay's WebSocket handler when `download:request` arrives for offline device)

```typescript
// packages/relay/src/services/downloadQueue.ts
export async function queueDownload(
  db: Database,
  profileId: string,
  deviceId: string,
  payload: DownloadRequest['payload']
): Promise<string> {
  const queueId = crypto.randomUUID();

  await db.insert(downloadQueue).values({
    id: queueId,
    profileId,
    deviceId,
    payload,
    status: 'queued',
    createdAt: new Date(),
  });

  return queueId;
}
```

When the relay receives `download:request` from the web app via WebSocket:

1. Check if target device is online (in relay's agent connection pool)
2. **If online**: forward to agent as normal
3. **If offline**:
   - Call `queueDownload()` to insert into `download_queue` table
   - Respond to web app with `download:queued` message:
     ```typescript
     {
       type: "download:queued",
       payload: {
         queueId: string,
         requestId: string,
         title: string,
         deviceName: string
       }
     }
     ```

#### 2. **Deliver Queued Downloads on Agent Reconnect**

Trigger: Agent sends `agent:hello` message after WebSocket connection established.

In the relay's WebSocket message handler:

```typescript
// packages/relay/src/handlers/agentHello.ts
export async function handleAgentHello(
  db: Database,
  ws: WebSocket,
  agentId: { profileId: string; deviceId: string },
  msg: AgentHello
): Promise<void> {
  // Register agent in connection pool (existing logic)
  registerAgent(agentId, ws);

  // NEW: Fetch queued downloads for this profile + device
  const queuedDownloads = await db
    .select()
    .from(downloadQueue)
    .where(
      and(
        eq(downloadQueue.profileId, agentId.profileId),
        eq(downloadQueue.deviceId, agentId.deviceId),
        eq(downloadQueue.status, 'queued')
      )
    );

  // Send each queued download as a normal download:request
  for (const queueEntry of queuedDownloads) {
    const downloadMsg: WsMessage = {
      id: ulid(),
      type: 'download:request',
      timestamp: Date.now(),
      payload: queueEntry.payload,
    };

    // Send to agent
    ws.send(JSON.stringify(downloadMsg));

    // Mark as delivered
    await db
      .update(downloadQueue)
      .set({
        status: 'delivered',
        deliveredAt: new Date(),
      })
      .where(eq(downloadQueue.id, queueEntry.id));

    // Notify web app that queue item is now active
    broadcastToProfile(agentId.profileId, {
      type: 'download:queued-activated',
      payload: {
        queueId: queueEntry.id,
        jobId: downloadMsg.id, // Agent will use this when it accepts
      },
    });
  }
}
```

#### 3. **Cancellation from Web UI**

Endpoint: `DELETE /api/queue/:queueId`

```typescript
export async function cancelQueuedDownload(
  db: Database,
  queueId: string
): Promise<void> {
  await db
    .update(downloadQueue)
    .set({ status: 'cancelled' })
    .where(eq(downloadQueue.id, queueId));
}
```

#### 4. **Queue Expiration (14 Days)**

Run as a periodic background job (e.g., cron task run every hour):

```typescript
export async function expireOldQueuedDownloads(
  db: Database,
  maxAgeMs: number = 14 * 24 * 60 * 60 * 1000
): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMs);

  await db
    .update(downloadQueue)
    .set({ status: 'expired' })
    .where(
      and(
        eq(downloadQueue.status, 'queued'),
        lt(downloadQueue.createdAt, cutoff)
      )
    );
}
```

Run this on relay startup or via a background task.

---

## Agent: Real-Debrid Client

Location: `packages/agent/src/services/realDebridClient.ts`

### Overview

A complete TypeScript class that handles all Real-Debrid API interactions. The agent receives the RD API key during pairing and stores it in local config. If a 401/403 error occurs, the agent auto-rotates the key via the relay.

### Base Configuration

```typescript
const RD_BASE_URL = 'https://api.real-debrid.com/rest/1.0';
const RD_DEFAULT_POLL_INTERVAL = 30; // seconds
const RD_DEFAULT_POLL_TIMEOUT = 30 * 60; // 30 minutes in seconds
```

### Class Definition

```typescript
// packages/agent/src/services/realDebridClient.ts

import { ulid } from 'ulid';

export interface RDTorrentInfo {
  id: string;
  hash: string;
  name: string;
  status: string; // "magnet_error", "magnet_downloading", "waiting_files_selection",
                  // "queued", "downloading", "downloaded", "error", "virus", "dead"
  progress: number; // 0-100
  files: Array<{ id: string; name: string; size: number; selected: boolean }>;
  links: string[]; // Unrestricted download links (available when status = "downloaded")
  seeders: number;
  ratio: number;
  uploadSpeed: number;
  downloadSpeed: number;
}

export interface RDUnrestrictedLink {
  url: string;
  size: number;
}

export class RealDebridClient {
  private baseUrl = RD_BASE_URL;
  private apiKey: string;
  private httpClient: typeof fetch; // or `got` if using that
  private logger: Logger;
  private config: AgentConfig; // To rotate RD key if needed

  constructor(
    apiKey: string,
    httpClient?: typeof fetch,
    logger?: Logger,
    config?: AgentConfig
  ) {
    this.apiKey = apiKey;
    this.httpClient = httpClient || fetch;
    this.logger = logger || console;
    this.config = config;
  }

  /**
   * Make an authenticated HTTP request to Real-Debrid API.
   * Handles retries on 401/403 (key rotation).
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>,
    retryOnAuthError: boolean = true
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    try {
      const response = await this.httpClient(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (response.status === 401 || response.status === 403) {
        if (retryOnAuthError && this.config) {
          this.logger.warn(
            `RD API returned ${response.status}. Rotating API key...`
          );

          // Fetch fresh key from relay
          const freshKey = await this.rotateApiKey();
          this.apiKey = freshKey;

          // Retry the request
          return this.request<T>(method, endpoint, body, false);
        }
        throw new RDAuthError(
          `RD API returned ${response.status}. Key may be invalid.`
        );
      }

      if (!response.ok) {
        const text = await response.text();
        throw new RDError(
          `RD API ${response.status}: ${text}`,
          response.status
        );
      }

      if (response.status === 204) {
        // No content
        return undefined as T;
      }

      return response.json() as Promise<T>;
    } catch (err) {
      if (err instanceof RDAuthError || err instanceof RDError) {
        throw err;
      }
      throw new RDError(`RD API request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Fetch fresh API key from relay's GET /api/agent/config endpoint.
   */
  private async rotateApiKey(): Promise<string> {
    const relayUrl = this.config?.relay;
    const deviceToken = this.config?.deviceToken;

    if (!relayUrl || !deviceToken) {
      throw new Error('Cannot rotate RD key: missing relay config');
    }

    try {
      const response = await fetch(`${relayUrl}/api/agent/config`, {
        headers: { Authorization: `Bearer ${deviceToken}` },
      });

      if (!response.ok) {
        throw new Error(`Relay returned ${response.status}`);
      }

      const data = (await response.json()) as { realDebrid: { apiKey: string } };
      return data.realDebrid.apiKey;
    } catch (err) {
      throw new Error(
        `Failed to rotate RD key: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Add a magnet link and return the torrent ID.
   * POST /torrents/addMagnet
   */
  async addMagnet(magnetLink: string): Promise<string> {
    const data = await this.request<{ id: string }>(
      'POST',
      '/torrents/addMagnet',
      { magnet: magnetLink }
    );
    return data.id;
  }

  /**
   * Select files to download from a torrent.
   * POST /torrents/selectFiles/{id}
   * If fileIds is undefined, selects all files.
   */
  async selectFiles(
    torrentId: string,
    fileIds?: string[]
  ): Promise<void> {
    const body = fileIds && fileIds.length > 0
      ? { files: fileIds.join(',') }
      : { files: 'all' };

    await this.request<void>(
      'POST',
      `/torrents/selectFiles/${torrentId}`,
      body
    );
  }

  /**
   * Poll torrent info until status is "downloaded".
   * GET /torrents/info/{id}
   */
  async pollUntilReady(
    torrentId: string,
    pollInterval: number = RD_DEFAULT_POLL_INTERVAL,
    timeoutSeconds: number = RD_DEFAULT_POLL_TIMEOUT
  ): Promise<string[]> {
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (true) {
      const info = await this.request<RDTorrentInfo>(
        'GET',
        `/torrents/info/${torrentId}`
      );

      // Error states
      if (
        info.status === 'error' ||
        info.status === 'virus' ||
        info.status === 'dead' ||
        info.status === 'magnet_error'
      ) {
        throw new RDTorrentError(
          `Torrent status: ${info.status}`,
          info.status
        );
      }

      // Success state
      if (info.status === 'downloaded') {
        return info.links || [];
      }

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        throw new RDTimeoutError(
          `Poll timeout after ${timeoutSeconds}s. Status: ${info.status}`
        );
      }

      // Wait before next poll
      await this.sleep(pollInterval * 1000);
    }
  }

  /**
   * Unrestrict a single link to get the download URL.
   * POST /unrestrict/link
   */
  async unrestrictLink(link: string): Promise<RDUnrestrictedLink> {
    const data = await this.request<RDUnrestrictedLink>(
      'POST',
      '/unrestrict/link',
      { link }
    );
    return data;
  }

  /**
   * Unrestrict multiple links sequentially.
   */
  async unrestrictAll(links: string[]): Promise<RDUnrestrictedLink[]> {
    const results: RDUnrestrictedLink[] = [];

    for (const link of links) {
      try {
        const result = await this.unrestrictLink(link);
        results.push(result);
      } catch (err) {
        this.logger.warn(`Failed to unrestrict ${link}:`, err);
        // Continue with other links
      }
    }

    return results;
  }

  /**
   * Check if torrents are cached on Real-Debrid.
   * GET /torrents/instantAvailability/{hashes}
   */
  async checkCache(
    infoHashes: string[]
  ): Promise<Record<string, boolean>> {
    const hashString = infoHashes.join('/');
    const data = await this.request<Record<string, unknown>>(
      'GET',
      `/torrents/instantAvailability/${hashString}`
    );

    const result: Record<string, boolean> = {};
    for (const [hash, value] of Object.entries(data)) {
      // RD returns an object if cached, empty object if not
      result[hash] = typeof value === 'object' && value !== null && Object.keys(value as any).length > 0;
    }
    return result;
  }

  /**
   * Full pipeline: add magnet → select files → poll until ready → unrestrict.
   * Convenience method for the download handler.
   */
  async downloadMagnet(
    magnetLink: string,
    pollInterval?: number,
    timeoutSeconds?: number
  ): Promise<RDUnrestrictedLink[]> {
    this.logger.log('Adding magnet...');
    const torrentId = await this.addMagnet(magnetLink);
    this.logger.log(`Torrent created: ${torrentId}`);

    this.logger.log('Selecting all files...');
    await this.selectFiles(torrentId);

    this.logger.log('Polling until ready...');
    const links = await this.pollUntilReady(
      torrentId,
      pollInterval,
      timeoutSeconds
    );
    this.logger.log(`Downloaded. Got ${links.length} links.`);

    this.logger.log('Unrestricting links...');
    const unrestricted = await this.unrestrictAll(links);

    return unrestricted;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Custom error classes
export class RDError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'RDError';
  }
}

export class RDAuthError extends RDError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'RDAuthError';
  }
}

export class RDTorrentError extends RDError {
  constructor(message: string, public torrentStatus: string) {
    super(message);
    this.name = 'RDTorrentError';
  }
}

export class RDTimeoutError extends RDError {
  constructor(message: string) {
    super(message);
    this.name = 'RDTimeoutError';
  }
}
```

### Error Handling

| Error | Cause | Agent Action |
|-------|-------|--------------|
| `RDAuthError` (401/403) | RD key invalid or rotated | Fetch new key from relay via `GET /api/agent/config`, retry request |
| `RDTorrentError` (error/virus/dead/magnet_error) | Content unavailable or dangerous | Send `download:failed` with `retryable: false` |
| `RDTimeoutError` | Poll exceeded 30 minutes | Send `download:failed` with `retryable: true` |
| Network error | Connection timeout | Send `download:failed` with `retryable: true` |

---

## Agent: Download Handler

Location: `packages/agent/src/handlers/downloadHandler.ts`

### Overview

The download handler:
1. Validates incoming `download:request` messages
2. Generates a ULID job ID
3. Checks concurrent download limit (semaphore)
4. Executes the download pipeline in phases
5. Reports progress and results via WebSocket

### Job Queue & Semaphore

```typescript
// packages/agent/src/queue/downloadQueue.ts

import { Semaphore } from 'async-lock';

export interface DownloadJob {
  jobId: string;
  requestId: string;
  payload: DownloadRequest['payload'];
  status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
  phase: 'adding' | 'waiting' | 'unrestricting' | 'downloading' | 'organizing';
  error?: string;
  retryable?: boolean;
  abortController?: AbortController;
}

export class DownloadQueue {
  private jobs = new Map<string, DownloadJob>();
  private semaphore: Semaphore;
  private maxConcurrent: number;

  constructor(maxConcurrentDownloads: number = 2) {
    this.maxConcurrent = maxConcurrentDownloads;
    this.semaphore = new Semaphore(maxConcurrentDownloads);
  }

  /**
   * Add a new job to the queue.
   */
  addJob(
    payload: DownloadRequest['payload'],
    requestId: string
  ): DownloadJob {
    const jobId = ulid();
    const job: DownloadJob = {
      jobId,
      requestId,
      payload,
      status: 'pending',
      phase: 'adding',
      abortController: new AbortController(),
    };
    this.jobs.set(jobId, job);
    return job;
  }

  /**
   * Check if queue is full (all semaphore slots taken).
   */
  isFull(): boolean {
    return this.semaphore.getCount() === 0;
  }

  /**
   * Acquire semaphore slot and return release function.
   */
  async acquireSlot(): Promise<() => void> {
    let released = false;
    await this.semaphore.acquire();
    return () => {
      if (!released) {
        this.semaphore.release();
        released = true;
      }
    };
  }

  /**
   * Get job by ID.
   */
  getJob(jobId: string): DownloadJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Update job status/phase.
   */
  updateJob(
    jobId: string,
    updates: Partial<DownloadJob>
  ): void {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
    }
  }

  /**
   * Remove job from queue (cleanup after completion).
   */
  removeJob(jobId: string): void {
    this.jobs.delete(jobId);
  }

  /**
   * Get all active jobs (for TUI).
   */
  getActiveJobs(): DownloadJob[] {
    return Array.from(this.jobs.values()).filter(
      (job) => job.status === 'active'
    );
  }

  /**
   * Cancel a job by ID.
   */
  cancelJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && job.abortController) {
      job.abortController.abort();
      job.status = 'cancelled';
    }
  }
}
```

### Download Handler

```typescript
// packages/agent/src/handlers/downloadHandler.ts

import { DownloadRequest } from '@tadaima/shared';
import { z } from 'zod';

const DownloadRequestSchema = z.object({
  tmdbId: z.number(),
  imdbId: z.string(),
  title: z.string(),
  year: z.number(),
  mediaType: z.enum(['movie', 'tv']),
  season: z.number().optional(),
  episode: z.number().optional(),
  episodeTitle: z.string().optional(),
  magnet: z.string(),
  torrentName: z.string(),
  expectedSize: z.number(),
});

export class DownloadHandler {
  private queue: DownloadQueue;
  private rdClient: RealDebridClient;
  private fileDownloader: FileDownloadService;
  private mediaOrganizer: MediaOrganizer;
  private ws: WebSocket;
  private logger: Logger;

  constructor(
    queue: DownloadQueue,
    rdClient: RealDebridClient,
    fileDownloader: FileDownloadService,
    mediaOrganizer: MediaOrganizer,
    ws: WebSocket,
    logger?: Logger
  ) {
    this.queue = queue;
    this.rdClient = rdClient;
    this.fileDownloader = fileDownloader;
    this.mediaOrganizer = mediaOrganizer;
    this.ws = ws;
    this.logger = logger || console;
  }

  /**
   * Handle download:request message.
   */
  async handle(msg: WsMessage & { type: 'download:request' }): Promise<void> {
    const requestId = msg.id;

    // Validate payload
    let payload: typeof DownloadRequestSchema._type;
    try {
      payload = DownloadRequestSchema.parse(msg.payload);
    } catch (err) {
      this.sendDownloadFailed(
        'unknown',
        requestId,
        `Invalid request payload: ${err instanceof Error ? err.message : String(err)}`,
        'adding',
        false
      );
      return;
    }

    // Check queue capacity
    if (this.queue.isFull()) {
      this.sendDownloadRejected(requestId, 'queue_full');
      return;
    }

    // Create job
    const job = this.queue.addJob(payload, requestId);

    // Send acceptance
    this.sendDownloadAccepted(job.jobId, requestId);

    // Execute pipeline (fire-and-forget, with cleanup)
    this.executePipeline(job).catch((err) => {
      this.logger.error(`Pipeline error for job ${job.jobId}:`, err);
    });
  }

  /**
   * Execute the download pipeline.
   */
  private async executePipeline(job: DownloadJob): Promise<void> {
    const releaseSlot = await this.queue.acquireSlot();

    try {
      this.queue.updateJob(job.jobId, {
        status: 'active',
        phase: 'adding',
      });

      // Phase 1: Add magnet
      this.sendProgress(job.jobId, 'adding', 0);
      let torrentId: string;
      try {
        torrentId = await this.rdClient.addMagnet(job.payload.magnet);
      } catch (err) {
        throw {
          phase: 'adding',
          retryable: !(err instanceof RDTorrentError),
          message: err instanceof Error ? err.message : String(err),
        };
      }

      // Phase 2: Wait for download
      this.queue.updateJob(job.jobId, { phase: 'waiting' });
      this.sendProgress(job.jobId, 'waiting', 0);
      let links: string[];
      try {
        links = await this.rdClient.pollUntilReady(
          torrentId,
          this.queue.rdPollInterval,
          this.queue.rdPollTimeout
        );
      } catch (err) {
        throw {
          phase: 'waiting',
          retryable: !(err instanceof RDTorrentError),
          message: err instanceof Error ? err.message : String(err),
        };
      }

      // Phase 3: Unrestrict links
      this.queue.updateJob(job.jobId, { phase: 'unrestricting' });
      this.sendProgress(job.jobId, 'unrestricting', 0);
      let unrestrictedLinks: RDUnrestrictedLink[];
      try {
        unrestrictedLinks = await this.rdClient.unrestrictAll(links);
      } catch (err) {
        throw {
          phase: 'unrestricting',
          retryable: true,
          message: err instanceof Error ? err.message : String(err),
        };
      }

      if (unrestrictedLinks.length === 0) {
        throw {
          phase: 'unrestricting',
          retryable: false,
          message: 'No links were unrestricted',
        };
      }

      // Phase 4: Download files
      this.queue.updateJob(job.jobId, { phase: 'downloading' });
      this.sendProgress(job.jobId, 'downloading', 0);

      const stagingDir = path.join(
        this.queue.stagingDir,
        job.jobId
      );
      await fs.mkdir(stagingDir, { recursive: true });

      const downloadedFiles: Array<{ path: string; size: number }> = [];

      for (let i = 0; i < unrestrictedLinks.length; i++) {
        const link = unrestrictedLinks[i];
        const fileName = `file_${i}${path.extname(link.url) || '.bin'}`;
        const filePath = path.join(stagingDir, fileName);

        const onProgress = (progress: {
          downloadedBytes: number;
          totalBytes: number;
          speedBps: number;
          eta: number;
        }) => {
          const overallProgress = (i * 100 + (progress.downloadedBytes / progress.totalBytes) * 100) / unrestrictedLinks.length;
          this.sendProgress(
            job.jobId,
            'downloading',
            overallProgress,
            progress
          );
        };

        try {
          await this.fileDownloader.download(
            link.url,
            filePath,
            onProgress,
            job.abortController
          );
          downloadedFiles.push({ path: filePath, size: link.size });
        } catch (err) {
          if (job.abortController?.signal.aborted) {
            throw { phase: 'downloading', retryable: true, message: 'Cancelled' };
          }
          throw {
            phase: 'downloading',
            retryable: true,
            message: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // Phase 5: Organize
      this.queue.updateJob(job.jobId, { phase: 'organizing' });
      this.sendProgress(job.jobId, 'organizing', 0);

      let finalPath: string;
      let finalSize: number = 0;
      try {
        ({ path: finalPath, size: finalSize } =
          await this.mediaOrganizer.organize(
            downloadedFiles,
            job.payload
          ));
      } catch (err) {
        throw {
          phase: 'organizing',
          retryable: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }

      // Success!
      this.queue.updateJob(job.jobId, { status: 'completed' });
      this.sendDownloadCompleted(job.jobId, finalPath, finalSize);

      // Cleanup staging directory
      await fs.rm(stagingDir, { recursive: true, force: true });
    } catch (err: any) {
      const phase = err.phase || 'unknown';
      const retryable = err.retryable ?? true;
      const message = err.message || String(err);

      this.queue.updateJob(job.jobId, {
        status: 'failed',
        error: message,
        retryable,
      });
      this.sendDownloadFailed(job.jobId, message, phase, retryable);

      // Cleanup staging directory
      try {
        const stagingDir = path.join(this.queue.stagingDir, job.jobId);
        await fs.rm(stagingDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        this.logger.warn('Failed to cleanup staging dir:', cleanupErr);
      }
    } finally {
      releaseSlot();
      // Keep job in queue for a bit so TUI can show completed status
      setTimeout(() => {
        this.queue.removeJob(job.jobId);
      }, 5000);
    }
  }

  // Message senders
  private sendDownloadAccepted(jobId: string, requestId: string): void {
    this.ws.send(
      JSON.stringify({
        id: ulid(),
        type: 'download:accepted',
        timestamp: Date.now(),
        payload: { jobId, requestId },
      })
    );
  }

  private sendDownloadRejected(requestId: string, reason: string): void {
    this.ws.send(
      JSON.stringify({
        id: ulid(),
        type: 'download:rejected',
        timestamp: Date.now(),
        payload: { requestId, reason },
      })
    );
  }

  private sendProgress(
    jobId: string,
    phase: string,
    progress: number,
    details?: { downloadedBytes: number; totalBytes: number; speedBps: number; eta: number }
  ): void {
    this.ws.send(
      JSON.stringify({
        id: ulid(),
        type: 'download:progress',
        timestamp: Date.now(),
        payload: {
          jobId,
          phase,
          progress,
          ...details,
        },
      })
    );
  }

  private sendDownloadCompleted(
    jobId: string,
    filePath: string,
    finalSize: number
  ): void {
    this.ws.send(
      JSON.stringify({
        id: ulid(),
        type: 'download:completed',
        timestamp: Date.now(),
        payload: { jobId, filePath, finalSize },
      })
    );
  }

  private sendDownloadFailed(
    jobId: string,
    error: string,
    phase: string,
    retryable: boolean
  ): void {
    this.ws.send(
      JSON.stringify({
        id: ulid(),
        type: 'download:failed',
        timestamp: Date.now(),
        payload: { jobId, error, phase, retryable },
      })
    );
  }
}
```

---

## Agent: File Download Service

Location: `packages/agent/src/services/fileDownloadService.ts`

### Overview

Handles HTTP downloads with streaming, progress reporting, cancellation, and chunked writing.

> **✅ RESOLVED**: Use `got` for production reliability. Add to `packages/agent/package.json`:
> ```json
> "dependencies": {
>   "got": "~14.0.0"
> }
> ```

### Implementation with `got`

```typescript
import got from 'got';
import * as fs from 'fs';

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  eta: number; // seconds
}

export class FileDownloadService {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || console;
  }

  /**
   * Download a file from URL with progress reporting.
   * 64KB chunks, throttled progress events (1/second).
   */
  async download(
    url: string,
    destinationPath: string,
    onProgress?: (progress: DownloadProgress) => void,
    abortController?: AbortController
  ): Promise<void> {
    const startTime = Date.now();
    let downloadedBytes = 0;
    let totalBytes = 0;
    let lastProgressTime = startTime;

    try {
      const stream = got.stream(url);

      // Capture Content-Length header
      stream.on('response', (response) => {
        totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      });

      // Handle abort signal
      if (abortController) {
        abortController.signal.addEventListener('abort', () => {
          stream.destroy();
        });
      }

      // Track progress
      stream.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;

        // Throttle progress reporting to ~1/second
        const now = Date.now();
        if (onProgress && now - lastProgressTime >= 1000) {
          const elapsedSeconds = (now - startTime) / 1000;
          const speedBps = elapsedSeconds > 0 ? downloadedBytes / elapsedSeconds : 0;
          const remainingBytes = totalBytes - downloadedBytes;
          const eta = speedBps > 0 ? remainingBytes / speedBps : 0;

          onProgress({
            downloadedBytes,
            totalBytes,
            speedBps,
            eta,
          });

          lastProgressTime = now;
        }
      });

      // Handle stream errors
      stream.on('error', (err) => {
        throw new Error(`Download failed: ${err.message}`);
      });

      // Write to file
      const writeStream = fs.createWriteStream(destinationPath, {
        highWaterMark: 64 * 1024, // 64KB chunks
      });

      return new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        stream.pipe(writeStream);
      });
    } catch (err) {
      // Cleanup partial file
      try {
        await fs.promises.unlink(destinationPath);
      } catch {
        // Ignore
      }
      throw err;
    }
  }
}
```

### Alternative: Native `fetch`

If avoiding the `got` dependency:

```typescript
async download(
  url: string,
  destinationPath: string,
  onProgress?: (progress: DownloadProgress) => void,
  abortController?: AbortController
): Promise<void> {
  const startTime = Date.now();
  let downloadedBytes = 0;
  let totalBytes = 0;
  let lastProgressTime = startTime;

  try {
    const response = await fetch(url, {
      signal: abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    totalBytes = parseInt(response.headers.get('content-length') || '0', 10);

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const writeStream = fs.createWriteStream(destinationPath, {
      highWaterMark: 64 * 1024,
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        downloadedBytes += value.length;

        // Throttle progress
        const now = Date.now();
        if (onProgress && now - lastProgressTime >= 1000) {
          const elapsedSeconds = (now - startTime) / 1000;
          const speedBps = elapsedSeconds > 0 ? downloadedBytes / elapsedSeconds : 0;
          const remainingBytes = totalBytes - downloadedBytes;
          const eta = speedBps > 0 ? remainingBytes / speedBps : 0;

          onProgress({
            downloadedBytes,
            totalBytes,
            speedBps,
            eta,
          });
          lastProgressTime = now;
        }

        writeStream.write(value);
      }

      return new Promise((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on('error', reject);
      });
    } catch (err) {
      reader.cancel();
      throw err;
    }
  } catch (err) {
    try {
      await fs.promises.unlink(destinationPath);
    } catch {
      // Ignore
    }
    throw err;
  }
}
```

---

## Agent: Media Organizer

Location: `packages/agent/src/services/mediaOrganizer.ts`

### Overview

Takes downloaded files and organizes them into a Plex-compatible directory structure.

### Utility Functions (in `packages/shared`)

These should be shared utilities available to both agent and relay:

```typescript
// packages/shared/src/utils/mediaPath.ts

/**
 * Sanitize a string for use in filesystem paths.
 * - Remove illegal characters: < > " / \ | ? *
 * - Replace colons with " - "
 * - Collapse multiple spaces to single space
 * - Strip leading/trailing dots, spaces, dashes
 */
export function sanitize(name: string): string {
  // Remove illegal characters
  let sanitized = name.replace(/[<>"\/\\|?*]/g, '');

  // Replace colons with " - "
  sanitized = sanitized.replace(/:/g, ' - ');

  // Collapse multiple spaces
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Strip leading/trailing dots, spaces, dashes
  sanitized = sanitized.replace(/^[\s\.\-]+|[\s\.\-]+$/g, '');

  return sanitized;
}

/**
 * Build a Plex-compatible movie path.
 * Format: {moviesDir}/{Title} ({Year}) [tmdb-{tmdbId}]/{Title} ({Year}).{ext}
 */
export function buildMoviePath(
  moviesDir: string,
  title: string,
  year: number,
  tmdbId: number,
  extension: string
): string {
  const sanitizedTitle = sanitize(title);
  const dirName = `${sanitizedTitle} (${year}) [tmdb-${tmdbId}]`;
  const fileName = `${sanitizedTitle} (${year}).${extension}`;
  return path.join(moviesDir, dirName, fileName);
}

/**
 * Build a Plex-compatible episode path.
 * Format: {tvDir}/{Title} [tmdb-{tmdbId}]/Season {NN}/S{NN}E{NN} - {Episode Title}.{ext}
 */
export function buildEpisodePath(
  tvDir: string,
  title: string,
  tmdbId: number,
  season: number,
  episode: number,
  episodeTitle: string | undefined,
  extension: string
): string {
  const sanitizedTitle = sanitize(title);
  const seriesDirName = `${sanitizedTitle} [tmdb-${tmdbId}]`;
  const seasonDirName = `Season ${String(season).padStart(2, '0')}`;

  const episodeNum = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
  const episodePartName = episodeTitle ? ` - ${sanitize(episodeTitle)}` : '';
  const fileName = `${episodeNum}${episodePartName}.${extension}`;

  return path.join(tvDir, seriesDirName, seasonDirName, fileName);
}
```

### Media Organizer Class

```typescript
// packages/agent/src/services/mediaOrganizer.ts

import * as path from 'path';
import * as fs from 'fs';
import { sanitize, buildMoviePath, buildEpisodePath } from '@tadaima/shared';

export interface OrganizedFile {
  path: string;
  size: number;
}

export class MediaOrganizer {
  private moviesDir: string;
  private tvDir: string;
  private logger: Logger;

  constructor(
    moviesDir: string,
    tvDir: string,
    logger?: Logger
  ) {
    this.moviesDir = moviesDir;
    this.tvDir = tvDir;
    this.logger = logger || console;
  }

  /**
   * Organize downloaded files into Plex structure.
   */
  async organize(
    downloadedFiles: Array<{ path: string; size: number }>,
    payload: {
      title: string;
      year: number;
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      season?: number;
      episode?: number;
      episodeTitle?: string;
    }
  ): Promise<OrganizedFile> {
    if (downloadedFiles.length === 0) {
      throw new Error('No files to organize');
    }

    // Use the largest file (assume it's the video)
    const mainFile = downloadedFiles.reduce((a, b) =>
      a.size > b.size ? a : b
    );

    const extension = path.extname(mainFile.path).slice(1) || 'mkv';

    let targetPath: string;

    if (payload.mediaType === 'movie') {
      targetPath = buildMoviePath(
        this.moviesDir,
        payload.title,
        payload.year,
        payload.tmdbId,
        extension
      );
    } else {
      if (payload.season === undefined || payload.episode === undefined) {
        throw new Error('TV episodes require season and episode numbers');
      }

      targetPath = buildEpisodePath(
        this.tvDir,
        payload.title,
        payload.tmdbId,
        payload.season,
        payload.episode,
        payload.episodeTitle,
        extension
      );
    }

    // Create parent directories
    const targetDir = path.dirname(targetPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    // Move file (overwrites if exists)
    this.logger.log(`Moving ${mainFile.path} → ${targetPath}`);
    await fs.promises.copyFile(mainFile.path, targetPath);

    // Verify
    const stats = await fs.promises.stat(targetPath);

    return {
      path: targetPath,
      size: stats.size,
    };
  }
}
```

---

## Download Pipeline Phases

### Phase Flow

```
download:request received
    ↓
[ADDING] addMagnet(magnet) → torrentId
    ↓
[WAITING] pollUntilReady(torrentId) → links[]
    ↓
[UNRESTRICTING] unrestrictAll(links) → { url, size }[]
    ↓
[DOWNLOADING] HTTP stream files to staging dir with progress
    ↓
[ORGANIZING] Move to Plex structure
    ↓
download:completed OR download:failed
```

### State Tracking

Each download job has:
- `jobId`: ULID, globally unique within agent
- `phase`: Current phase (adding, waiting, unrestricting, downloading, organizing)
- `status`: pending, active, completed, failed, cancelled
- `abortController`: For cancellation

Progress events sent at phase transitions and during downloading (throttled to 1/second).

---

## Progress Event Streaming

### WebSocket Message: `download:progress`

Sent regularly during active phases:

```typescript
{
  type: "download:progress",
  payload: {
    jobId: string;
    phase: "adding" | "waiting" | "unrestricting" | "downloading" | "organizing";
    progress: number; // 0-100
    downloadedBytes?: number;
    totalBytes?: number;
    speedBps?: number;
    eta?: number; // seconds
  }
}
```

### Throttling

Progress events are throttled to approximately 1 per second:

```typescript
const throttleMs = 1000;
let lastProgressTime = Date.now();

function reportProgress(data: ProgressData) {
  const now = Date.now();
  if (now - lastProgressTime >= throttleMs) {
    ws.send(progressMessage(data));
    lastProgressTime = now;
  }
}
```

### Relay Forwarding

The relay passes all `download:progress` events from agents to connected web clients (no processing, just forwarding).

---

## Error Handling & RD Key Rotation

### 401/403 Handling

When `RealDebridClient` gets a 401 or 403:

1. Log a warning
2. Call `rotateApiKey()`:
   - Fetch `GET /api/agent/config` from relay (authenticated with device token)
   - Extract new RD API key from response
   - Update in-memory `apiKey`
3. Retry the original request
4. If retry also fails with 401/403, give up and throw `RDAuthError`

The relay endpoint `GET /api/agent/config` is an authenticated endpoint that returns:

```json
{
  "realDebrid": {
    "apiKey": "..."
  },
  "maxConcurrentDownloads": 2,
  "rdPollInterval": 30
}
```

### Error Classification

| Error | Retryable | Action |
|-------|-----------|--------|
| Network timeout | Yes | Retry entire pipeline |
| 401/403 (auth) | Conditional | Auto-rotate key, retry once |
| Torrent unavailable (dead/virus) | No | Fail with user message |
| Poll timeout (>30min) | Yes | Fail, suggest retry |
| Disk full | No | Fail with clear error |
| File I/O permission denied | No | Fail with clear error |

### User-Facing Error Messages

Sent in `download:failed` payload:

```
"Torrent unavailable (dead seed)"
"Real-Debrid API error (401). Please check your account."
"Download cancelled by user."
"Insufficient disk space (need 50 GB, have 10 GB free)."
"Episode path creation failed: Permission denied at /mnt/media/TV"
```

---

## Testing Strategy

### Unit Tests

#### 1. RealDebridClient

Mock HTTP layer:

```typescript
// packages/agent/src/services/__tests__/realDebridClient.test.ts

import { describe, it, expect, vi } from 'vitest';
import { RealDebridClient, RDAuthError, RDTimeoutError } from '../realDebridClient';

describe('RealDebridClient', () => {
  it('addMagnet returns torrent ID', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'torrent123' }),
    });

    const client = new RealDebridClient('dummy_key', mockFetch);
    const id = await client.addMagnet('magnet:?xt=urn:btih:...');

    expect(id).toBe('torrent123');
  });

  it('401 triggers key rotation and retry', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, text: async () => 'Unauthorized' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'torrent456' }),
      });

    const mockConfig = {
      relay: 'http://relay',
      deviceToken: 'token123',
    };

    // Mock fetch globally
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ realDebrid: { apiKey: 'new_key' } }),
      });

    const client = new RealDebridClient(
      'old_key',
      mockFetch,
      undefined,
      mockConfig as any
    );

    const id = await client.addMagnet('magnet:?...');
    expect(id).toBe('torrent456');
  });

  it('pollUntilReady times out after 30 minutes', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'downloading', progress: 50 }),
    });

    const client = new RealDebridClient('key', mockFetch);

    await expect(
      client.pollUntilReady('torrent123', 1, 2) // 2 second timeout
    ).rejects.toThrow(RDTimeoutError);
  });

  it('unrestrictAll handles partial failures', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'http://direct1', size: 1000 }),
      })
      .mockResolvedValueOnce({ status: 403, text: async () => 'Bad link' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'http://direct2', size: 2000 }),
      });

    const client = new RealDebridClient('key', mockFetch);
    const results = await client.unrestrictAll([
      'link1',
      'link2',
      'link3',
    ]);

    expect(results.length).toBe(2);
  });
});
```

#### 2. MediaOrganizer

```typescript
// packages/agent/src/services/__tests__/mediaOrganizer.test.ts

describe('MediaOrganizer', () => {
  it('builds movie path correctly', async () => {
    const organizer = new MediaOrganizer('/movies', '/tv');

    const organized = await organizer.organize(
      [{ path: '/tmp/file.mkv', size: 1000000 }],
      {
        title: 'The Matrix',
        year: 1999,
        tmdbId: 603,
        mediaType: 'movie',
      }
    );

    expect(organized.path).toBe(
      '/movies/The Matrix (1999) [tmdb-603]/The Matrix (1999).mkv'
    );
  });

  it('sanitizes title correctly', async () => {
    const organizer = new MediaOrganizer('/movies', '/tv');

    const organized = await organizer.organize(
      [{ path: '/tmp/file.mkv', size: 1000000 }],
      {
        title: 'Inception: A Dream Within A Dream',
        year: 2010,
        tmdbId: 27205,
        mediaType: 'movie',
      }
    );

    expect(organized.path).toContain('Inception - A Dream Within A Dream');
  });

  it('builds episode path with season/episode formatting', async () => {
    const organizer = new MediaOrganizer('/movies', '/tv');

    const organized = await organizer.organize(
      [{ path: '/tmp/file.mkv', size: 1000000 }],
      {
        title: 'Breaking Bad',
        year: 2008,
        tmdbId: 1396,
        mediaType: 'tv',
        season: 5,
        episode: 16,
        episodeTitle: 'Felina',
      }
    );

    expect(organized.path).toBe(
      '/tv/Breaking Bad [tmdb-1396]/Season 05/S05E16 - Felina.mkv'
    );
  });
});
```

#### 3. Download Handler

```typescript
// packages/agent/src/handlers/__tests__/downloadHandler.test.ts

describe('DownloadHandler', () => {
  it('rejects download when queue is full', async () => {
    const mockQueue = {
      isFull: () => true,
    };

    const handler = new DownloadHandler(
      mockQueue as any,
      {} as any,
      {} as any,
      {} as any,
      mockWs as any
    );

    await handler.handle(downloadRequest);

    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('download:rejected')
    );
  });

  it('executes full pipeline and sends completed', async () => {
    // Mock all services
    // Execute pipeline
    // Verify completed message sent with correct path
  });
});
```

### Integration Tests

Test the full pipeline with mock RD API:

```typescript
// e2e test: download a movie from start to finish
// - Mock RD API responses
// - Create temporary staging/media directories
// - Trigger download
// - Verify file organized correctly
// - Verify WebSocket messages sent in order
```

### Acceptance Criteria Tests

Map each acceptance criterion to a test:

| Criterion | Test | Location |
|-----------|------|----------|
| 6.1 | Offline download queued in DB | `relay/__tests__/downloadQueue.test.ts` |
| 6.2 | Queued delivered on reconnect | `relay/__tests__/agentHello.test.ts` |
| 6.3 | Queue cancelable from web | `relay/__tests__/api.test.ts` |
| 6.4 | Queue expires after 14 days | `relay/__tests__/expiration.test.ts` |
| 6.5 | addMagnet returns ID | `agent/__tests__/rdClient.test.ts` |
| 6.6 | pollUntilReady works | `agent/__tests__/rdClient.test.ts` |
| 6.7 | checkCache returns boolean map | `agent/__tests__/rdClient.test.ts` |
| 6.8 | Full RD pipeline works | `agent/__tests__/rdClient.test.ts` + e2e |
| 6.9 | Progress events throttled to 1/sec | `agent/__tests__/fileDownloader.test.ts` |
| 6.10 | download:completed sent with path + size | `agent/__tests__/downloadHandler.test.ts` |
| 6.11 | download:failed with error, phase, retryable | `agent/__tests__/downloadHandler.test.ts` |
| 6.12 | Cancellation aborts at any phase | `agent/__tests__/downloadHandler.test.ts` |
| 6.13 | Semaphore limits concurrent downloads | `agent/__tests__/downloadQueue.test.ts` |
| 6.14 | Staging files cleaned up after success | `agent/__tests__/downloadHandler.test.ts` |
| 6.15 | Movie path correct | `agent/__tests__/mediaOrganizer.test.ts` |
| 6.16 | Episode path correct | `agent/__tests__/mediaOrganizer.test.ts` |
| 6.17 | sanitize() works | `shared/__tests__/mediaPath.test.ts` |
| 6.18 | RD key from config, never sent to relay | `agent/__tests__/rdClient.test.ts` |

---

## Implementation Order & Verification

### Phase 6.1: Core RealDebridClient

**Deliverables:**
- `packages/agent/src/services/realDebridClient.ts` (all methods)
- Unit tests (mock HTTP)
- Error classes (RDError, RDAuthError, RDTimeoutError, RDTorrentError)

**Verification:**
- `addMagnet()` returns torrent ID
- `selectFiles()` sends correct request
- `pollUntilReady()` handles all status transitions
- `unrestrictLink()` returns URL + size
- `unrestrictAll()` processes multiple links
- `checkCache()` returns boolean map
- 401/403 triggers key rotation

**Checklist:**
- [ ] All RD API endpoints implemented
- [ ] Error handling covers all error types
- [ ] Key rotation works (mocked relay)
- [ ] Unit tests pass
- [ ] TypeScript strict mode passes

---

### Phase 6.2: File Download Service

**Deliverables:**
- `packages/agent/src/services/fileDownloadService.ts`
- 64KB chunking, progress throttling, AbortController support
- Unit tests

**Verification:**
- Downloads complete successfully
- Progress events throttled to ~1/second
- Cancellation via AbortController works
- Partial files cleaned up on failure

**Checklist:**
- [ ] HTTP streaming works with `got` or `fetch`
- [ ] Progress events fired correctly
- [ ] Throttling functional
- [ ] Cancellation aborts immediately
- [ ] Disk errors handled gracefully

---

### Phase 6.3: Media Organizer + Shared Utilities

**Deliverables:**
- `packages/shared/src/utils/mediaPath.ts` (sanitize, buildMoviePath, buildEpisodePath)
- `packages/agent/src/services/mediaOrganizer.ts`
- Unit tests

**Verification:**
- `sanitize()` removes/replaces illegal characters
- Movie paths match Plex convention
- Episode paths match Plex convention
- Directory creation works
- File moves work (cross-filesystem)
- Permission errors handled

**Checklist:**
- [ ] Sanitization covers all edge cases (colons, illegal chars, spacing)
- [ ] Paths created correctly for both movie and TV
- [ ] Episode title optional (path valid without it)
- [ ] Files overwrite at destination
- [ ] Unit tests pass

---

### Phase 6.4: Download Queue (DownloadQueue class)

**Deliverables:**
- `packages/agent/src/queue/downloadQueue.ts`
- Semaphore, job tracking, cancellation
- Unit tests

**Verification:**
- Jobs added with ULID ID
- Semaphore limits concurrent to `maxConcurrentDownloads`
- `isFull()` returns correct state
- Job state updates work
- Cancellation sets abort signal
- Active jobs retrievable for TUI

**Checklist:**
- [ ] ULID generation works
- [ ] Semaphore acquire/release correct
- [ ] Concurrent limit enforced
- [ ] Job lifecycle tracked
- [ ] Unit tests pass

---

### Phase 6.5: Download Handler

**Deliverables:**
- `packages/agent/src/handlers/downloadHandler.ts`
- Request validation, pipeline execution, message senders
- Unit tests

**Verification:**
- `download:request` validated against Zod schema
- Invalid requests rejected with clear error
- Queue full → `download:rejected`
- Valid request → `download:accepted` + job execution
- Pipeline executes all 5 phases in order
- Progress events sent at each phase
- Success → `download:completed` with path + size
- Failure → `download:failed` with error + phase + retryable flag
- Staging dir cleaned up after completion
- Staging dir cleaned up on error

**Checklist:**
- [ ] Validation catches bad payloads
- [ ] Semaphore slot acquired/released correctly
- [ ] Pipeline phases execute in order
- [ ] All error conditions tested
- [ ] Cleanup happens in all paths
- [ ] WebSocket messages formatted correctly
- [ ] Unit tests pass

---

### Phase 6.6: Relay Download Queue Service

**Deliverables:**
- `packages/relay/src/services/downloadQueue.ts`
- `packages/relay/src/handlers/downloadQueue.ts` (queue on offline, deliver on reconnect)
- Periodic expiration job
- Unit tests

**Verification:**
- Offline download stored in DB with status "queued"
- Web client receives `download:queued` message
- On agent reconnect (`agent:hello`), queued downloads delivered as `download:request`
- Queue status updated to "delivered"
- Web client notified as each queued item activates
- Queued downloads older than 14 days marked "expired"
- `DELETE /api/queue/:queueId` cancels and deletes queue entry

**Checklist:**
- [ ] Queue table created/migrated
- [ ] Offline detection works (agent not in connection pool)
- [ ] Delivery logic sends all queued for this device
- [ ] Status tracking (queued → delivered → expired)
- [ ] 14-day expiration runs periodically
- [ ] Cancellation deletes from DB
- [ ] Unit tests pass

---

### Phase 6.7: WebSocket Integration

**Deliverables:**
- Agent WebSocket handler for `download:request`
- Agent WebSocket handler for `download:cancel`
- Relay routing for agent ↔ web app messages

**Verification:**
- Web sends `download:request` → relay → agent (if online)
- Web sends `download:request` → relay queues (if offline)
- Agent sends `download:progress` → relay → web
- Agent sends `download:completed` → relay → web
- Agent sends `download:failed` → relay → web
- Web sends `download:cancel` → relay → agent
- Agent cancels job and sends `download:cancelled`

**Checklist:**
- [ ] Message routing works end-to-end
- [ ] Progress throttling functional
- [ ] Cancellation propagates correctly
- [ ] TUI updates with progress
- [ ] Web UI updates with progress
- [ ] Integration tests pass

---

### Phase 6.8: Acceptance Tests & Demo

**Deliverables:**
- Test suite covering all 18 acceptance criteria
- Demo script (setup, offline queue, cancellation)

**Verification:**
- Run `pnpm test` — all Phase 6 tests pass
- Demo 6a: Download movie online, see phases, file organized, cancel works
- Demo 6b: Queue movie offline, start agent, queued download auto-starts

**Checklist:**
- [ ] All acceptance criteria tested
- [ ] Integration tests pass
- [ ] Demo 6a works
- [ ] Demo 6b works
- [ ] No TypeScript errors
- [ ] No console errors in agent/relay/web

---

## Common Pitfalls

### Real-Debrid API Quirks

1. **Magnet selection timing**
   - Do NOT select files immediately after `addMagnet()`. Real-Debrid needs a moment to process.
   - **Fix**: Polling loop already handles this; if status is "waiting_files_selection", `selectFiles()` succeeds.

2. **Poll status transitions**
   - Status can be: magnet_error, magnet_downloading, waiting_files_selection, queued, downloading, downloaded, error, virus, dead
   - **Fix**: Only consider "downloaded" as success; all others are either in-progress or error states.

3. **Links empty when status = "downloaded"**
   - Some torrents may have zero links (rare but possible).
   - **Fix**: Check `links.length > 0` before proceeding to unrestrict phase.

4. **Unrestrict rate limiting**
   - RD may rate-limit if you unrestrict too many links too fast.
   - **Fix**: Add a small delay (100ms) between unrestrict calls if seeing 429 errors.

5. **Cache check format**
   - `GET /torrents/instantAvailability/{hashes}` returns an object keyed by hash. Cached = object with content, not cached = empty object {}.
   - **Fix**: The implementation checks `Object.keys(value).length > 0`.

### File System Quirks

#### Windows vs. Unix

1. **Path separators**
   - Use `path.join()` (already done in code) — it handles both.
   - Never hardcode "/" or "\" in paths.

2. **Illegal characters on Windows**
   - Windows disallows: `< > : " / \ | ? *`
   - The sanitize function handles all of these.
   - Test on Windows: `The Movie: Subtitle (2020)` → `The Movie - Subtitle (2020)`

3. **Case sensitivity**
   - Windows is case-insensitive, Unix is case-sensitive.
   - **Issue**: Two files with same name but different case fail on Windows.
   - **Fix**: Sanitize ensures only one valid name per title.

4. **File locks on Windows**
   - Antivirus may lock files immediately after download.
   - **Fix**: Don't immediately verify file after move; queue verification as background task.

#### Cross-Filesystem Moves

1. **move() vs. copy() + unlink()**
   - `fs.rename()` fails across filesystems (e.g., /tmp to /mnt/media on different drives).
   - **Fix**: The code uses `fs.copyFile()` followed by cleanup, which works across filesystems.

2. **Permissions**
   - If staging dir is on one mount (e.g., /tmp) and media dir on another (e.g., /mnt), permissions may differ.
   - **Fix**: Check disk permissions during setup; fail early with clear message if media dir not writable.

### Download Cancellation Edge Cases

1. **Cancel during downloading phase**
   - File is partially written.
   - **Fix**: AbortController aborts the stream; cleanup removes partial file.

2. **Cancel during organizing phase**
   - File is being moved.
   - **Fix**: If move hasn't started, no cleanup needed. If mid-move, the temp location is tracked and cleaned.

3. **Queue-level cancellation (not-yet-delivered)**
   - Web sends cancel → relay deletes from download_queue table.
   - Agent doesn't know about it (hasn't received the download:request yet).
   - **Fix**: No cleanup needed; queue entry is simply deleted. When agent connects, the entry is gone.

### Progress Reporting

1. **Total bytes unknown**
   - Some servers don't send `Content-Length` header.
   - **Fix**: Report progress as 0-100 based on time estimate if totalBytes is 0.

2. **Progress goes backward** (rare, but possible with range requests)
   - **Fix**: Track `maxDownloadedBytes` seen so far; never report lower.

3. **ETA unrealistic**
   - If speed varies wildly, ETA bounces around.
   - **Fix**: Smooth speed over last 10 seconds using a simple moving average.

### Relay Queue Management

1. **Duplicate delivery**
   - Agent reconnects twice before status updated.
   - **Fix**: Mark as "delivered" before sending, not after. Use a transaction.

2. **Lost in-flight queue items**
   - Agent receives download:request, agent crashes before ack.
   - **Fix**: Relay resends queued items on every reconnect (not just first). Agent deduplicates using requestId.

3. **Queue grows unbounded**
   - Old queued items accumulate.
   - **Fix**: Run expiration job hourly; delete anything older than 14 days.

### Testing on Different Platforms

- **Windows**: Test path handling, file locks, antivirus interference
- **Linux**: Test permissions, systemd service integration, Docker
- **macOS**: Test launchd service integration, file notifications

### Dependency Pinning

If using `got`, pin to ~14.0.0:

```json
{
  "dependencies": {
    "got": "~14.0.0"
  }
}
```

Alternatively, native `fetch` requires Node.js 22+ (which is our target, so this is safe).

---

## Summary Checklist

### Pre-Implementation

- [ ] Decision made: `got` or native `fetch`? (recommend: `got`)
- [ ] Dependencies added to `package.json`
- [ ] Relay DB migration created for `download_queue` (if not already in schema)

### Implementation

- [ ] RealDebridClient class complete with all methods
- [ ] Error handling + key rotation
- [ ] FileDownloadService with 64KB chunks + throttling
- [ ] MediaOrganizer + shared utils (sanitize, buildMoviePath, buildEpisodePath)
- [ ] DownloadQueue class with semaphore
- [ ] DownloadHandler with pipeline execution
- [ ] Relay download queue service
- [ ] Relay queue delivery on `agent:hello`
- [ ] WebSocket message routing (all types)

### Testing

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All 18 acceptance criteria tested
- [ ] Demo 6a works (online download)
- [ ] Demo 6b works (offline queue)

### Deployment

- [ ] No TypeScript errors (`pnpm typecheck`)
- [ ] Linting passes (`pnpm lint`)
- [ ] No console warnings in agent/relay/web
- [ ] Database migration runs cleanly
- [ ] Config schema updated (if needed)

---

## Notes for Implementation Team

1. **Start with RD client** — it's the most complex and independent. Test with mock HTTP first.
2. **FileDownloadService is straightforward** — simple HTTP streaming + throttling.
3. **MediaOrganizer is simple** — just path building and file moves.
4. **DownloadHandler ties it all together** — the core orchestration logic. This is where bugs are likely.
5. **Relay queue service** is simple database ops + message sending — do last.
6. **WebSocket routing** should already exist from Phase 2–5; Phase 6 just adds new message types.
7. **Testing** — start with RD client mocks, then integration tests with real-ish data (but mocked RD API).

---

End of Phase 6 Spec.
