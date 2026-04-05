import { z } from "zod";

// ── Setup ──────────────────────────────────────────────────────

export const setupStatusResponseSchema = z.object({
  needsSetup: z.boolean(),
});

export const setupCompleteRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
  tmdbApiKey: z.string().min(1),
  rdApiKey: z.string().min(1),
  profileName: z.string().min(1),
  profileAvatar: z.string().optional(),
});

export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;
export type SetupCompleteRequest = z.infer<typeof setupCompleteRequestSchema>;

// ── Auth ───────────────────────────────────────────────────────

export const loginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string(),
});

export const logoutRequestSchema = z.object({
  refreshToken: z.string(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

// ── Profiles ───────────────────────────────────────────────────

export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  hasPin: z.boolean(),
  createdAt: z.string(),
});

export const createProfileRequestSchema = z.object({
  name: z.string().min(1),
  avatar: z.string().optional(),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
});

export const updateProfileRequestSchema = z.object({
  name: z.string().min(1).optional(),
  avatar: z.string().optional(),
  pin: z.string().regex(/^\d{4,6}$/).nullable().optional(),
});

export const selectProfileRequestSchema = z.object({
  pin: z.string().optional(),
});

export const profileSessionResponseSchema = z.object({
  token: z.string(),
  profile: profileSchema,
});

export type Profile = z.infer<typeof profileSchema>;
export type CreateProfileRequest = z.infer<typeof createProfileRequestSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type SelectProfileRequest = z.infer<typeof selectProfileRequestSchema>;
export type ProfileSessionResponse = z.infer<
  typeof profileSessionResponseSchema
>;

// ── Devices ────────────────────────────────────────────────────

export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: z.string(),
  isOnline: z.boolean(),
  isDefault: z.boolean(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
});

export const updateDeviceRequestSchema = z.object({
  name: z.string().min(1).optional(),
  isDefault: z.boolean().optional(),
});

export const pairRequestResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
});

export const pairClaimRequestSchema = z.object({
  code: z.string(),
  name: z.string(),
  platform: z.string(),
});

export const pairClaimResponseSchema = z.object({
  deviceId: z.string(),
  deviceToken: z.string(),
  rdApiKey: z.string(),
  wsUrl: z.string(),
});

export const agentConfigResponseSchema = z.object({
  rdApiKey: z.string(),
  relayVersion: z.string(),
});

export type Device = z.infer<typeof deviceSchema>;
export type UpdateDeviceRequest = z.infer<typeof updateDeviceRequestSchema>;
export type PairRequestResponse = z.infer<typeof pairRequestResponseSchema>;
export type PairClaimRequest = z.infer<typeof pairClaimRequestSchema>;
export type PairClaimResponse = z.infer<typeof pairClaimResponseSchema>;
export type AgentConfigResponse = z.infer<typeof agentConfigResponseSchema>;

// ── Instance Settings ──────────────────────────────────────────

export const instanceSettingsSchema = z.object({
  rdApiKey: z.string(),
  tmdbApiKey: z.string(),
});

export const updateSettingsRequestSchema = z.object({
  rdApiKey: z.string().optional(),
  tmdbApiKey: z.string().optional(),
});

export const testKeyResponseSchema = z.object({
  valid: z.boolean(),
  detail: z.string().optional(),
});

export type InstanceSettings = z.infer<typeof instanceSettingsSchema>;
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
export type TestKeyResponse = z.infer<typeof testKeyResponseSchema>;

// ── Search & Streams ───────────────────────────────────────────

export const searchResultSchema = z.object({
  tmdbId: z.number(),
  imdbId: z.string().nullable(),
  title: z.string(),
  year: z.number().nullable(),
  mediaType: z.enum(["movie", "tv"]),
  posterPath: z.string().nullable(),
  overview: z.string().nullable(),
});

export const streamSchema = z.object({
  title: z.string(),
  infoHash: z.string(),
  magnet: z.string(),
  size: z.number().nullable(),
  seeds: z.number().nullable(),
  resolution: z.string().nullable(),
  codec: z.string().nullable(),
  audio: z.string().nullable(),
  hdr: z.boolean().nullable(),
  source: z.string().nullable(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;
export type Stream = z.infer<typeof streamSchema>;

// ── Downloads ──────────────────────────────────────────────────

export const downloadHistoryItemSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  deviceId: z.string(),
  tmdbId: z.number(),
  imdbId: z.string(),
  title: z.string(),
  year: z.number(),
  mediaType: z.enum(["movie", "tv"]),
  season: z.number().nullable(),
  episode: z.number().nullable(),
  episodeTitle: z.string().nullable(),
  torrentName: z.string(),
  sizeBytes: z.number().nullable(),
  status: z.enum(["completed", "failed", "cancelled"]),
  error: z.string().nullable(),
  retryable: z.boolean().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const queuedDownloadSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  deviceId: z.string(),
  status: z.enum(["queued", "delivered", "cancelled", "expired"]),
  title: z.string(),
  createdAt: z.string(),
  deliveredAt: z.string().nullable(),
});

export type DownloadHistoryItem = z.infer<typeof downloadHistoryItemSchema>;
export type QueuedDownload = z.infer<typeof queuedDownloadSchema>;

// ── Recently Viewed ────────────────────────────────────────────

export const recentlyViewedSchema = z.object({
  id: z.string(),
  tmdbId: z.number(),
  mediaType: z.enum(["movie", "tv"]),
  title: z.string(),
  year: z.number(),
  posterPath: z.string().nullable(),
  imdbId: z.string().nullable(),
  viewedAt: z.string(),
});

export type RecentlyViewed = z.infer<typeof recentlyViewedSchema>;

// ── Health ─────────────────────────────────────────────────────

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
