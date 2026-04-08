import { db } from "../db.js";
import {
  downloadQueue,
  downloadHistory,
  devices,
  createTimestamp,
  createMessageId,
  messageSchema,
} from "@tadaima/shared";
import { eq, and } from "drizzle-orm";
import { getAgent, broadcastToClients } from "./pool.js";

const EXPIRY_DAYS = 14;

/**
 * Queue a download request for an offline device.
 */
export async function queueDownload(
  profileId: string,
  deviceId: string,
  payload: Record<string, unknown>,
  requestId: string,
  title: string,
): Promise<string> {
  const [entry] = await db
    .insert(downloadQueue)
    .values({
      profileId,
      deviceId,
      payload,
      status: "queued",
    })
    .returning({ id: downloadQueue.id });

  // Get device name for the queued message
  const [device] = await db
    .select({ name: devices.name })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);

  // Notify web clients
  broadcastToClients(
    profileId,
    JSON.stringify({
      id: `queued-${entry.id}`,
      type: "download:queued",
      timestamp: createTimestamp(),
      payload: {
        queueId: entry.id,
        requestId,
        title,
        deviceName: device?.name ?? "Unknown",
        mediaType: (payload as { payload?: { mediaType?: string } })?.payload?.mediaType,
        season: (payload as { payload?: { season?: number } })?.payload?.season,
      },
    }),
  );

  return entry.id;
}

/**
 * Deliver queued downloads to an agent that just connected.
 */
export async function deliverQueuedDownloads(
  profileId: string,
  deviceId: string,
): Promise<void> {
  const cutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  // Query all queued entries for this device
  const allQueued = await db
    .select()
    .from(downloadQueue)
    .where(
      and(
        eq(downloadQueue.profileId, profileId),
        eq(downloadQueue.deviceId, deviceId),
        eq(downloadQueue.status, "queued"),
      ),
    );

  const agent = getAgent(profileId, deviceId);
  if (!agent) return;

  for (const entry of allQueued) {
    if (entry.createdAt < cutoff) {
      await db
        .update(downloadQueue)
        .set({ status: "expired" })
        .where(eq(downloadQueue.id, entry.id));
      continue;
    }

    // Validate payload before delivery
    const parsed = messageSchema.safeParse(entry.payload);
    if (!parsed.success) {
      await db
        .update(downloadQueue)
        .set({ status: "failed" })
        .where(eq(downloadQueue.id, entry.id));

      broadcastToClients(
        profileId,
        JSON.stringify({
          id: createMessageId(),
          type: "error",
          timestamp: createTimestamp(),
          payload: {
            code: "INVALID_QUEUED_PAYLOAD",
            detail: `Queued download expired or is invalid: ${(entry.payload as { payload?: { title?: string } })?.payload?.title ?? "Unknown"}`,
          },
        }),
      );
      continue;
    }

    // Deliver to agent
    if (agent.ws.readyState === 1) {
      agent.ws.send(JSON.stringify(parsed.data));
      await db
        .update(downloadQueue)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(eq(downloadQueue.id, entry.id));
    }
  }
}

/**
 * Record a completed or failed download in history.
 */
export async function recordDownloadHistory(
  profileId: string,
  deviceId: string,
  data: {
    tmdbId: number;
    imdbId: string;
    title: string;
    year: number;
    mediaType: string;
    season?: number;
    episode?: number;
    episodeTitle?: string;
    magnet: string;
    torrentName: string;
    expectedSize: number;
    sizeBytes?: number;
    status: string;
    error?: string;
    retryable?: boolean;
  },
): Promise<void> {
  await db.insert(downloadHistory).values({
    profileId,
    deviceId,
    tmdbId: data.tmdbId,
    imdbId: data.imdbId,
    title: data.title,
    year: data.year,
    mediaType: data.mediaType,
    season: data.season ?? null,
    episode: data.episode ?? null,
    episodeTitle: data.episodeTitle ?? null,
    magnet: data.magnet,
    torrentName: data.torrentName,
    expectedSize: data.expectedSize,
    sizeBytes: data.sizeBytes ?? null,
    status: data.status,
    error: data.error ?? null,
    retryable: data.retryable ?? null,
    completedAt: new Date(),
  });
}
