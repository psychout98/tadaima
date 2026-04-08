import { z } from "zod";

// ── Base envelope ──────────────────────────────────────────────

export const messageEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.number(),
});

// ── Command messages (web → relay → agent) ─────────────────────

export const downloadRequestPayloadSchema = z.object({
  tmdbId: z.number(),
  imdbId: z.string(),
  title: z.string(),
  year: z.number(),
  mediaType: z.enum(["movie", "tv"]),
  season: z.number().optional(),
  episode: z.number().optional(),
  episodeTitle: z.string().optional(),
  magnet: z.string(),
  torrentName: z.string(),
  expectedSize: z.number(),
});

export const downloadRequestSchema = messageEnvelopeSchema.extend({
  type: z.literal("download:request"),
  payload: downloadRequestPayloadSchema,
});

export const downloadCancelPayloadSchema = z.object({
  jobId: z.string(),
});

export const downloadCancelSchema = messageEnvelopeSchema.extend({
  type: z.literal("download:cancel"),
  payload: downloadCancelPayloadSchema,
});

export const cacheCheckPayloadSchema = z.object({
  requestId: z.string(),
  infoHashes: z.array(z.string()),
});

export const cacheCheckSchema = messageEnvelopeSchema.extend({
  type: z.literal("cache:check"),
  payload: cacheCheckPayloadSchema,
});

// ── Event messages (agent → relay → web) ───────────────────────

export const downloadAcceptedPayloadSchema = z.object({
  jobId: z.string(),
  requestId: z.string(),
  title: z.string().optional(),
  mediaType: z.enum(["movie", "tv"]).optional(),
});

export const downloadAcceptedSchema = messageEnvelopeSchema.extend({
  type: z.literal("download:accepted"),
  payload: downloadAcceptedPayloadSchema,
});

export const downloadProgressPayloadSchema = z.object({
  jobId: z.string(),
  phase: z.string(),
  progress: z.number().min(0).max(100),
  title: z.string().optional(),
  mediaType: z.enum(["movie", "tv"]).optional(),
  downloadedBytes: z.number().optional(),
  totalBytes: z.number().optional(),
  speedBps: z.number().optional(),
  eta: z.number().optional(),
});

export const downloadProgressSchema = messageEnvelopeSchema.extend({
  type: z.literal("download:progress"),
  payload: downloadProgressPayloadSchema,
});

export const downloadCompletedPayloadSchema = z.object({
  jobId: z.string(),
  filePath: z.string(),
  filePaths: z.array(z.string()).optional(),
  finalSize: z.number(),
});

export const downloadCompletedSchema = messageEnvelopeSchema.extend({
  type: z.literal("download:completed"),
  payload: downloadCompletedPayloadSchema,
});

export const downloadFailedPayloadSchema = z.object({
  jobId: z.string(),
  error: z.string(),
  phase: z.string(),
  retryable: z.boolean(),
});

export const downloadFailedSchema = messageEnvelopeSchema.extend({
  type: z.literal("download:failed"),
  payload: downloadFailedPayloadSchema,
});

export const downloadRejectedPayloadSchema = z.object({
  requestId: z.string(),
  reason: z.string(),
});

export const downloadRejectedSchema = messageEnvelopeSchema.extend({
  type: z.literal("download:rejected"),
  payload: downloadRejectedPayloadSchema,
});

export const downloadQueuedPayloadSchema = z.object({
  queueId: z.string(),
  requestId: z.string(),
  title: z.string(),
  deviceName: z.string(),
  mediaType: z.enum(["movie", "tv"]).optional(),
  season: z.number().optional(),
});

export const downloadQueuedSchema = messageEnvelopeSchema.extend({
  type: z.literal("download:queued"),
  payload: downloadQueuedPayloadSchema,
});

export const cacheResultPayloadSchema = z.object({
  requestId: z.string(),
  cached: z.record(z.string(), z.boolean()),
});

export const cacheResultSchema = messageEnvelopeSchema.extend({
  type: z.literal("cache:result"),
  payload: cacheResultPayloadSchema,
});

// ── System messages ────────────────────────────────────────────

export const agentHelloPayloadSchema = z.object({
  version: z.string(),
  platform: z.string(),
  activeJobs: z.number(),
  diskFreeBytes: z.number(),
});

export const agentHelloSchema = messageEnvelopeSchema.extend({
  type: z.literal("agent:hello"),
  payload: agentHelloPayloadSchema,
});

export const agentHeartbeatPayloadSchema = z.object({
  activeJobs: z.number(),
  diskFreeBytes: z.number(),
  uptimeSeconds: z.number(),
});

export const agentHeartbeatSchema = messageEnvelopeSchema.extend({
  type: z.literal("agent:heartbeat"),
  payload: agentHeartbeatPayloadSchema,
});

export const deviceStatusPayloadSchema = z.object({
  deviceId: z.string(),
  isOnline: z.boolean(),
  lastSeenAt: z.number(),
});

export const deviceStatusSchema = messageEnvelopeSchema.extend({
  type: z.literal("device:status"),
  payload: deviceStatusPayloadSchema,
});

export const errorPayloadSchema = z.object({
  code: z.string(),
  detail: z.string(),
  originalMessageId: z.string().optional(),
});

export const errorMessageSchema = messageEnvelopeSchema.extend({
  type: z.literal("error"),
  payload: errorPayloadSchema,
});

// ── Discriminated union of all messages ────────────────────────

export const messageSchema = z.discriminatedUnion("type", [
  downloadRequestSchema,
  downloadCancelSchema,
  cacheCheckSchema,
  downloadAcceptedSchema,
  downloadProgressSchema,
  downloadCompletedSchema,
  downloadFailedSchema,
  downloadRejectedSchema,
  downloadQueuedSchema,
  cacheResultSchema,
  agentHelloSchema,
  agentHeartbeatSchema,
  deviceStatusSchema,
  errorMessageSchema,
]);

// ── Inferred types ─────────────────────────────────────────────

export type MessageEnvelope = z.infer<typeof messageEnvelopeSchema>;
export type Message = z.infer<typeof messageSchema>;

export type DownloadRequest = z.infer<typeof downloadRequestSchema>;
export type DownloadCancel = z.infer<typeof downloadCancelSchema>;
export type CacheCheck = z.infer<typeof cacheCheckSchema>;

export type DownloadAccepted = z.infer<typeof downloadAcceptedSchema>;
export type DownloadProgress = z.infer<typeof downloadProgressSchema>;
export type DownloadCompleted = z.infer<typeof downloadCompletedSchema>;
export type DownloadFailed = z.infer<typeof downloadFailedSchema>;
export type DownloadRejected = z.infer<typeof downloadRejectedSchema>;
export type DownloadQueued = z.infer<typeof downloadQueuedSchema>;
export type CacheResult = z.infer<typeof cacheResultSchema>;

export type AgentHello = z.infer<typeof agentHelloSchema>;
export type AgentHeartbeat = z.infer<typeof agentHeartbeatSchema>;
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
