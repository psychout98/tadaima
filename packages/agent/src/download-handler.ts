import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createMessageId, createTimestamp } from "@tadaima/shared";
import { config } from "./config.js";
import { rdClient } from "./rd-client.js";
import { downloadFile } from "./downloader.js";
import { organizeFile } from "./organizer.js";
import type { AgentWebSocket } from "./ws-client.js";

interface DownloadJob {
  jobId: string;
  requestId: string;
  abortController: AbortController;
  phase: string;
  meta: {
    tmdbId: number;
    imdbId: string;
    title: string;
    year: number;
    mediaType: "movie" | "tv";
    season?: number;
    episode?: number;
    episodeTitle?: string;
    magnet: string;
    torrentName: string;
    expectedSize: number;
  };
}

export class DownloadHandler {
  private ws: AgentWebSocket;
  private activeJobs = new Map<string, DownloadJob>();
  private semaphore: number;

  constructor(ws: AgentWebSocket) {
    this.ws = ws;
    this.semaphore = config.get("maxConcurrentDownloads");
  }

  get activeCount(): number {
    return this.activeJobs.size;
  }

  async handleRequest(msg: Record<string, unknown>): Promise<void> {
    const payload = msg.payload as Record<string, unknown>;
    const requestId = msg.id as string;

    if (this.activeJobs.size >= this.semaphore) {
      this.sendMessage("download:rejected", {
        requestId,
        reason: "queue_full",
      });
      return;
    }

    const jobId = createMessageId();
    const abortController = new AbortController();

    const meta = {
      tmdbId: payload.tmdbId as number,
      imdbId: payload.imdbId as string,
      title: payload.title as string,
      year: payload.year as number,
      mediaType: payload.mediaType as "movie" | "tv",
      season: payload.season as number | undefined,
      episode: payload.episode as number | undefined,
      episodeTitle: payload.episodeTitle as string | undefined,
      magnet: payload.magnet as string,
      torrentName: payload.torrentName as string,
      expectedSize: payload.expectedSize as number,
    };

    const job: DownloadJob = {
      jobId,
      requestId,
      abortController,
      phase: "adding",
      meta,
    };
    this.activeJobs.set(jobId, job);
    this.ws.setActiveJobs(this.activeJobs.size);

    this.sendMessage("download:accepted", { jobId, requestId });

    try {
      await this.executeDownload(job);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const retryable = !errMsg.includes("Cancelled");
      this.sendMessage("download:failed", {
        jobId,
        error: errMsg,
        phase: job.phase,
        retryable,
        _meta: meta,
      });
    } finally {
      this.activeJobs.delete(jobId);
      this.ws.setActiveJobs(this.activeJobs.size);
    }
  }

  handleCancel(msg: Record<string, unknown>): void {
    const payload = msg.payload as Record<string, unknown>;
    const jobId = payload.jobId as string;
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.abortController.abort();
    }
  }

  async handleCacheCheck(msg: Record<string, unknown>): Promise<void> {
    const payload = msg.payload as Record<string, unknown>;
    const requestId = payload.requestId as string;
    const infoHashes = payload.infoHashes as string[];

    try {
      const cached = await rdClient.checkCache(infoHashes);
      this.sendMessage("cache:result", { requestId, cached });
    } catch {
      this.sendMessage("cache:result", { requestId, cached: {} });
    }
  }

  private async executeDownload(job: DownloadJob): Promise<void> {
    const { meta, abortController } = job;
    const signal = abortController.signal;

    // Phase: adding
    job.phase = "adding";
    this.sendProgress(job.jobId, "adding", 0);
    console.log(`[${job.jobId}] Adding magnet to RD...`);

    const { id: torrentId } = await rdClient.addMagnet(meta.magnet);
    if (signal.aborted) throw new Error("Cancelled");

    await rdClient.selectFiles(torrentId);
    if (signal.aborted) throw new Error("Cancelled");

    // Phase: waiting
    job.phase = "waiting";
    this.sendProgress(job.jobId, "waiting", 0);
    console.log(`[${job.jobId}] Waiting for RD to process...`);

    const links = await rdClient.pollUntilReady(
      torrentId,
      undefined,
      undefined,
      (progress) => this.sendProgress(job.jobId, "waiting", progress),
      signal,
    );

    // Phase: unrestricting
    job.phase = "unrestricting";
    this.sendProgress(job.jobId, "unrestricting", 0);
    console.log(`[${job.jobId}] Unrestricting ${links.length} links...`);

    const unrestricted = await rdClient.unrestrictAll(links);
    if (signal.aborted) throw new Error("Cancelled");

    // Phase: downloading
    job.phase = "downloading";
    console.log(`[${job.jobId}] Downloading files...`);

    const stagingDir = config.get("directories.staging") || "/tmp/tadaima/staging";
    const downloadedFiles: string[] = [];
    let totalSize = 0;

    for (const file of unrestricted) {
      if (signal.aborted) throw new Error("Cancelled");

      const destPath = join(stagingDir, job.jobId, file.filename);
      console.log(`[${job.jobId}] Downloading: ${file.filename}`);

      const size = await downloadFile(
        file.url,
        destPath,
        (progress) => {
          const pct = progress.totalBytes > 0
            ? Math.round((progress.downloadedBytes / progress.totalBytes) * 100)
            : 0;
          this.sendMessage("download:progress", {
            jobId: job.jobId,
            phase: "downloading",
            progress: pct,
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
            speedBps: progress.speedBps,
            eta: progress.eta,
          });
        },
        signal,
      );

      downloadedFiles.push(destPath);
      totalSize += size;
    }

    // Phase: organizing
    job.phase = "organizing";
    this.sendProgress(job.jobId, "organizing", 0);
    console.log(`[${job.jobId}] Organizing files...`);

    let finalPath = "";
    for (const filePath of downloadedFiles) {
      finalPath = await organizeFile({
        title: meta.title,
        year: meta.year,
        tmdbId: meta.tmdbId,
        mediaType: meta.mediaType,
        season: meta.season,
        episode: meta.episode,
        episodeTitle: meta.episodeTitle,
        sourcePath: filePath,
      });
    }

    // Clean staging
    await rm(join(stagingDir, job.jobId), { recursive: true, force: true }).catch(() => {});

    // Done!
    console.log(`[${job.jobId}] Complete: ${finalPath}`);
    this.sendMessage("download:completed", {
      jobId: job.jobId,
      filePath: finalPath,
      finalSize: totalSize,
      _meta: meta,
    });
  }

  private sendProgress(jobId: string, phase: string, progress: number): void {
    this.sendMessage("download:progress", { jobId, phase, progress });
  }

  private sendMessage(type: string, payload: Record<string, unknown>): void {
    this.ws.send({
      id: createMessageId(),
      type,
      timestamp: createTimestamp(),
      payload,
    });
  }
}
