# Phase 1: Shared Protocol & Types — Detailed Spec

> **Goal**: Define the contract between all components — every message type, API schema, and shared utility — so that relay, web, and agent can be built independently against a stable interface.

---

## Overview

Phase 1 establishes the **shared protocol layer** that every other phase depends on. This includes:

1. **Zod schemas** for all WebSocket message types (commands, events, system messages)
2. **Zod schemas** for all HTTP API request/response shapes
3. **Drizzle ORM table definitions** (9 tables with relations, constraints, indices)
4. **Utility functions** for IDs, timestamps, filenames, and Plex-compatible paths
5. **Database configuration** (`drizzle.config.ts`)
6. **Unit tests** for all schemas and utilities
7. **Barrel exports** in `shared/src/index.ts`

No HTTP endpoints or WebSocket handlers are implemented in Phase 1 — only the types and validation. The relay, web, and agent will import these types and use them in Phase 2+.

---

## 1. Dependencies to Add

Add these to `packages/shared/package.json` dependencies:

```jsonc
{
  "dependencies": {
    "zod": "~3.24.0",
    "ulid": "~2.3.0"
  },
  "devDependencies": {
    "drizzle-orm": "~0.45.0",
    "drizzle-kit": "~0.31.0",
    "@types/node": "~22.0.0",
    "pg": "~8.13.0"
  }
}
```

Add these to `packages/relay/package.json` dependencies:

```jsonc
{
  "dependencies": {
    "drizzle-orm": "~0.45.0",
    "pg": "~8.13.0",
    "@tadaima/shared": "workspace:*"
  },
  "devDependencies": {
    "drizzle-kit": "~0.31.0"
  }
}
```

Add these to `packages/agent/package.json` dependencies:

```jsonc
{
  "dependencies": {
    "@tadaima/shared": "workspace:*"
  }
}
```

---

## 2. Shared Package Structure

### 2.1 File Tree

```
packages/shared/
├── src/
│   ├── index.ts                   # Barrel export
│   ├── schemas/
│   │   ├── messages.ts            # WebSocket message schemas
│   │   ├── api.ts                 # HTTP API request/response schemas
│   │   └── index.ts               # Re-export schemas
│   ├── types/
│   │   ├── messages.ts            # Inferred types from message schemas
│   │   ├── api.ts                 # Inferred types from API schemas
│   │   └── index.ts               # Re-export types
│   ├── utils/
│   │   ├── ids.ts                 # ULID message ID generation
│   │   ├── timestamps.ts          # Unix millisecond timestamps
│   │   ├── filenames.ts           # sanitizeFilename utility
│   │   ├── paths.ts               # buildMoviePath, buildEpisodePath
│   │   └── index.ts               # Re-export utilities
│   └── db/
│       ├── schema.ts              # Drizzle ORM table definitions
│       └── index.ts               # Re-export schema
├── drizzle.config.ts              # Drizzle Kit configuration
├── __tests__/
│   ├── schemas.test.ts            # Unit tests for all schemas
│   ├── utils.test.ts              # Unit tests for utilities
│   └── fixtures.ts                # Reusable test data
├── package.json
└── tsconfig.json
```

---

## 3. Utility Functions

### 3.1 `packages/shared/src/utils/ids.ts`

```typescript
import { ulid } from "ulid";

/**
 * Generate a unique message ID using ULID.
 * ULIDs are sortable, URL-safe, and collision-resistant.
 */
export function createMessageId(): string {
  return ulid();
}
```

### 3.2 `packages/shared/src/utils/timestamps.ts`

```typescript
/**
 * Get the current time as Unix milliseconds.
 */
export function createTimestamp(): number {
  return Date.now();
}
```

### 3.3 `packages/shared/src/utils/filenames.ts`

```typescript
/**
 * Sanitize a filename for filesystem safety across all platforms.
 *
 * Rules:
 * - Remove illegal characters: < > " / \ | ? *
 * - Replace colons with " - " (to preserve semantics, e.g., "Title: Subtitle" → "Title - Subtitle")
 * - Collapse consecutive spaces to single space
 * - Trim leading/trailing dots, spaces, dashes
 *
 * Examples:
 *   "Hello: World" → "Hello - World"
 *   "File<Name>" → "FileName"
 *   "  Spaced  " → "Spaced"
 */
export function sanitizeFilename(name: string): string {
  // Remove illegal characters: < > " / \ | ? *
  let sanitized = name.replace(/[<>"\/\\|?*]/g, "");

  // Replace colons with " - "
  sanitized = sanitized.replace(/:/g, " - ");

  // Collapse consecutive spaces
  sanitized = sanitized.replace(/\s+/g, " ");

  // Trim leading/trailing dots, spaces, dashes
  sanitized = sanitized.replace(/^[\s.\-]+|[\s.\-]+$/g, "");

  return sanitized;
}
```

### 3.4 `packages/shared/src/utils/paths.ts`

```typescript
import { sanitizeFilename } from "./filenames";

/**
 * Build a Plex-compatible movie path.
 *
 * Format: "Title (Year) [tmdb-ID]/Title (Year).ext"
 *
 * Example:
 *   buildMoviePath("Interstellar", 2014, 157336, ".mkv")
 *   → "Interstellar (2014) [tmdb-157336]/Interstellar (2014).mkv"
 */
export function buildMoviePath(
  title: string,
  year: number,
  tmdbId: number,
  ext: string,
): string {
  const sanitized = sanitizeFilename(title);
  const folder = `${sanitized} (${year}) [tmdb-${tmdbId}]`;
  const file = `${sanitized} (${year})${ext}`;
  return `${folder}/${file}`;
}

/**
 * Build a Plex-compatible episode path.
 *
 * Format: "Title (Year) [tmdb-ID]/Season NN/S##E## - Episode Title.ext"
 *
 * Example:
 *   buildEpisodePath("Breaking Bad", 1396, 5, 16, "Felina", ".mkv")
 *   → "Breaking Bad [tmdb-1396]/Season 05/S05E16 - Felina.mkv"
 *
 * Note: Year is omitted for TV shows (Plex convention).
 */
export function buildEpisodePath(
  title: string,
  tmdbId: number,
  season: number,
  episode: number,
  episodeTitle: string,
  ext: string,
): string {
  const sanitizedTitle = sanitizeFilename(title);
  const sanitizedEpisodeTitle = sanitizeFilename(episodeTitle);

  const folder = `${sanitizedTitle} [tmdb-${tmdbId}]`;
  const seasonFolder = `Season ${String(season).padStart(2, "0")}`;
  const file = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")} - ${sanitizedEpisodeTitle}${ext}`;

  return `${folder}/${seasonFolder}/${file}`;
}
```

### 3.5 `packages/shared/src/utils/index.ts`

```typescript
export { createMessageId } from "./ids";
export { createTimestamp } from "./timestamps";
export { sanitizeFilename } from "./filenames";
export { buildMoviePath, buildEpisodePath } from "./paths";
```

---

## 4. Zod Schemas

### 4.1 `packages/shared/src/schemas/messages.ts`

This file defines Zod schemas for all WebSocket message types. **Every message type listed in the PROJECT_PLAN.md is included with complete field definitions.**

```typescript
import { z } from "zod";

/**
 * Base message envelope that all WebSocket messages inherit.
 */
export const WsMessageBaseSchema = z.object({
  id: z.string().min(1, "Message ID is required"),
  type: z.string().min(1, "Message type is required"),
  timestamp: z.number().int().positive("Timestamp must be positive"),
});

/**
 * COMMAND MESSAGES (web → relay → agent)
 */

export const DownloadRequestSchema = WsMessageBaseSchema.extend({
  type: z.literal("download:request"),
  payload: z.object({
    tmdbId: z.number().int().positive("TMDB ID must be positive"),
    imdbId: z.string().min(1, "IMDB ID is required"),
    title: z.string().min(1, "Title is required"),
    year: z.number().int().min(1800).max(2100, "Year must be realistic"),
    mediaType: z.enum(["movie", "tv"], {
      errorMap: () => ({ message: "mediaType must be 'movie' or 'tv'" }),
    }),
    season: z.number().int().nonnegative().optional(),
    episode: z.number().int().nonnegative().optional(),
    episodeTitle: z.string().optional(),
    magnet: z.string().url("Magnet must be a valid URL").startsWith("magnet:", {
      message: "Magnet must start with 'magnet:'",
    }),
    torrentName: z.string().min(1, "Torrent name is required"),
    expectedSize: z.number().nonnegative("Expected size must be non-negative"),
  }),
});

export const DownloadCancelSchema = WsMessageBaseSchema.extend({
  type: z.literal("download:cancel"),
  payload: z.object({
    jobId: z.string().min(1, "Job ID is required"),
  }),
});

export const CacheCheckSchema = WsMessageBaseSchema.extend({
  type: z.literal("cache:check"),
  payload: z.object({
    requestId: z.string().min(1, "Request ID is required"),
    infoHashes: z.array(z.string().min(1)).min(1, "At least one info hash required"),
  }),
});

/**
 * EVENT MESSAGES (agent → relay → web)
 */

export const DownloadAcceptedSchema = WsMessageBaseSchema.extend({
  type: z.literal("download:accepted"),
  payload: z.object({
    jobId: z.string().min(1, "Job ID is required"),
    requestId: z.string().min(1, "Request ID is required"),
  }),
});

export const DownloadProgressSchema = WsMessageBaseSchema.extend({
  type: z.literal("download:progress"),
  payload: z.object({
    jobId: z.string().min(1, "Job ID is required"),
    phase: z.enum(["adding", "waiting", "unrestricting", "downloading", "organizing"], {
      errorMap: () => ({
        message:
          "phase must be one of: adding, waiting, unrestricting, downloading, organizing",
      }),
    }),
    progress: z.number().int().min(0).max(100, "Progress must be 0-100"),
    downloadedBytes: z.number().nonnegative().optional(),
    totalBytes: z.number().nonnegative().optional(),
    speedBps: z.number().nonnegative().optional(),
    eta: z.number().nonnegative().optional(),
  }),
});

export const DownloadCompletedSchema = WsMessageBaseSchema.extend({
  type: z.literal("download:completed"),
  payload: z.object({
    jobId: z.string().min(1, "Job ID is required"),
    filePath: z.string().min(1, "File path is required"),
    finalSize: z.number().positive("Final size must be positive"),
  }),
});

export const DownloadFailedSchema = WsMessageBaseSchema.extend({
  type: z.literal("download:failed"),
  payload: z.object({
    jobId: z.string().min(1, "Job ID is required"),
    error: z.string().min(1, "Error message is required"),
    phase: z.string().min(1, "Phase is required"),
    retryable: z.boolean(),
  }),
});

export const DownloadRejectedSchema = WsMessageBaseSchema.extend({
  type: z.literal("download:rejected"),
  payload: z.object({
    requestId: z.string().min(1, "Request ID is required"),
    reason: z.string().min(1, "Reason is required"),
  }),
});

export const DownloadQueuedSchema = WsMessageBaseSchema.extend({
  type: z.literal("download:queued"),
  payload: z.object({
    queueId: z.string().min(1, "Queue ID is required"),
    requestId: z.string().min(1, "Request ID is required"),
    title: z.string().min(1, "Title is required"),
    deviceName: z.string().min(1, "Device name is required"),
  }),
});

export const CacheResultSchema = WsMessageBaseSchema.extend({
  type: z.literal("cache:result"),
  payload: z.object({
    requestId: z.string().min(1, "Request ID is required"),
    cached: z.record(z.string(), z.boolean()),
  }),
});

/**
 * SYSTEM MESSAGES
 */

export const AgentHelloSchema = WsMessageBaseSchema.extend({
  type: z.literal("agent:hello"),
  payload: z.object({
    version: z.string().min(1, "Version is required"),
    platform: z.enum(["windows", "macos", "linux", "docker"], {
      errorMap: () => ({
        message: "platform must be one of: windows, macos, linux, docker",
      }),
    }),
    activeJobs: z.number().nonnegative("Active jobs must be non-negative"),
    diskFreeBytes: z.number().nonnegative("Disk free must be non-negative"),
  }),
});

export const AgentHeartbeatSchema = WsMessageBaseSchema.extend({
  type: z.literal("agent:heartbeat"),
  payload: z.object({
    activeJobs: z.number().nonnegative("Active jobs must be non-negative"),
    diskFreeBytes: z.number().nonnegative("Disk free must be non-negative"),
    uptimeSeconds: z.number().nonnegative("Uptime must be non-negative"),
  }),
});

export const DeviceStatusSchema = WsMessageBaseSchema.extend({
  type: z.literal("device:status"),
  payload: z.object({
    deviceId: z.string().min(1, "Device ID is required"),
    isOnline: z.boolean(),
    lastSeenAt: z.number().int().positive("Last seen timestamp must be positive"),
  }),
});

export const ErrorMessageSchema = WsMessageBaseSchema.extend({
  type: z.literal("error"),
  payload: z.object({
    code: z.string().min(1, "Error code is required"),
    detail: z.string().min(1, "Error detail is required"),
    originalMessageId: z.string().optional(),
  }),
});

/**
 * Union type of all valid WebSocket messages.
 */
export const WsMessageSchema = z.union([
  DownloadRequestSchema,
  DownloadCancelSchema,
  CacheCheckSchema,
  DownloadAcceptedSchema,
  DownloadProgressSchema,
  DownloadCompletedSchema,
  DownloadFailedSchema,
  DownloadRejectedSchema,
  DownloadQueuedSchema,
  CacheResultSchema,
  AgentHelloSchema,
  AgentHeartbeatSchema,
  DeviceStatusSchema,
  ErrorMessageSchema,
]);
```

### 4.2 `packages/shared/src/schemas/api.ts`

This file defines Zod schemas for HTTP API request/response shapes.

```typescript
import { z } from "zod";

/**
 * Standard error response envelope.
 */
export const ErrorEnvelopeSchema = z.object({
  error: z.string().min(1, "Error message is required"),
  detail: z.string().optional(),
});

/**
 * ADMIN AUTH ENDPOINTS
 */

export const AdminCreateRequestSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(50),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
});

export const AdminLoginRequestSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const AdminLoginResponseSchema = z.object({
  accessToken: z.string().min(1, "Access token is required"),
  refreshToken: z.string().min(1, "Refresh token is required"),
  expiresIn: z.number().positive("Expires in must be positive (seconds)"),
});

export const AdminRefreshRequestSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

/**
 * PROFILE ENDPOINTS
 */

export const ProfileCreateRequestSchema = z.object({
  name: z.string().min(1, "Profile name is required").max(50),
  avatar: z.string().optional(),
  pin: z
    .string()
    .regex(/^\d{4,6}$/, "PIN must be 4-6 digits")
    .optional(),
});

export const ProfileResponseSchema = z.object({
  id: z.string().uuid("Profile ID must be a valid UUID"),
  name: z.string(),
  avatar: z.string().nullable(),
  pinHash: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const ProfileListResponseSchema = z.array(ProfileResponseSchema);

export const ProfileSelectRequestSchema = z.object({
  profileId: z.string().uuid("Profile ID must be a valid UUID"),
  pin: z.string().optional(),
});

export const ProfileSelectResponseSchema = z.object({
  accessToken: z.string().min(1, "Access token is required"),
  expiresIn: z.number().positive("Expires in must be positive (seconds)"),
});

/**
 * INSTANCE SETTINGS ENDPOINTS
 */

export const InstanceSettingsUpdateRequestSchema = z.object({
  rdApiKey: z.string().min(1, "Real-Debrid API key is required").optional(),
  tmdbApiKey: z.string().min(1, "TMDB API key is required").optional(),
});

export const InstanceSettingsResponseSchema = z.object({
  rdApiKeyConfigured: z.boolean(),
  tmdbApiKeyConfigured: z.boolean(),
});

/**
 * DEVICE PAIRING ENDPOINTS
 */

export const DevicePairRequestResponseSchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{6}$/, "Pairing code must be 6 alphanumeric characters"),
  expiresAt: z.number().int().positive("Expiry timestamp must be positive"),
});

export const DevicePairClaimRequestSchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{6}$/, "Pairing code must be 6 characters"),
  name: z.string().min(1, "Device name is required").max(50),
  platform: z.enum(["windows", "macos", "linux", "docker"]),
});

export const DevicePairClaimResponseSchema = z.object({
  deviceId: z.string().uuid("Device ID must be a valid UUID"),
  deviceToken: z.string().min(1, "Device token is required"),
  rdApiKey: z.string().min(1, "Real-Debrid API key is required"),
  wsUrl: z.string().url("WebSocket URL must be valid"),
});

/**
 * DEVICE MANAGEMENT ENDPOINTS
 */

export const DeviceResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: z.enum(["windows", "macos", "linux", "docker"]),
  isOnline: z.boolean(),
  isDefault: z.boolean(),
  lastSeenAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});

export const DeviceListResponseSchema = z.array(DeviceResponseSchema);

export const DeviceUpdateRequestSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  isDefault: z.boolean().optional(),
});

/**
 * SEARCH ENDPOINTS
 */

export const TmdbSearchResultSchema = z.object({
  tmdbId: z.number().int().positive(),
  imdbId: z.string().nullable(),
  title: z.string(),
  mediaType: z.enum(["movie", "tv"]),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  overview: z.string().nullable(),
});

export const SearchResponseSchema = z.array(TmdbSearchResultSchema);

export const MediaDetailsSchema = z.object({
  tmdbId: z.number().int().positive(),
  imdbId: z.string().nullable(),
  title: z.string(),
  mediaType: z.enum(["movie", "tv"]),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  overview: z.string().nullable(),
  runtime: z.number().int().nullable(),
  genres: z.array(z.string()),
  seasons: z
    .array(
      z.object({
        seasonNumber: z.number().int().nonnegative(),
        episodeCount: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});

/**
 * STREAM ENDPOINTS
 */

export const StreamOptionSchema = z.object({
  name: z.string(),
  seeders: z.number().nonnegative(),
  leechers: z.number().nonnegative(),
  size: z.number().nonnegative(),
  magnet: z.string().url().startsWith("magnet:"),
});

export const StreamResultSchema = z.object({
  imdbId: z.string(),
  streams: z.array(StreamOptionSchema),
});

/**
 * DOWNLOAD QUEUE ENDPOINTS
 */

export const QueueItemResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  mediaType: z.enum(["movie", "tv"]),
  season: z.number().int().nonnegative().nullable(),
  episode: z.number().int().nonnegative().nullable(),
  status: z.enum(["queued", "delivered", "cancelled", "expired"]),
  createdAt: z.number().int(),
  deliveredAt: z.number().int().nullable(),
});

export const QueueListResponseSchema = z.array(QueueItemResponseSchema);

/**
 * DOWNLOAD HISTORY ENDPOINTS
 */

export const HistoryItemResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  mediaType: z.enum(["movie", "tv"]),
  season: z.number().int().nonnegative().nullable(),
  episode: z.number().int().nonnegative().nullable(),
  status: z.enum(["completed", "failed", "cancelled"]),
  sizeBytes: z.number().nonnegative(),
  error: z.string().nullable(),
  startedAt: z.number().int(),
  completedAt: z.number().int().nullable(),
});

export const HistoryListResponseSchema = z.array(HistoryItemResponseSchema);

/**
 * RECENTLY VIEWED ENDPOINTS
 */

export const RecentlyViewedItemSchema = z.object({
  tmdbId: z.number().int().positive(),
  title: z.string(),
  mediaType: z.enum(["movie", "tv"]),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  imdbId: z.string().nullable(),
  viewedAt: z.number().int(),
});

export const RecentlyViewedListResponseSchema = z.array(RecentlyViewedItemSchema);

export const RecentlyViewedAddRequestSchema = z.object({
  tmdbId: z.number().int().positive(),
  title: z.string(),
  mediaType: z.enum(["movie", "tv"]),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  imdbId: z.string().nullable(),
});

/**
 * SETUP STATUS ENDPOINT
 */

export const SetupStatusResponseSchema = z.object({
  needsSetup: z.boolean(),
});
```

### 4.3 `packages/shared/src/schemas/index.ts`

```typescript
export * from "./messages";
export * from "./api";
```

---

## 5. TypeScript Type Inference

### 5.1 `packages/shared/src/types/messages.ts`

```typescript
import { z } from "zod";
import {
  WsMessageSchema,
  DownloadRequestSchema,
  DownloadCancelSchema,
  CacheCheckSchema,
  DownloadAcceptedSchema,
  DownloadProgressSchema,
  DownloadCompletedSchema,
  DownloadFailedSchema,
  DownloadRejectedSchema,
  DownloadQueuedSchema,
  CacheResultSchema,
  AgentHelloSchema,
  AgentHeartbeatSchema,
  DeviceStatusSchema,
  ErrorMessageSchema,
} from "../schemas/messages";

// Infer TypeScript types from Zod schemas
export type WsMessage = z.infer<typeof WsMessageSchema>;
export type DownloadRequest = z.infer<typeof DownloadRequestSchema>;
export type DownloadCancel = z.infer<typeof DownloadCancelSchema>;
export type CacheCheck = z.infer<typeof CacheCheckSchema>;
export type DownloadAccepted = z.infer<typeof DownloadAcceptedSchema>;
export type DownloadProgress = z.infer<typeof DownloadProgressSchema>;
export type DownloadCompleted = z.infer<typeof DownloadCompletedSchema>;
export type DownloadFailed = z.infer<typeof DownloadFailedSchema>;
export type DownloadRejected = z.infer<typeof DownloadRejectedSchema>;
export type DownloadQueued = z.infer<typeof DownloadQueuedSchema>;
export type CacheResult = z.infer<typeof CacheResultSchema>;
export type AgentHello = z.infer<typeof AgentHelloSchema>;
export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
```

### 5.2 `packages/shared/src/types/api.ts`

```typescript
import { z } from "zod";
import {
  ErrorEnvelopeSchema,
  AdminCreateRequestSchema,
  AdminLoginRequestSchema,
  AdminLoginResponseSchema,
  AdminRefreshRequestSchema,
  ProfileCreateRequestSchema,
  ProfileResponseSchema,
  ProfileListResponseSchema,
  ProfileSelectRequestSchema,
  ProfileSelectResponseSchema,
  InstanceSettingsUpdateRequestSchema,
  InstanceSettingsResponseSchema,
  DevicePairRequestResponseSchema,
  DevicePairClaimRequestSchema,
  DevicePairClaimResponseSchema,
  DeviceResponseSchema,
  DeviceListResponseSchema,
  DeviceUpdateRequestSchema,
  TmdbSearchResultSchema,
  SearchResponseSchema,
  MediaDetailsSchema,
  StreamOptionSchema,
  StreamResultSchema,
  QueueItemResponseSchema,
  QueueListResponseSchema,
  HistoryItemResponseSchema,
  HistoryListResponseSchema,
  RecentlyViewedItemSchema,
  RecentlyViewedListResponseSchema,
  RecentlyViewedAddRequestSchema,
  SetupStatusResponseSchema,
} from "../schemas/api";

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type AdminCreateRequest = z.infer<typeof AdminCreateRequestSchema>;
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;
export type AdminLoginResponse = z.infer<typeof AdminLoginResponseSchema>;
export type AdminRefreshRequest = z.infer<typeof AdminRefreshRequestSchema>;
export type ProfileCreateRequest = z.infer<typeof ProfileCreateRequestSchema>;
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
export type ProfileListResponse = z.infer<typeof ProfileListResponseSchema>;
export type ProfileSelectRequest = z.infer<typeof ProfileSelectRequestSchema>;
export type ProfileSelectResponse = z.infer<typeof ProfileSelectResponseSchema>;
export type InstanceSettingsUpdateRequest = z.infer<typeof InstanceSettingsUpdateRequestSchema>;
export type InstanceSettingsResponse = z.infer<typeof InstanceSettingsResponseSchema>;
export type DevicePairRequestResponse = z.infer<typeof DevicePairRequestResponseSchema>;
export type DevicePairClaimRequest = z.infer<typeof DevicePairClaimRequestSchema>;
export type DevicePairClaimResponse = z.infer<typeof DevicePairClaimResponseSchema>;
export type DeviceResponse = z.infer<typeof DeviceResponseSchema>;
export type DeviceListResponse = z.infer<typeof DeviceListResponseSchema>;
export type DeviceUpdateRequest = z.infer<typeof DeviceUpdateRequestSchema>;
export type TmdbSearchResult = z.infer<typeof TmdbSearchResultSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type MediaDetails = z.infer<typeof MediaDetailsSchema>;
export type StreamOption = z.infer<typeof StreamOptionSchema>;
export type StreamResult = z.infer<typeof StreamResultSchema>;
export type QueueItemResponse = z.infer<typeof QueueItemResponseSchema>;
export type QueueListResponse = z.infer<typeof QueueListResponseSchema>;
export type HistoryItemResponse = z.infer<typeof HistoryItemResponseSchema>;
export type HistoryListResponse = z.infer<typeof HistoryListResponseSchema>;
export type RecentlyViewedItem = z.infer<typeof RecentlyViewedItemSchema>;
export type RecentlyViewedListResponse = z.infer<typeof RecentlyViewedListResponseSchema>;
export type RecentlyViewedAddRequest = z.infer<typeof RecentlyViewedAddRequestSchema>;
export type SetupStatusResponse = z.infer<typeof SetupStatusResponseSchema>;
```

### 5.3 `packages/shared/src/types/index.ts`

```typescript
export * from "./messages";
export * from "./api";
```

---

## 6. Drizzle ORM Schema

### 6.1 `packages/shared/src/db/schema.ts`

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  foreignKey,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Admin account — one per instance.
 */
export const admin = pgTable(
  "admin",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    usernameIdx: uniqueIndex("admin_username_idx").on(table.username),
  }),
);

/**
 * Instance-level settings (encrypted values for sensitive keys).
 */
export const instanceSettings = pgTable("instance_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Profiles — Netflix-style identity within the instance.
 */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    avatar: text("avatar"),
    pinHash: text("pin_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nameIdx: index("profiles_name_idx").on(table.name),
  }),
);

/**
 * Refresh tokens for admin and profile sessions.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id"),
    adminId: uuid("admin_id"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    profileIdFk: foreignKey({
      columns: [table.profileId],
      foreignColumns: [profiles.id],
      name: "refresh_tokens_profile_id_fk",
    }),
    adminIdFk: foreignKey({
      columns: [table.adminId],
      foreignColumns: [admin.id],
      name: "refresh_tokens_admin_id_fk",
    }),
    profileIdIdx: index("refresh_tokens_profile_id_idx").on(table.profileId),
    adminIdIdx: index("refresh_tokens_admin_id_idx").on(table.adminId),
    expiresAtIdx: index("refresh_tokens_expires_at_idx").on(table.expiresAt),
  }),
);

/**
 * Paired devices (agents).
 */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").notNull(),
    name: text("name").notNull(),
    platform: text("platform").notNull(), // windows, macos, linux, docker
    tokenHash: text("token_hash").notNull(),
    isOnline: boolean("is_online").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    profileIdFk: foreignKey({
      columns: [table.profileId],
      foreignColumns: [profiles.id],
      name: "devices_profile_id_fk",
    }),
    profileIdIdx: index("devices_profile_id_idx").on(table.profileId),
    isOnlineIdx: index("devices_is_online_idx").on(table.isOnline),
  }),
);

/**
 * Pairing codes — ephemeral, 6 characters, 10-minute expiry.
 */
export const pairingCodes = pgTable(
  "pairing_codes",
  {
    code: text("code").primaryKey(), // 6-char alphanumeric
    profileId: uuid("profile_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimed: boolean("claimed").notNull().default(false),
    deviceId: uuid("device_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    profileIdFk: foreignKey({
      columns: [table.profileId],
      foreignColumns: [profiles.id],
      name: "pairing_codes_profile_id_fk",
    }),
    deviceIdFk: foreignKey({
      columns: [table.deviceId],
      foreignColumns: [devices.id],
      name: "pairing_codes_device_id_fk",
    }),
    profileIdIdx: index("pairing_codes_profile_id_idx").on(table.profileId),
    expiresAtIdx: index("pairing_codes_expires_at_idx").on(table.expiresAt),
    claimedIdx: index("pairing_codes_claimed_idx").on(table.claimed),
  }),
);

/**
 * Download queue — stores requests when device is offline.
 */
export const downloadQueue = pgTable(
  "download_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    payload: jsonb("payload").notNull(), // full download:request message payload
    status: text("status").notNull().default("queued"), // queued, delivered, cancelled, expired
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => ({
    profileIdFk: foreignKey({
      columns: [table.profileId],
      foreignColumns: [profiles.id],
      name: "download_queue_profile_id_fk",
    }),
    deviceIdFk: foreignKey({
      columns: [table.deviceId],
      foreignColumns: [devices.id],
      name: "download_queue_device_id_fk",
    }),
    profileIdIdx: index("download_queue_profile_id_idx").on(table.profileId),
    deviceIdIdx: index("download_queue_device_id_idx").on(table.deviceId),
    statusIdx: index("download_queue_status_idx").on(table.status),
    createdAtIdx: index("download_queue_created_at_idx").on(table.createdAt),
  }),
);

/**
 * Download history — completed, failed, and cancelled downloads.
 */
export const downloadHistory = pgTable(
  "download_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    imdbId: text("imdb_id"),
    title: text("title").notNull(),
    year: integer("year"),
    mediaType: text("media_type").notNull(), // movie, tv
    season: integer("season"),
    episode: integer("episode"),
    episodeTitle: text("episode_title"),
    magnet: text("magnet").notNull(), // stored for seamless retry
    torrentName: text("torrent_name").notNull(),
    expectedSize: bigint("expected_size", { mode: "number" }).notNull(), // stored for retry
    sizeBytes: bigint("size_bytes", { mode: "number" }), // actual final size (null until completed)
    status: text("status").notNull(), // completed, failed, cancelled
    error: text("error"),
    retryable: boolean("retryable"), // whether a failed download can be retried
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    profileIdFk: foreignKey({
      columns: [table.profileId],
      foreignColumns: [profiles.id],
      name: "download_history_profile_id_fk",
    }),
    deviceIdFk: foreignKey({
      columns: [table.deviceId],
      foreignColumns: [devices.id],
      name: "download_history_device_id_fk",
    }),
    profileIdIdx: index("download_history_profile_id_idx").on(table.profileId),
    deviceIdIdx: index("download_history_device_id_idx").on(table.deviceId),
    tmdbIdIdx: index("download_history_tmdb_id_idx").on(table.tmdbId),
    statusIdx: index("download_history_status_idx").on(table.status),
    completedAtIdx: index("download_history_completed_at_idx").on(table.completedAt),
  }),
);

/**
 * Recently viewed titles — track viewing history per profile.
 */
export const recentlyViewed = pgTable(
  "recently_viewed",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    mediaType: text("media_type").notNull(), // movie, tv
    title: text("title").notNull(),
    year: integer("year"),
    posterPath: text("poster_path"),
    imdbId: text("imdb_id"),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    profileIdFk: foreignKey({
      columns: [table.profileId],
      foreignColumns: [profiles.id],
      name: "recently_viewed_profile_id_fk",
    }),
    profileIdIdx: index("recently_viewed_profile_id_idx").on(table.profileId),
    profileIdTmdbIdIdx: index("recently_viewed_profile_id_tmdb_id_idx").on(
      table.profileId,
      table.tmdbId,
    ),
    viewedAtIdx: index("recently_viewed_viewed_at_idx").on(table.viewedAt),
  }),
);

/**
 * Relations — define foreign key relationships for easy traversal.
 */
export const adminRelations = relations(admin, ({ many }) => ({
  refreshTokens: many(refreshTokens),
}));

export const profilesRelations = relations(profiles, ({ many }) => ({
  refreshTokens: many(refreshTokens),
  devices: many(devices),
  pairingCodes: many(pairingCodes),
  downloadQueue: many(downloadQueue),
  downloadHistory: many(downloadHistory),
  recentlyViewed: many(recentlyViewed),
}));

export const devicesRelations = relations(devices, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [devices.profileId],
    references: [profiles.id],
  }),
  pairingCodes: many(pairingCodes),
  downloadQueue: many(downloadQueue),
  downloadHistory: many(downloadHistory),
}));

export const pairingCodesRelations = relations(pairingCodes, ({ one }) => ({
  profile: one(profiles, {
    fields: [pairingCodes.profileId],
    references: [profiles.id],
  }),
  device: one(devices, {
    fields: [pairingCodes.deviceId],
    references: [devices.id],
  }),
}));

export const downloadQueueRelations = relations(downloadQueue, ({ one }) => ({
  profile: one(profiles, {
    fields: [downloadQueue.profileId],
    references: [profiles.id],
  }),
  device: one(devices, {
    fields: [downloadQueue.deviceId],
    references: [devices.id],
  }),
}));

export const downloadHistoryRelations = relations(downloadHistory, ({ one }) => ({
  profile: one(profiles, {
    fields: [downloadHistory.profileId],
    references: [profiles.id],
  }),
  device: one(devices, {
    fields: [downloadHistory.deviceId],
    references: [devices.id],
  }),
}));

export const recentlyViewedRelations = relations(recentlyViewed, ({ one }) => ({
  profile: one(profiles, {
    fields: [recentlyViewed.profileId],
    references: [profiles.id],
  }),
}));
```

### 6.2 `packages/shared/src/db/index.ts`

```typescript
export * from "./schema";
```

---

## 7. Drizzle Configuration

### 7.1 `packages/shared/drizzle.config.ts`

> **✅ RESOLVED**: The Drizzle config lives in `packages/shared/`, co-located with the schema definitions. The relay references it when running migrations. This keeps all database-related definitions in one place.

```typescript
import type { Config } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  driver: "pg",
  dbCredentials: {
    connectionString: databaseUrl,
  },
  migrations: {
    prefix: "timestamp",
  },
} satisfies Config;
```

---

## 8. Root Package.json Scripts

Add these scripts to the root `package.json`:

```jsonc
{
  "scripts": {
    "db:generate": "drizzle-kit generate --config packages/shared/drizzle.config.ts",
    "db:migrate": "tsx packages/relay/src/db/migrate.ts",
    "db:push": "drizzle-kit push --config packages/shared/drizzle.config.ts"
  }
}
```

---

## 9. Relay Migration Runner

Create this file to run migrations from the relay package:

### 9.1 `packages/relay/src/db/migrate.ts`

```typescript
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../../../shared/drizzle");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql);

console.log("Running migrations from", migrationsFolder);

await migrate(db, {
  migrationsFolder,
})
  .then(() => {
    console.log("Migrations completed successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
```

---

## 10. Barrel Export

### 10.1 `packages/shared/src/index.ts`

```typescript
// Message types and schemas
export * from "./schemas/messages";
export * from "./types/messages";

// API types and schemas
export * from "./schemas/api";
export * from "./types/api";

// Utilities
export { createMessageId, createTimestamp, sanitizeFilename, buildMoviePath, buildEpisodePath } from "./utils";

// Database schema
export * from "./db/schema";
```

---

## 11. Unit Tests

### 11.1 `packages/shared/__tests__/schemas.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  DownloadRequestSchema,
  DownloadProgressSchema,
  AgentHelloSchema,
  AdminLoginRequestSchema,
  ProfileCreateRequestSchema,
  DevicePairClaimRequestSchema,
  SearchResponseSchema,
} from "../src/schemas";

describe("WebSocket Message Schemas", () => {
  describe("DownloadRequestSchema", () => {
    it("should parse a valid download request", () => {
      const valid = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "download:request",
        timestamp: Date.now(),
        payload: {
          tmdbId: 157336,
          imdbId: "tt0816692",
          title: "Interstellar",
          year: 2014,
          mediaType: "movie",
          magnet: "magnet:?xt=urn:btih:...",
          torrentName: "Interstellar.2014.1080p",
          expectedSize: 5368709120,
        },
      };
      const result = DownloadRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject invalid magnet URL", () => {
      const invalid = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "download:request",
        timestamp: Date.now(),
        payload: {
          tmdbId: 157336,
          imdbId: "tt0816692",
          title: "Interstellar",
          year: 2014,
          mediaType: "movie",
          magnet: "http://not-a-magnet",
          torrentName: "Interstellar.2014.1080p",
          expectedSize: 5368709120,
        },
      };
      const result = DownloadRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid media type", () => {
      const invalid = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "download:request",
        timestamp: Date.now(),
        payload: {
          tmdbId: 157336,
          imdbId: "tt0816692",
          title: "Interstellar",
          year: 2014,
          mediaType: "invalid",
          magnet: "magnet:?xt=urn:btih:...",
          torrentName: "Interstellar.2014.1080p",
          expectedSize: 5368709120,
        },
      };
      const result = DownloadRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
      const invalid = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "download:request",
        timestamp: Date.now(),
        payload: {
          tmdbId: 157336,
          // missing imdbId, title, year, mediaType, magnet, torrentName, expectedSize
        },
      };
      const result = DownloadRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should parse TV episode download request", () => {
      const valid = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "download:request",
        timestamp: Date.now(),
        payload: {
          tmdbId: 1396,
          imdbId: "tt0903747",
          title: "Breaking Bad",
          year: 2008,
          mediaType: "tv",
          season: 5,
          episode: 16,
          episodeTitle: "Felina",
          magnet: "magnet:?xt=urn:btih:...",
          torrentName: "Breaking.Bad.S05E16.1080p",
          expectedSize: 1932735283,
        },
      };
      const result = DownloadRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe("DownloadProgressSchema", () => {
    it("should parse valid progress update", () => {
      const valid = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "download:progress",
        timestamp: Date.now(),
        payload: {
          jobId: "job-123",
          phase: "downloading",
          progress: 45,
          downloadedBytes: 2147483648,
          totalBytes: 4294967296,
          speedBps: 20971520,
          eta: 600,
        },
      };
      const result = DownloadProgressSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject invalid phase", () => {
      const invalid = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "download:progress",
        timestamp: Date.now(),
        payload: {
          jobId: "job-123",
          phase: "invalid",
          progress: 45,
        },
      };
      const result = DownloadProgressSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject progress > 100", () => {
      const invalid = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "download:progress",
        timestamp: Date.now(),
        payload: {
          jobId: "job-123",
          phase: "downloading",
          progress: 150,
        },
      };
      const result = DownloadProgressSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("AgentHelloSchema", () => {
    it("should parse valid agent hello", () => {
      const valid = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "agent:hello",
        timestamp: Date.now(),
        payload: {
          version: "1.0.0",
          platform: "linux",
          activeJobs: 2,
          diskFreeBytes: 1099511627776,
        },
      };
      const result = AgentHelloSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject invalid platform", () => {
      const invalid = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "agent:hello",
        timestamp: Date.now(),
        payload: {
          version: "1.0.0",
          platform: "bsd",
          activeJobs: 2,
          diskFreeBytes: 1099511627776,
        },
      };
      const result = AgentHelloSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});

describe("API Request Schemas", () => {
  describe("AdminLoginRequestSchema", () => {
    it("should parse valid login request", () => {
      const valid = {
        username: "admin",
        password: "securepassword123",
      };
      const result = AdminLoginRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject password < 8 characters", () => {
      const invalid = {
        username: "admin",
        password: "short",
      };
      const result = AdminLoginRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("ProfileCreateRequestSchema", () => {
    it("should parse valid profile creation", () => {
      const valid = {
        name: "Noah",
        avatar: "red",
      };
      const result = ProfileCreateRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should parse with PIN", () => {
      const valid = {
        name: "Noah",
        avatar: "red",
        pin: "1234",
      };
      const result = ProfileCreateRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject PIN < 4 digits", () => {
      const invalid = {
        name: "Noah",
        pin: "123",
      };
      const result = ProfileCreateRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject PIN > 6 digits", () => {
      const invalid = {
        name: "Noah",
        pin: "1234567",
      };
      const result = ProfileCreateRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject non-numeric PIN", () => {
      const invalid = {
        name: "Noah",
        pin: "123a",
      };
      const result = ProfileCreateRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("DevicePairClaimRequestSchema", () => {
    it("should parse valid pairing claim", () => {
      const valid = {
        code: "ABC123",
        name: "Home NAS",
        platform: "linux",
      };
      const result = DevicePairClaimRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject code != 6 characters", () => {
      const invalid = {
        code: "ABCD",
        name: "Home NAS",
        platform: "linux",
      };
      const result = DevicePairClaimRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid platform", () => {
      const invalid = {
        code: "ABC123",
        name: "Home NAS",
        platform: "bsd",
      };
      const result = DevicePairClaimRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("SearchResponseSchema", () => {
    it("should parse valid search results", () => {
      const valid = [
        {
          tmdbId: 157336,
          imdbId: "tt0816692",
          title: "Interstellar",
          mediaType: "movie",
          year: 2014,
          posterPath: "/example.jpg",
          overview: "A epic sci-fi movie",
        },
        {
          tmdbId: 1396,
          imdbId: "tt0903747",
          title: "Breaking Bad",
          mediaType: "tv",
          year: 2008,
          posterPath: "/example2.jpg",
          overview: "A TV series",
        },
      ];
      const result = SearchResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should allow nullable optional fields", () => {
      const valid = [
        {
          tmdbId: 157336,
          imdbId: null,
          title: "Interstellar",
          mediaType: "movie",
          year: null,
          posterPath: null,
          overview: null,
        },
      ];
      const result = SearchResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });
});
```

### 11.2 `packages/shared/__tests__/utils.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  createMessageId,
  createTimestamp,
  sanitizeFilename,
  buildMoviePath,
  buildEpisodePath,
} from "../src/utils";

describe("Utility Functions", () => {
  describe("createMessageId", () => {
    it("should generate a valid ULID", () => {
      const id = createMessageId();
      expect(typeof id).toBe("string");
      expect(id.length).toBe(26); // ULID is always 26 characters
      expect(/^[A-Z0-9]+$/.test(id)).toBe(true);
    });

    it("should generate unique IDs", () => {
      const id1 = createMessageId();
      const id2 = createMessageId();
      expect(id1).not.toBe(id2);
    });
  });

  describe("createTimestamp", () => {
    it("should return current time in ms", () => {
      const before = Date.now();
      const ts = createTimestamp();
      const after = Date.now();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("should return integer", () => {
      const ts = createTimestamp();
      expect(Number.isInteger(ts)).toBe(true);
    });
  });

  describe("sanitizeFilename", () => {
    it("should remove illegal characters", () => {
      expect(sanitizeFilename('Hello<World>Test')).toBe("HelloWorldTest");
      expect(sanitizeFilename('File"Name.txt')).toBe("FileName.txt");
      expect(sanitizeFilename("Name|With/Illegal\\Chars")).toBe("NameWithIllegalChars");
      expect(sanitizeFilename("Question?Mark*Asterisk")).toBe("QuestionMarkAsterisk");
    });

    it("should replace colons with dashes", () => {
      expect(sanitizeFilename("Title: Subtitle")).toBe("Title - Subtitle");
      expect(sanitizeFilename("Multiple: Colons: Here")).toBe("Multiple - Colons - Here");
    });

    it("should collapse spaces", () => {
      expect(sanitizeFilename("Multiple   Spaces")).toBe("Multiple Spaces");
      expect(sanitizeFilename("  Leading and trailing  ")).toBe("Leading and trailing");
    });

    it("should trim leading/trailing dots and dashes", () => {
      expect(sanitizeFilename("...Filename...")).toBe("Filename");
      expect(sanitizeFilename("---Filename---")).toBe("Filename");
      expect(sanitizeFilename("...---Mixed---...")).toBe("Mixed");
    });

    it("should handle complex case", () => {
      expect(sanitizeFilename('  "Movie: The <Reboot>" (2024)  ')).toBe(
        "Movie - The Reboot (2024)",
      );
    });
  });

  describe("buildMoviePath", () => {
    it("should build valid movie path", () => {
      const path = buildMoviePath("Interstellar", 2014, 157336, ".mkv");
      expect(path).toBe("Interstellar (2014) [tmdb-157336]/Interstellar (2014).mkv");
    });

    it("should sanitize title", () => {
      const path = buildMoviePath("Movie: The <Reboot>", 2024, 123, ".mp4");
      expect(path).toBe("Movie - The Reboot (2024) [tmdb-123]/Movie - The Reboot (2024).mp4");
    });

    it("should handle titles with special characters", () => {
      const path = buildMoviePath('Colon"Slash/Test', 2020, 456, ".avi");
      expect(path).toContain("[tmdb-456]");
      expect(path).toContain("ColonSlashTest");
    });
  });

  describe("buildEpisodePath", () => {
    it("should build valid episode path", () => {
      const path = buildEpisodePath("Breaking Bad", 1396, 5, 16, "Felina", ".mkv");
      expect(path).toBe(
        "Breaking Bad [tmdb-1396]/Season 05/S05E16 - Felina.mkv",
      );
    });

    it("should zero-pad season and episode numbers", () => {
      const path = buildEpisodePath("The Office", 2316, 1, 1, "Pilot", ".mkv");
      expect(path).toBe("The Office [tmdb-2316]/Season 01/S01E01 - Pilot.mkv");
    });

    it("should sanitize episode title", () => {
      const path = buildEpisodePath("Show", 123, 2, 3, 'Episode: "The <One>"', ".mp4");
      expect(path).toContain("S02E03 - Episode - The One");
    });

    it("should handle high season/episode numbers", () => {
      const path = buildEpisodePath("Show", 123, 15, 100, "Last", ".mkv");
      expect(path).toBe("Show [tmdb-123]/Season 15/S15E100 - Last.mkv");
    });
  });
});
```

### 11.3 `packages/shared/__tests__/fixtures.ts`

```typescript
import { ulid } from "ulid";

/**
 * Test fixtures — reusable sample data for unit tests.
 */

export const fixtures = {
  messageId: () => ulid(),

  downloadRequest: {
    id: ulid(),
    type: "download:request" as const,
    timestamp: Date.now(),
    payload: {
      tmdbId: 157336,
      imdbId: "tt0816692",
      title: "Interstellar",
      year: 2014,
      mediaType: "movie" as const,
      magnet: "magnet:?xt=urn:btih:example",
      torrentName: "Interstellar.2014.1080p",
      expectedSize: 5368709120,
    },
  },

  downloadProgress: {
    id: ulid(),
    type: "download:progress" as const,
    timestamp: Date.now(),
    payload: {
      jobId: "job-123",
      phase: "downloading" as const,
      progress: 50,
      downloadedBytes: 2684354560,
      totalBytes: 5368709120,
      speedBps: 20971520,
      eta: 300,
    },
  },

  adminLoginRequest: {
    username: "admin",
    password: "securepassword123",
  },

  profileCreateRequest: {
    name: "Noah",
    avatar: "red",
  },

  profileSelectRequest: {
    profileId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    pin: "1234",
  },

  devicePairClaimRequest: {
    code: "ABC123",
    name: "Home NAS",
    platform: "linux" as const,
  },
};
```

---

## 12. Root `package.json` Updates

Update the root `package.json` to include database scripts:

```jsonc
{
  "scripts": {
    // ... existing scripts
    "db:generate": "drizzle-kit generate --config packages/shared/drizzle.config.ts",
    "db:migrate": "tsx packages/relay/src/db/migrate.ts",
    "db:push": "drizzle-kit push --config packages/shared/drizzle.config.ts"
  }
}
```

---

## 13. Execution Order

Execute these steps in this exact order:

### 13.1 Update Dependencies

1. Update `packages/shared/package.json`:
   - Add `zod ~3.24.0`, `ulid ~2.3.0` to dependencies
   - Add `drizzle-orm ~0.45.0`, `drizzle-kit ~0.31.0`, `@types/node ~22.0.0`, `pg ~8.13.0` to devDependencies

2. Update `packages/relay/package.json`:
   - Add `drizzle-orm ~0.45.0`, `pg ~8.13.0` to dependencies
   - Add `drizzle-kit ~0.31.0` to devDependencies

3. Update `packages/agent/package.json`:
   - No new dependencies needed (already imports from @tadaima/shared)

4. Run `pnpm install` from root

### 13.2 Create Utility Files

5. Create `packages/shared/src/utils/ids.ts`
6. Create `packages/shared/src/utils/timestamps.ts`
7. Create `packages/shared/src/utils/filenames.ts`
8. Create `packages/shared/src/utils/paths.ts`
9. Create `packages/shared/src/utils/index.ts`

### 13.3 Create Schema Files

10. Create `packages/shared/src/schemas/messages.ts`
11. Create `packages/shared/src/schemas/api.ts`
12. Create `packages/shared/src/schemas/index.ts`

### 13.4 Create Type Inference Files

13. Create `packages/shared/src/types/messages.ts`
14. Create `packages/shared/src/types/api.ts`
15. Create `packages/shared/src/types/index.ts`

### 13.5 Create Database Schema

16. Create `packages/shared/src/db/schema.ts`
17. Create `packages/shared/src/db/index.ts`

### 13.6 Create Configuration and Utilities

18. Create `packages/shared/drizzle.config.ts`
19. Create `packages/relay/src/db/migrate.ts`
20. Update `packages/shared/src/index.ts` (barrel export)
21. Update root `package.json` (add db scripts)

### 13.7 Create Test Files

22. Create `packages/shared/__tests__/schemas.test.ts`
23. Create `packages/shared/__tests__/utils.test.ts`
24. Create `packages/shared/__tests__/fixtures.ts`

### 13.8 Verify

25. Run `pnpm build` — verify all packages compile
26. Run `pnpm typecheck` — verify zero type errors
27. Run `pnpm lint` — verify zero lint errors
28. Run `pnpm --filter @tadaima/shared test` — verify all unit tests pass
29. Run `pnpm db:generate` — generate initial migrations (no-op if schema is empty, but verifies config)

---

## 14. Verification Checklist

Every item must pass before Phase 1 is considered complete:

| # | Check | How to verify |
|---|-------|---------------|
| 1 | Zod schemas import without errors | `cd packages/shared && pnpm build` |
| 2 | All utilities are exported from barrel | Check `packages/shared/dist/index.d.ts` |
| 3 | Message schemas parse valid fixtures | `pnpm --filter @tadaima/shared test -- schemas.test.ts` |
| 4 | Message schemas reject invalid data | `pnpm --filter @tadaima/shared test -- schemas.test.ts` |
| 5 | Utility tests pass | `pnpm --filter @tadaima/shared test -- utils.test.ts` |
| 6 | Relay imports types from shared | `cd packages/relay && pnpm build` |
| 7 | Web imports types from shared | `cd packages/web && pnpm build` |
| 8 | Agent imports types from shared | `cd packages/agent && pnpm build` |
| 9 | Drizzle config is valid | `pnpm db:generate` (should succeed) |
| 10 | All tests pass | `pnpm test` |
| 11 | No type errors | `pnpm typecheck` |
| 12 | No lint errors | `pnpm lint` |
| 13 | Created files match spec | Spot-check file paths and content |

---

## 15. Common Pitfalls to Avoid

1. **Do NOT export concrete instances** — only export schemas, types, and utility functions. Avoid singletons or class instances in shared.

2. **Do NOT import relay/web/agent code into shared** — shared must be a leaf package with zero dependencies on other packages (except zod, ulid). The entire point is that it's a neutral contract layer.

3. **Do NOT add database clients to shared** — Drizzle schema definitions are type-only; the actual database client is instantiated only in the relay package.

4. **Do NOT create migrations manually** — use `drizzle-kit generate` which will create migration files based on schema changes.

5. **Do NOT hardcode database URLs** — always read from `process.env.DATABASE_URL`.

6. **Do NOT skip unit tests** — if a Zod schema change is made later, tests catch it immediately.

7. **Do NOT use `any` types** — leverage Zod's type inference (`z.infer<typeof Schema>`) instead.

8. **Do NOT forget to update the barrel export** — whenever a new schema, type, or utility is added, update `packages/shared/src/index.ts`.

9. **Do NOT make MessageId or Timestamp non-optional** — all messages must have both fields. Use Zod's `.default()` in production if you want to auto-generate client-side.

10. **Do NOT use boolean flags instead of enums** — for `status`, `phase`, `mediaType`, always use `z.enum()` so the type system enforces valid values.

11. **✅ RESOLVED**: The migration runner uses `await` (async). This works fine in Node.js 22 ESM. Verify during implementation.

---

## Exit Criteria

Phase 1 is complete when:

1. All Zod schemas are defined and tested
2. TypeScript types are correctly inferred from schemas
3. Drizzle ORM table definitions match the schema in ARCHITECTURE.md (9 tables, all columns, foreign keys, indices)
4. All utility functions are implemented and tested
5. The barrel export exports everything cleanly
6. All unit tests pass (`pnpm test`)
7. No type errors (`pnpm typecheck`)
8. No lint errors (`pnpm lint`)
9. Relay and web packages can import from `@tadaima/shared` without errors
10. The relay team can proceed with Phase 2 (Auth) knowing the types won't change

---

## Appendix: Zod Schema Validation Examples

These are quick references for how each schema validates input.

```typescript
// Valid
DownloadRequestSchema.parse({
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  type: "download:request",
  timestamp: 1704067200000,
  payload: {
    tmdbId: 157336,
    imdbId: "tt0816692",
    title: "Interstellar",
    year: 2014,
    mediaType: "movie",
    magnet: "magnet:?xt=urn:btih:...",
    torrentName: "Interstellar.2014.1080p.mkv",
    expectedSize: 5368709120,
  },
});

// Invalid — magnet must start with "magnet:"
DownloadRequestSchema.parse({
  // ...
  payload: {
    // ...
    magnet: "http://example.com/torrent.torrent",
  },
}); // throws ZodError

// Invalid — mediaType must be "movie" or "tv"
DownloadRequestSchema.parse({
  // ...
  payload: {
    // ...
    mediaType: "series",
  },
}); // throws ZodError

// Valid — optional season/episode
DownloadRequestSchema.parse({
  // ...
  payload: {
    // ...
    mediaType: "tv",
    season: 5,
    episode: 16,
    episodeTitle: "Felina",
  },
});

// Use safeParse for error handling
const result = DownloadRequestSchema.safeParse(input);
if (!result.success) {
  console.error(result.error.issues);
} else {
  console.log(result.data);
}
```
