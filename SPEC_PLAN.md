# Tadaima (ただいま) — Full Spec Plan

> **OUTDATED — This document is superseded by `ARCHITECTURE.md` and `PROJECT_PLAN.md`.** It describes an earlier design with individual user accounts, per-agent RD keys, no download queue, and a centralized hosted service. The current architecture uses admin + profiles, shared RD key, Railway self-hosting, and an offline download queue. Do not use this document for implementation — refer to `ARCHITECTURE.md` for the system design and `PROJECT_PLAN.md` for phased specs.

> *"I'm home." What your downloads say when they arrive.*

## Overview

Tadaima is a cloud-hosted media download orchestrator. It pairs a **Netflix-like web app** (for browsing and triggering downloads) with **lightweight desktop agents** (for downloading via Real-Debrid and organizing files into Plex-compatible libraries). A **relay server** sits in between, handling auth, WebSocket routing, and API proxying.

**Tech Stack:** TypeScript monorepo (Turborepo + pnpm workspaces). Relay: Hono + Node.js 22 + PostgreSQL (Drizzle ORM). Web: React 19 + Vite + Tailwind CSS + TanStack Query + zustand. Agent: Node.js 22 / Bun + ws + conf. Shared: Zod schemas + TypeScript types.

**Monorepo Structure:**
```
tadaima/
├── packages/
│   ├── relay/          # Cloud API + WebSocket server
│   ├── web/            # React SPA
│   ├── agent/          # Download daemon / CLI
│   └── shared/         # Types, message protocol, validation
├── package.json        # Workspace root (pnpm)
├── turbo.json          # Build orchestration
└── docker-compose.yml  # Local dev (Postgres)
```

**JSON Convention:** All HTTP API request and response bodies use **camelCase** keys (e.g., `tmdbId`, `deviceId`, `sizeBytes`). WebSocket messages also use camelCase. Database column names use **snake_case** and are mapped by Drizzle ORM.

**Error Response Convention:** All API error responses use a standard envelope:
```json
{ "error": "not_found", "detail": "No device found with ID abc-123" }
```
- `error` — short, machine-readable error type (e.g., `"not_found"`, `"validation_error"`, `"rate_limited"`, `"unauthorized"`)
- `detail` — human-readable explanation, displayed to the user via toast
- HTTP status codes: `400` (bad request), `401` (unauthorized), `403` (forbidden), `404` (not found), `422` (validation failure), `429` (rate limited), `500` (server error), `502` (upstream API error)
- Frontend: API client reads `detail` first, falls back to `error`, falls back to HTTP status text

---

## 1. Database Schema (PostgreSQL via Drizzle ORM)

### `users`
User accounts for the web app.

| Column | Type | Description |
|---|---|---|
| id | UUID PK | Internal identifier (generated) |
| email | TEXT UNIQUE | User email address |
| password_hash | TEXT | bcrypt hashed password |
| created_at | TIMESTAMP | Account creation time |
| updated_at | TIMESTAMP | Last update time |

### `refresh_tokens`
Stores active refresh tokens for session management.

| Column | Type | Description |
|---|---|---|
| id | UUID PK | Token identifier |
| user_id | UUID FK | → users |
| token_hash | TEXT | SHA-256 hash of the refresh token |
| expires_at | TIMESTAMP | Expiration (7 days from issue) |
| created_at | TIMESTAMP | Issue time |

### `devices`
Paired agents (one row per physical machine / Docker container).

| Column | Type | Description |
|---|---|---|
| id | UUID PK | Device identifier |
| user_id | UUID FK | → users |
| name | TEXT | User-facing name (e.g., "Living Room NAS") |
| platform | TEXT | "windows", "macos", "linux", "docker" |
| token_hash | TEXT | SHA-256 hash of the device token |
| is_online | BOOLEAN | Updated by heartbeat / disconnect |
| is_default | BOOLEAN | Default download target for this user |
| last_seen_at | TIMESTAMP | Last heartbeat timestamp |
| created_at | TIMESTAMP | Pairing time |

### `pairing_codes`
Temporary codes for device pairing flow.

| Column | Type | Description |
|---|---|---|
| code | TEXT PK | 6-char alphanumeric code |
| user_id | UUID FK | → users |
| expires_at | TIMESTAMP | 10 minutes from creation |
| claimed | BOOLEAN | True once agent claims it |
| device_id | UUID FK | → devices (set on claim) |
| created_at | TIMESTAMP | Generation time |

### `download_history`
Record of all downloads across all devices for a user.

| Column | Type | Description |
|---|---|---|
| id | UUID PK | Record identifier |
| user_id | UUID FK | → users |
| device_id | UUID FK | → devices |
| tmdb_id | INTEGER | TMDB identifier |
| imdb_id | TEXT | IMDb identifier |
| title | TEXT | Media title |
| year | INTEGER | Release year |
| media_type | TEXT | "movie" or "tv" |
| season | INTEGER | Season number (nullable) |
| episode | INTEGER | Episode number (nullable) |
| episode_title | TEXT | Episode title (nullable) |
| torrent_name | TEXT | Torrent name |
| size_bytes | BIGINT | Final file size |
| status | TEXT | "completed", "failed", "cancelled" |
| error | TEXT | Error message if failed (nullable) |
| started_at | TIMESTAMP | Download start time |
| completed_at | TIMESTAMP | Completion time (nullable) |

---

## 2. API Endpoints (Relay Server)

### Auth (`/api/auth`)

| Method | Path | Description |
|---|---|---|
| POST | /api/auth/signup | Create new account |
| POST | /api/auth/login | Sign in, receive JWT tokens |
| POST | /api/auth/refresh | Refresh access token |
| POST | /api/auth/logout | Revoke refresh token |
| DELETE | /api/auth/account | Delete account and all data |

### Devices (`/api/devices`)

| Method | Path | Description |
|---|---|---|
| GET | /api/devices | List user's paired devices |
| PATCH | /api/devices/:id | Rename device or set as default |
| DELETE | /api/devices/:id | Revoke device (unpair) |
| POST | /api/devices/pair/request | Generate pairing code |
| POST | /api/devices/pair/confirm | Confirm pairing code from web app |
| POST | /api/devices/pair/claim | Agent claims pairing code |

### Search & Streams (`/api`)

| Method | Path | Description |
|---|---|---|
| GET | /api/search?q=... | Search TMDB (proxied + cached) |
| GET | /api/media/:type/:tmdbId | Get media details (proxied + cached) |
| GET | /api/streams/:type/:imdbId | Get Torrentio streams (proxied + cached) |
| GET | /api/poster/:path | Serve TMDB poster image (proxied + cached) |

### Downloads (`/api/downloads`)

| Method | Path | Description |
|---|---|---|
| GET | /api/downloads | List download history (paginated) |
| GET | /api/downloads/:id | Get single download record |
| DELETE | /api/downloads/:id | Delete history entry |

### System (`/api`)

| Method | Path | Description |
|---|---|---|
| GET | /api/health | Health check |
| GET | /api/version | Server version |

### 2.1 Request/Response Schemas

All responses use camelCase keys. Error responses use the standard `{ "error": "...", "detail": "..." }` envelope.

**POST /api/auth/signup**
Request: `{ "email": "user@example.com", "password": "..." }`
Response (201):
```json
{
  "user": { "id": "uuid", "email": "user@example.com" },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```
Validation: email format, password min 8 chars. Returns 422 on failure, 409 if email taken.

**POST /api/auth/login**
Request: `{ "email": "user@example.com", "password": "..." }`
Response:
```json
{
  "user": { "id": "uuid", "email": "user@example.com" },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```
Returns 401 on invalid credentials.

**POST /api/auth/refresh**
Request: `{ "refreshToken": "eyJ..." }`
Response: `{ "accessToken": "eyJ...", "refreshToken": "eyJ..." }`
Old refresh token is revoked, new one issued (rotation). Returns 401 on expired/invalid token.

**POST /api/auth/logout**
Request: `{ "refreshToken": "eyJ..." }`
Response: `{ "ok": true }`
Revokes the refresh token. Access token remains valid until expiry (15m).

**GET /api/devices**
Response:
```json
{
  "devices": [
    {
      "id": "uuid",
      "name": "Living Room NAS",
      "platform": "linux",
      "isOnline": true,
      "isDefault": true,
      "lastSeenAt": "2026-04-03T12:00:00Z",
      "createdAt": "2026-03-01T08:00:00Z"
    }
  ]
}
```

**POST /api/devices/pair/request**
Response: `{ "code": "A7X9K2", "expiresAt": "2026-04-03T12:10:00Z" }`
Generates a 6-char alphanumeric code valid for 10 minutes.

**POST /api/devices/pair/claim** (called by agent)
Request: `{ "code": "A7X9K2", "name": "noah-macbook", "platform": "macos" }`
Response:
```json
{
  "deviceId": "uuid",
  "deviceToken": "eyJ...",
  "relay": "wss://tadaima.app/ws"
}
```
Returns 404 for unknown/expired code, 409 if already claimed.

**POST /api/devices/pair/confirm** (called by web app)
Request: `{ "code": "A7X9K2" }`
Response: `{ "device": { "id": "uuid", "name": "noah-macbook", "platform": "macos" } }`
Confirms the pairing from the web side. Returns 404 if code not yet claimed.

**GET /api/search?q=interstellar**
Response:
```json
{
  "results": [
    {
      "tmdbId": 157336,
      "title": "Interstellar",
      "year": 2014,
      "mediaType": "movie",
      "overview": "...",
      "posterPath": "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
      "imdbId": "tt0816692"
    }
  ]
}
```
Cached for 1 hour. Max 20 results.

**GET /api/media/:type/:tmdbId**
Response:
```json
{
  "tmdbId": 157336,
  "title": "Interstellar",
  "year": 2014,
  "mediaType": "movie",
  "overview": "...",
  "posterPath": "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
  "imdbId": "tt0816692",
  "isAnime": false,
  "seasons": null
}
```
For TV shows, `seasons` is an array of `{ seasonNumber, episodeCount, name }`. Cached for 24 hours.

**GET /api/streams/:type/:imdbId**
Query params: `?season=1&episode=1` (for TV)
Response:
```json
{
  "streams": [
    {
      "name": "Interstellar.2014.2160p.UHD.BluRay.x265-TERMINAL",
      "infoHash": "abc123...",
      "sizeBytes": 45000000000,
      "seeders": 142,
      "magnet": "magnet:?xt=urn:btih:..."
    }
  ]
}
```
Cached for 15 minutes. Note: RD cache status is NOT included here — it's checked agent-side.

**GET /api/poster/:path**
Response: `image/jpeg` binary. Cached for 7 days. Proxies from TMDB image CDN.

**GET /api/downloads**
Query params: `?limit=50&offset=0&status=completed` (all optional)
Response:
```json
{
  "downloads": [ ...DownloadHistoryObject ],
  "total": 142
}
```

**GET /api/health**
Response: `{ "status": "ok", "uptime": 86400 }`

**GET /api/version**
Response: `{ "version": "1.0.0" }`

---

## 3. WebSocket Protocol

### Connection

**Client (web app) connection:**
```
wss://tadaima.app/ws?token={accessToken}
```
Authenticated via JWT access token as query parameter. Connection rejected with `4001` close code on invalid/expired token.

**Agent connection:**
```
wss://tadaima.app/ws/agent?token={deviceToken}
```
Authenticated via device token. Connection rejected with `4001` on invalid/revoked token. Agent sends `agent:hello` immediately after connection with device info.

### Message Envelope

Every WebSocket message is a JSON object validated with Zod:

```typescript
type WsMessage = {
  id: string           // unique message ID (ULID)
  type: string         // message type (see below)
  timestamp: number    // unix milliseconds
  payload: unknown     // type-specific data
}
```

### Message Types

#### Commands (web → relay → agent)

**`download:request`** — Request a download on a specific agent
```typescript
{
  type: "download:request",
  payload: {
    tmdbId: number,
    imdbId: string,
    title: string,
    year: number,
    mediaType: "movie" | "tv",
    season?: number,
    episode?: number,
    episodeTitle?: string,
    magnet: string,
    torrentName: string,
    expectedSize: number
  }
}
```
Relay routes to the target device's WebSocket. If agent is offline, relay responds with `download:rejected`.

**`download:cancel`** — Cancel an active download
```typescript
{
  type: "download:cancel",
  payload: { jobId: string }
}
```

**`cache:check`** — Request RD cache check for a list of streams
```typescript
{
  type: "cache:check",
  payload: {
    requestId: string,
    infoHashes: string[]
  }
}
```

#### Events (agent → relay → web)

**`download:accepted`** — Agent acknowledges a download request
```typescript
{
  type: "download:accepted",
  payload: {
    jobId: string,       // agent-generated job ID
    requestId: string    // matches the original request message ID
  }
}
```

**`download:progress`** — Progress update for an active download
```typescript
{
  type: "download:progress",
  payload: {
    jobId: string,
    phase: "adding" | "waiting" | "unrestricting" | "downloading" | "organizing",
    progress: number,         // 0–100
    downloadedBytes?: number,
    totalBytes?: number,
    speedBps?: number,
    eta?: number              // seconds remaining
  }
}
```

**`download:completed`** — Download finished successfully
```typescript
{
  type: "download:completed",
  payload: {
    jobId: string,
    filePath: string,
    finalSize: number
  }
}
```

**`download:failed`** — Download errored
```typescript
{
  type: "download:failed",
  payload: {
    jobId: string,
    error: string,
    phase: string,
    retryable: boolean
  }
}
```

**`download:rejected`** — Relay or agent rejects a download request
```typescript
{
  type: "download:rejected",
  payload: {
    requestId: string,
    reason: string       // e.g., "device_offline", "queue_full"
  }
}
```

**`cache:result`** — RD cache check response from agent
```typescript
{
  type: "cache:result",
  payload: {
    requestId: string,
    cached: Record<string, boolean>   // infoHash → isCached
  }
}
```

#### System Messages

**`agent:hello`** — Sent by agent immediately after WebSocket connection
```typescript
{
  type: "agent:hello",
  payload: {
    version: string,
    platform: string,
    activeJobs: number,
    diskFreeBytes: number
  }
}
```

**`agent:heartbeat`** — Periodic agent status (every 30 seconds)
```typescript
{
  type: "agent:heartbeat",
  payload: {
    activeJobs: number,
    diskFreeBytes: number,
    uptimeSeconds: number
  }
}
```

**`device:status`** — Relay notifies web clients of agent online/offline changes
```typescript
{
  type: "device:status",
  payload: {
    deviceId: string,
    isOnline: boolean,
    lastSeenAt: string    // ISO 8601
  }
}
```

**`error`** — Generic error message (relay → client or agent)
```typescript
{
  type: "error",
  payload: {
    code: string,
    detail: string,
    originalMessageId?: string
  }
}
```

### Message Routing

The relay routes messages based on type prefix and authentication:

- **`download:*`** commands from web clients → routed to the target agent (identified by `deviceId` from the user's default device, or specified in a `targetDeviceId` field)
- **`download:*`** events from agents → broadcast to all connected web clients for that user
- **`cache:check`** from web → routed to specified agent
- **`cache:result`** from agent → routed back to requesting web client
- **`agent:heartbeat`** → consumed by relay (updates `devices.last_seen_at` and `devices.is_online`), NOT forwarded
- **`device:status`** → generated by relay when agent connects/disconnects, sent to web clients

### Rate Limiting (WebSocket)

- Max 100 messages/minute per connection
- Excess messages receive an `error` message with code `"rate_limited"` and are dropped
- Connection is NOT closed on rate limit (to avoid reconnection storms)

---

## 4. Relay Server Services

### 4.1 Authentication Service

- **`signup(email, password)`** — validate email format + password length (min 8), hash with bcrypt (cost 12), create `users` row, issue JWT pair
- **`login(email, password)`** — verify credentials, issue JWT pair
- **`refresh(refreshToken)`** — validate token, verify hash in `refresh_tokens` table, revoke old token, issue new pair (rotation)
- **`logout(refreshToken)`** — delete from `refresh_tokens`
- **JWT structure:** `{ sub: userId, type: "access" | "refresh", iat, exp }` signed with `jose` (HS256, server secret from env)
- **Access token:** 15-minute expiry, used for HTTP API and WebSocket auth
- **Refresh token:** 7-day expiry, stored hashed in DB

### 4.2 Device Pairing Service

- **`generatePairingCode(userId)`** — create 6-char alphanumeric code (A-Z, 0-9, excluding ambiguous chars I/O/0/1), store in `pairing_codes` with 10-minute expiry
- **`claimCode(code, name, platform)`** — validate code exists + not expired + not claimed, create `devices` row, issue device token (long-lived JWT with `type: "device"`, `deviceId`, `userId`), mark code claimed
- **`confirmCode(code, userId)`** — validate code belongs to user and is claimed, return device info
- **`revokeDevice(deviceId, userId)`** — delete device row, close any active WebSocket for that device

### 4.3 WebSocket Manager

Maintains two connection pools:

```typescript
type ConnectionPool = {
  agents: Map<string, WebSocket>       // keyed by `${userId}:${deviceId}`
  clients: Map<string, Set<WebSocket>> // keyed by userId, multiple tabs
}
```

- **`onAgentConnect(ws, deviceToken)`** — authenticate device token, register in agents pool, update `devices.is_online = true`, broadcast `device:status` to user's web clients
- **`onAgentDisconnect(deviceId)`** — remove from pool, update `devices.is_online = false`, `devices.last_seen_at`, broadcast `device:status`
- **`onClientConnect(ws, accessToken)`** — authenticate JWT, add to clients pool
- **`onClientDisconnect(ws)`** — remove from clients pool
- **`routeMessage(message, sender)`** — inspect `message.type`, route per rules in §3
- **`sendToAgent(userId, deviceId, message)`** — find agent WebSocket, send or return error
- **`broadcastToClients(userId, message)`** — send to all web clients for that user

### 4.4 API Proxy & Cache

In-memory cache (or Redis for multi-instance) with configurable TTLs:

| Upstream | Relay Endpoint | Cache Key | TTL |
|---|---|---|---|
| TMDB `/search/multi` | `GET /api/search?q=...` | `search:{query}` | 1 hour |
| TMDB `/movie/:id` or `/tv/:id` | `GET /api/media/:type/:tmdbId` | `media:{type}:{tmdbId}` | 24 hours |
| Torrentio streams | `GET /api/streams/:type/:imdbId` | `streams:{type}:{imdbId}:{season}:{episode}` | 15 minutes |
| TMDB image CDN | `GET /api/poster/:path` | `poster:{path}` | 7 days |

- TMDB API key stored server-side in environment variable `TMDB_API_KEY`
- Torrentio base URL: `https://torrentio.strem.fun`
- Torrentio URL format: `/stream/{type}/{imdbId}{:season:episode}.json`
- Anime detection: TMDB keyword ID `210024` ("anime"), or fallback when genres contain ID `16` (Animation) AND `original_language == "ja"`

### 4.5 Rate Limiter

Sliding window algorithm, stored in-memory (or Redis):

```typescript
const RATE_LIMITS = {
  // Per-user limits
  search:      { max: 60,  windowSec: 3600 },
  streams:     { max: 30,  windowSec: 3600 },
  download:    { max: 20,  windowSec: 3600 },
  wsConnect:   { max: 3,   windowSec: 1    },  // concurrent
  wsMessage:   { max: 100, windowSec: 60   },

  // Per-IP limits (unauthenticated)
  signup:      { max: 5,   windowSec: 3600 },
  failedLogin: { max: 10,  windowSec: 3600 },
  pairing:     { max: 10,  windowSec: 3600 },
}
```

Rate limit response:
```
HTTP 429 Too Many Requests
Retry-After: 240
{
  "error": "rate_limited",
  "detail": "Search limit reached (60/hour). Try again in 4 minutes.",
  "retryAfter": 240
}
```

### 4.6 Download History Service

- **`recordDownload(userId, deviceId, metadata)`** — create `download_history` row when agent sends `download:completed` or `download:failed`
- **`getHistory(userId, options)`** — paginated query with optional status filter
- **`deleteEntry(id, userId)`** — soft delete or hard delete a history record

---

## 5. Web App Architecture

### 5.1 Pages / Routes

| Route | Component | Auth Required | Description |
|---|---|---|---|
| `/login` | `LoginPage` | No | Email + password login form |
| `/signup` | `SignupPage` | No | Registration form |
| `/` | `SearchPage` | Yes | TMDB search → results → stream picker → download |
| `/downloads` | `DownloadsPage` | Yes | Active + recent downloads with real-time progress |
| `/devices` | `DevicesPage` | Yes | Paired agents, online/offline, pair new device |
| `/settings` | `SettingsPage` | Yes | Account settings, change password, manage sessions |

### 5.2 State Management

**zustand store** for global state, fed by WebSocket events:

```typescript
type AppStore = {
  // Auth
  user: User | null
  accessToken: string | null
  login(email: string, password: string): Promise<void>
  logout(): void

  // WebSocket
  wsStatus: "connecting" | "connected" | "disconnected"

  // Devices
  devices: Device[]
  defaultDeviceId: string | null

  // Active downloads (real-time from WebSocket)
  activeDownloads: Map<string, DownloadJob>

  // Download history (from HTTP API)
  downloadHistory: DownloadRecord[]
}
```

**TanStack Query** for HTTP API data fetching (search results, media details, streams, download history, device list). Provides caching, deduplication, and background refetch.

### 5.3 WebSocket Client

Single persistent connection per session:

- Connect on login, disconnect on logout
- Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Merge incoming events into zustand store
- Queue outbound messages during reconnection

### 5.4 API Client (`packages/web/src/api/client.ts`)

Type-safe fetch wrappers for all relay endpoints:

- `signup(email, password)` → POST /api/auth/signup
- `login(email, password)` → POST /api/auth/login
- `refreshToken()` → POST /api/auth/refresh
- `getDevices()` → GET /api/devices
- `renameDevice(id, name)` → PATCH /api/devices/:id
- `removeDevice(id)` → DELETE /api/devices/:id
- `generatePairingCode()` → POST /api/devices/pair/request
- `confirmPairing(code)` → POST /api/devices/pair/confirm
- `search(query)` → GET /api/search?q=...
- `getMedia(type, tmdbId)` → GET /api/media/:type/:tmdbId
- `getStreams(type, imdbId, season?, episode?)` → GET /api/streams/:type/:imdbId
- `getPosterUrl(path)` → returns URL string for `<img src>`
- `getDownloads(options?)` → GET /api/downloads
- `deleteDownload(id)` → DELETE /api/downloads/:id

All methods attach `Authorization: Bearer {accessToken}` header. On 401, auto-refresh token and retry once.

### 5.5 UI Design Language

Carry forward from the existing media-downloader design:

```css
:root {
  --bg: #0f0f0f;
  --surface: #1a1a1a;
  --surface2: #242424;
  --surface3: #2e2e2e;
  --border: #333;
  --text: #e0e0e0;
  --text-dim: #888;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --green: #22c55e;
  --red: #ef4444;
  --yellow: #eab308;
  --blue: #3b82f6;
  --orange: #f97316;
  --pink: #ec4899;
}
```

- Dark theme, `#0f0f0f` background
- Indigo accent (`#6366f1`) for primary actions
- Card-based layouts with `#1a1a1a` surface + `#333` borders
- Badges with semi-transparent backgrounds (e.g., `#6366f120`)
- Progress bars with smooth transitions
- Rounded corners (8–12px for cards, 4–6px for badges/buttons)
- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Monospace for file paths and technical data: `'SF Mono', monospace`

### 5.6 Search Page Specification

> **Canonical UI reference:** `ux-demos/search.html`

The Search page is the home page of the web app. It provides:

1. **Search bar** — text input + submit button at the top. Placeholder: "Search movies and TV shows..."
2. **Search results grid** — poster cards with title, year, type badge, overview. Click to view streams.
3. **Stream picker** (shown after clicking a result):
   - Media header: poster, title, year, type badge, IMDb badge, overview
   - Stream filter bar with toggleable chips:
     - Resolution: 480p, 720p, 1080p, 2160p
     - HDR/DV: HDR, HDR10+, Dolby Vision
     - Audio: 2.0, 5.1, 7.1, Atmos
     - Cache: RD Cached (populated after agent-side cache check)
     - Logic: OR within a group, AND across groups
     - Active filter count badge, "Clear all" button, "Showing X of Y streams"
   - Stream table: name, attribute badges, size, seeders, download button
   - Pagination: 5/10/25 per page
4. **Device selector** — dropdown near download button showing online agents, default pre-selected
5. **TV show handling:**
   - After clicking a TV result, show season/episode selector
   - User picks a season + episode (or full season pack if available)
   - Stream list updates based on selection

### 5.7 Downloads Page Specification

> **Canonical UI reference:** `ux-demos/downloads.html`

Real-time view of all downloads across all devices:

1. **Active downloads section** — cards with:
   - Media title + type badge
   - Agent/device name badge
   - Phase indicator (Adding to RD → Waiting → Downloading → Organizing)
   - Progress bar with percentage
   - Download speed + ETA
   - Cancel button
2. **Recent downloads section** — completed/failed/cancelled entries:
   - Title, device name, size, status badge, timestamp
   - Failed entries show error message + retry button (resends download command)
   - Delete button to remove from history
3. **Filters**: All, Active, Completed, Failed
4. **Empty state**: "No downloads yet. Search for something to get started."

### 5.8 Devices Page Specification

> **Canonical UI reference:** `ux-demos/devices.html`

Manage paired agents:

1. **Device list** — cards for each paired device:
   - Device name (editable inline)
   - Platform icon (Windows/macOS/Linux/Docker)
   - Online/offline status dot + "Last seen X ago" for offline devices
   - Default device indicator (star icon)
   - Set as default button
   - Disk free space (from heartbeat, when online)
   - Active downloads count (when online)
   - Remove/unpair button (confirmation dialog)
2. **Pair new device** — button that triggers:
   - Generate pairing code
   - Display code in a large, copyable format
   - Instructions: "Run `tadaima setup` on your device and enter this code"
   - Code expiration countdown (10 minutes)
   - Auto-detect when device pairs (code confirmed)
3. **Empty state**: "No devices paired. Install the agent on your machine to get started."

### 5.9 Settings Page Specification

> **Canonical UI reference:** `ux-demos/settings.html`

Account and session management:

1. **Account section:**
   - Email display (read-only)
   - Change password form (current password, new password, confirm)
2. **Sessions section:**
   - List of active sessions (access tokens) with device info and last active time
   - "Sign out all other sessions" button
3. **Danger zone:**
   - Delete account button (confirmation dialog with password re-entry)
4. **About section:**
   - Relay server version
   - Link to GitHub repo
   - Open source license info

### 5.10 Component Library

Shared components used across pages:

- **`AppShell`** — sidebar nav (Search, Downloads, Devices, Settings), user avatar, connection status dot
- **`Toast`** — notification system (success/error/info, auto-dismiss 5s, stacking)
- **`Badge`** — colored label (type, status, attribute)
- **`ProgressBar`** — animated fill bar with color variants
- **`Modal`** — overlay dialog with backdrop close
- **`DeviceSelector`** — dropdown of online devices for download target
- **`StreamFilterBar`** — toggleable chip groups for stream filtering
- **`EmptyState`** — illustration + message + optional action button

---

## 6. Agent Architecture

### 6.1 CLI Commands

```
tadaima setup              # First-time configuration (interactive)
tadaima start              # Start agent (foreground with TUI)
tadaima start -d           # Start as background daemon
tadaima status             # Show connection status + active downloads
tadaima stop               # Stop background daemon
tadaima config get <key>   # Read a config value
tadaima config set <key>   # Update a config value
tadaima logs               # Tail recent logs
tadaima install-service    # Install as system service (systemd/launchd)
tadaima uninstall-service  # Remove system service
tadaima version            # Show version info
```

### 6.2 Configuration

Stored at `~/.config/tadaima/config.json`:

```json
{
  "relay": "https://tadaima.app",
  "deviceToken": "eyJ...",
  "deviceId": "uuid",
  "deviceName": "noah-macbook",
  "directories": {
    "movies": "/mnt/media/Movies",
    "tv": "/mnt/media/TV",
    "staging": "/tmp/tadaima/staging"
  },
  "realDebrid": {
    "apiKey": "encrypted-or-keychain-ref"
  },
  "maxConcurrentDownloads": 2,
  "rdPollInterval": 30
}
```

### 6.3 Setup Flow

```
$ tadaima setup
? Relay server URL [https://tadaima.app]:
? Opening browser for login... (or enter pairing code manually)
? Pairing code: A7X9K2
? Movies directory: /mnt/media/Movies
? TV Shows directory: /mnt/media/TV
? Real-Debrid API key: ****...a1b2
✓ Connected! This device is now paired as "noah-macbook"
```

1. Prompt for relay URL (default: `https://tadaima.app`)
2. Open browser to relay's pair page, or prompt for manual code entry
3. Call `POST /api/devices/pair/claim` with code + device info
4. Receive device token, store in config
5. Prompt for media directories + RD API key
6. Validate RD key by calling Real-Debrid `/user` endpoint
7. Write config file, confirm success

### 6.4 Real-Debrid Client

Port from existing C# implementation to TypeScript:

- **Base URL:** `https://api.real-debrid.com/rest/1.0`
- **Auth:** `Authorization: Bearer {rdApiKey}`
- **`addMagnet(magnet)`** — `POST /torrents/addMagnet` → torrent ID
- **`selectFiles(torrentId, fileIds?)`** — `POST /torrents/selectFiles/{id}` → select all or specific files
- **`pollUntilReady(torrentId)`** — poll `GET /torrents/info/{id}` every `rdPollInterval` seconds, 30-minute timeout. Done: `"downloaded"`. Error: `"error"`, `"virus"`, `"dead"`, `"magnet_error"`.
- **`unrestrictLink(link)`** — `POST /unrestrict/link` → download URL + file size
- **`unrestrictAll(links)`** — unrestrict all links, return array of `{ url, size }`
- **`checkCache(infoHashes)`** — `GET /torrents/instantAvailability/{hashes}` → `Record<string, boolean>`
- **`downloadMagnet(magnet)`** — full pipeline: add → select → poll → unrestrict

### 6.5 Download Handler

Processes `download:request` messages from WebSocket:

1. Validate request, generate job ID
2. Send `download:accepted` back through WebSocket
3. Run RD pipeline (`addMagnet → selectFiles → pollUntilReady → unrestrictAll`)
4. Download files to staging directory with progress reporting
5. Organize into Plex-compatible structure
6. Send `download:completed` or `download:failed`

Concurrent downloads limited by `maxConcurrentDownloads` (default 2) via semaphore.

### 6.6 File Download Service

- Chunked HTTP download using `got` or native `fetch` with streaming
- 64KB read chunks, write to disk
- Progress reporting: `downloadedBytes`, `totalBytes`, `speedBps`, `eta`
- Progress events throttled to 1 per second via WebSocket
- Cancellation via `AbortController`
- No resume — failed downloads retry from RD unrestrict step

### 6.7 Media Organizer

Same Plex-compatible structure as media-downloader:

```
Movies/
  {Title} ({Year}) [tmdb-{tmdbId}]/
    {Title} ({Year}).{ext}

TV/
  {Title} [tmdb-{tmdbId}]/
    Season {NN}/
      S{NN}E{NN} - {Episode Title}.{ext}
```

- **`sanitize(name)`** — remove `<>"/\|?*`, replace colon with ` - `, collapse spaces
- **`buildMoviePath(title, year, tmdbId, ext)`** → full destination path
- **`buildEpisodePath(title, tmdbId, season, episode, episodeTitle, ext)`** → full destination path
- **`organizeFile(sourcePath, destPath)`** — create directories, move file, handle overwrites

### 6.8 WebSocket Client

Persistent connection to relay with reconnection:

- Connect to `wss://{relay}/ws/agent?token={deviceToken}`
- Auto-reconnect with exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
- Reset backoff on successful connection
- Send `agent:hello` on connect
- Send `agent:heartbeat` every 30 seconds
- Handle incoming commands: `download:request`, `download:cancel`, `cache:check`
- Queue outbound messages during reconnection

### 6.9 TUI (Terminal UI)

When running in foreground mode (`tadaima start`):

```
 tadaima v1.0.0 — Connected to relay
 ──────────────────────────────────────────
 ↓ Interstellar (2014)           45.2 GB
   ████████████████░░░░░░░░░░░░  62%  18.4 MB/s  ETA 12m

 ↓ Breaking Bad S05E16            1.8 GB
   ██████████████████████████░░  89%  22.1 MB/s  ETA 1m

 ✓ The Matrix (1999)             12.4 GB  ただいま — completed 3m ago
 ──────────────────────────────────────────
 2 active · 847 GB free on /mnt/media
```

- Connection status in header
- Active downloads with progress bars, speed, ETA
- Recently completed downloads with "ただいま" message
- Disk free space in footer

---

## 7. Acceptance Criteria

### AC-1: Authentication

| # | Criteria |
|---|---|
| 1.1 | Signup creates user with valid email + password (min 8 chars); returns 422 on invalid input |
| 1.2 | Signup returns 409 when email is already registered |
| 1.3 | Login returns access + refresh tokens on valid credentials; returns 401 on invalid |
| 1.4 | Access token expires after 15 minutes; refresh token expires after 7 days |
| 1.5 | Refresh rotates tokens: old refresh token is revoked, new pair issued |
| 1.6 | Refresh with expired/revoked token returns 401 |
| 1.7 | Logout revokes the specified refresh token |
| 1.8 | All authenticated endpoints return 401 without valid access token |
| 1.9 | Password is hashed with bcrypt (cost 12); never stored or returned in plaintext |

### AC-2: Device Pairing

| # | Criteria |
|---|---|
| 2.1 | Pairing code is 6 chars alphanumeric, excluding ambiguous chars (I/O/0/1) |
| 2.2 | Pairing code expires after 10 minutes |
| 2.3 | Agent claims code → receives device token + device ID |
| 2.4 | Web confirms code → receives device info |
| 2.5 | Claiming expired code returns 404 |
| 2.6 | Claiming already-claimed code returns 409 |
| 2.7 | Each user can pair up to 5 devices |
| 2.8 | First paired device is automatically set as default |
| 2.9 | Revoking a device closes its WebSocket connection |
| 2.10 | Device can be renamed via PATCH |

### AC-3: WebSocket Relay

| # | Criteria |
|---|---|
| 3.1 | Agent connects with valid device token; rejected with 4001 on invalid token |
| 3.2 | Client connects with valid access token; rejected with 4001 on invalid token |
| 3.3 | Agent connection updates `devices.is_online = true`; disconnect updates to `false` |
| 3.4 | `device:status` broadcast to web clients on agent connect/disconnect |
| 3.5 | Commands from web routed to correct agent by deviceId |
| 3.6 | Events from agent broadcast to all web clients for that user |
| 3.7 | Message to offline agent returns `download:rejected` with reason `"device_offline"` |
| 3.8 | Heartbeat updates `devices.last_seen_at`; NOT forwarded to web clients |
| 3.9 | Rate limit: 100 messages/min per connection; excess dropped with `error` message |
| 3.10 | Max 3 concurrent WebSocket connections per user |

### AC-4: API Proxy & Cache

| # | Criteria |
|---|---|
| 4.1 | Search proxy returns TMDB results; cached for 1 hour |
| 4.2 | Media detail proxy returns movie or TV info; cached for 24 hours |
| 4.3 | Stream proxy returns Torrentio streams; cached for 15 minutes |
| 4.4 | Poster proxy serves TMDB images; cached for 7 days |
| 4.5 | Proxy returns 502 on upstream failure with standard error envelope |
| 4.6 | TMDB API key is never exposed to clients |
| 4.7 | Search supports anime detection (TMDB keyword 210024 or genre 16 + JP origin) |
| 4.8 | TV media details include season/episode counts |

### AC-5: Rate Limiting

| # | Criteria |
|---|---|
| 5.1 | Search: 60 requests/hour per user |
| 5.2 | Stream lookups: 30/hour per user |
| 5.3 | Download commands: 20/hour per user |
| 5.4 | Account creation: 5/hour per IP |
| 5.5 | Failed logins: 10/hour per IP |
| 5.6 | Rate limited response returns 429 with `retryAfter` field |
| 5.7 | WebSocket rate limit sends error message, does NOT close connection |

### AC-6: Agent — Real-Debrid Client

| # | Criteria |
|---|---|
| 6.1 | `addMagnet` returns torrent ID; throws on HTTP error |
| 6.2 | `selectFiles` succeeds on 204; throws on failure |
| 6.3 | `pollUntilReady` returns links on "downloaded"; throws on error status, timeout |
| 6.4 | `unrestrictLink` returns download URL + size; throws on failure |
| 6.5 | `checkCache` returns boolean map for each info hash |
| 6.6 | `downloadMagnet` runs full pipeline: add → select → poll → unrestrict |
| 6.7 | RD API key never leaves the agent (never sent to relay) |

### AC-7: Agent — Download Handler

| # | Criteria |
|---|---|
| 7.1 | `download:request` generates job ID and sends `download:accepted` |
| 7.2 | Progress events sent every 1 second during download phase |
| 7.3 | `download:completed` sent with file path and final size |
| 7.4 | `download:failed` sent with error, phase, and retryable flag |
| 7.5 | Cancellation via `download:cancel` aborts active download |
| 7.6 | Concurrent downloads limited by `maxConcurrentDownloads` semaphore |
| 7.7 | Staging files cleaned up after successful organization |

### AC-8: Agent — Media Organizer

| # | Criteria |
|---|---|
| 8.1 | Movie organized to `{moviesDir}/{Title} ({Year}) [tmdb-{id}]/{Title} ({Year}).ext` |
| 8.2 | Episode organized to `{tvDir}/{Title} [tmdb-{id}]/Season {NN}/S{NN}E{NN} - {Episode Title}.ext` |
| 8.3 | `sanitize` removes illegal chars, replaces colons, collapses spaces |
| 8.4 | Creates parent directories if they don't exist |
| 8.5 | Overwrites duplicate files at destination |
| 8.6 | Handles missing episode title gracefully (uses episode number only) |

### AC-9: Agent — WebSocket Client

| # | Criteria |
|---|---|
| 9.1 | Connects with device token; sends `agent:hello` on connection |
| 9.2 | Sends `agent:heartbeat` every 30 seconds |
| 9.3 | Auto-reconnects with exponential backoff (1s → 30s max) |
| 9.4 | Resets backoff on successful connection |
| 9.5 | Queues outbound messages during reconnection |
| 9.6 | Handles `download:request`, `download:cancel`, `cache:check` commands |

### AC-10: Web App — Auth Pages

| # | Criteria |
|---|---|
| 10.1 | Login form with email + password; submits on Enter key |
| 10.2 | Signup form with email + password + confirm password |
| 10.3 | Shows validation errors inline (empty fields, password mismatch, min length) |
| 10.4 | Redirects to Search page on successful login/signup |
| 10.5 | Shows server errors via toast (409 email taken, 401 wrong credentials) |
| 10.6 | Redirects to login when accessing authenticated routes without token |

### AC-11: Web App — Search Page

| # | Criteria |
|---|---|
| 11.1 | Search input + submit button; button disabled when empty |
| 11.2 | Search results show poster, title, year, type badge, overview |
| 11.3 | Clicking result fetches streams and shows stream picker |
| 11.4 | Stream table shows name, attribute badges, size, seeders, download button |
| 11.5 | Stream filter bar with resolution, HDR, audio, cache chip groups |
| 11.6 | Filters: OR within group, AND across groups |
| 11.7 | "Showing X of Y streams" counter updates on filter change |
| 11.8 | Pagination with 5/10/25 per page options |
| 11.9 | Download button sends `download:request` via WebSocket |
| 11.10 | Device selector dropdown shows online agents; default pre-selected |
| 11.11 | Toast notification on download accepted/rejected |
| 11.12 | TV results show season/episode selector before stream list |
| 11.13 | RD cache check triggered when stream list displayed (via `cache:check` WebSocket message) |
| 11.14 | "RD Cached" badge appears per-stream after cache check returns |

### AC-12: Web App — Downloads Page

| # | Criteria |
|---|---|
| 12.1 | Active downloads show title, device badge, phase, progress bar, speed, ETA |
| 12.2 | Progress bar and stats update in real-time from WebSocket events |
| 12.3 | Cancel button sends `download:cancel` via WebSocket |
| 12.4 | Completed downloads show title, device, size, timestamp |
| 12.5 | Failed downloads show error message + retry button |
| 12.6 | Download history loaded from HTTP API, sorted by most recent |
| 12.7 | Filter buttons: All, Active, Completed, Failed |
| 12.8 | Empty state message when no downloads exist |

### AC-13: Web App — Devices Page

| # | Criteria |
|---|---|
| 13.1 | Device list shows name, platform icon, online/offline status, last seen |
| 13.2 | Default device has star indicator |
| 13.3 | Inline rename on device name click |
| 13.4 | "Set as default" button on non-default devices |
| 13.5 | Remove button with confirmation dialog |
| 13.6 | "Pair new device" shows generated code in large format |
| 13.7 | Code auto-refreshes when expired |
| 13.8 | Pairing detected in real-time (WebSocket device:status event) |
| 13.9 | Empty state with setup instructions |

### AC-14: Web App — Settings Page

| # | Criteria |
|---|---|
| 14.1 | Displays user email (read-only) |
| 14.2 | Change password form validates current password and min length |
| 14.3 | Delete account requires password confirmation |
| 14.4 | Relay version displayed in about section |

### AC-15: Web App — General UI

| # | Criteria |
|---|---|
| 15.1 | Sidebar navigation highlights active route |
| 15.2 | Connection status dot: green (connected), red (disconnected), yellow (connecting) |
| 15.3 | Toast notifications: success (green), error (red), info (blue); auto-dismiss 5s |
| 15.4 | All pages show loading spinners during data fetch |
| 15.5 | 401 responses trigger auto-refresh; redirect to login on refresh failure |
| 15.6 | Dark theme applied consistently across all pages |

---

## 8. Configuration & Environment Variables

### Relay Server

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `JWT_SECRET` | — | Secret for signing JWTs (required) |
| `TMDB_API_KEY` | — | TMDB API key (required) |
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |
| `NODE_ENV` | `development` | Environment mode |

### Agent

| Variable | Config Key | Default | Description |
|---|---|---|---|
| `RELAY_URL` | `relay` | `https://tadaima.app` | Relay server URL |
| `DEVICE_TOKEN` | `deviceToken` | — | Device auth token |
| `RD_API_KEY` | `realDebrid.apiKey` | — | Real-Debrid API key |
| `MOVIES_DIR` | `directories.movies` | — | Movies output directory |
| `TV_DIR` | `directories.tv` | — | TV shows output directory |
| `STAGING_DIR` | `directories.staging` | `/tmp/tadaima/staging` | Temp download directory |
| `MAX_CONCURRENT` | `maxConcurrentDownloads` | `2` | Max simultaneous downloads |
| `RD_POLL_INTERVAL` | `rdPollInterval` | `30` | RD poll interval (seconds) |

---

## 9. File Naming Conventions

### Movies
```
{MOVIES_DIR}/
  {Title} ({Year}) [tmdb-{tmdbId}]/
    {Title} ({Year}).{ext}
```
Example: `Movies/Interstellar (2014) [tmdb-157336]/Interstellar (2014).mkv`

### TV Shows
```
{TV_DIR}/
  {Title} [tmdb-{tmdbId}]/
    Season {NN}/
      S{NN}E{NN} - {Episode Title}.{ext}
```
Example: `TV/Breaking Bad [tmdb-1396]/Season 05/S05E16 - Felina.mkv`

### Sanitization Rules
- Remove: `< > " / \ | ? *`
- Replace colon `:` with ` - `
- Collapse multiple spaces to single space
- Strip leading/trailing dots, spaces, dashes

---

## 10. Distribution

### npm (developers)
```bash
npm install -g @tadaima/agent
tadaima setup
```

### Standalone Binary (general users)
Compiled with `bun build --compile` for each platform:
- `tadaima-win-x64.exe`
- `tadaima-macos-arm64`
- `tadaima-linux-x64`

Distributed via GitHub Releases.

### Docker (NAS / server users)
```yaml
services:
  tadaima:
    image: ghcr.io/tadaima-app/agent:latest
    environment:
      - RELAY_URL=https://tadaima.app
      - DEVICE_TOKEN=eyJ...
      - RD_API_KEY=your_key
    volumes:
      - /path/to/movies:/media/movies
      - /path/to/tv:/media/tv
      - ./config:/config
    restart: unless-stopped
```

### Self-Hosted Relay
```yaml
services:
  relay:
    image: ghcr.io/tadaima-app/relay:latest
    environment:
      - DATABASE_URL=postgres://...
      - JWT_SECRET=...
      - TMDB_API_KEY=...
    ports:
      - "3000:3000"

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=tadaima
      - POSTGRES_PASSWORD=...
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## 11. Test Strategy

### Relay
- **Unit tests:** Vitest for service logic (auth, pairing, rate limiting, message routing)
- **Integration tests:** Supertest for HTTP endpoints against test Postgres
- **WebSocket tests:** `ws` client library in test harness
- **Target:** 90%+ coverage on service logic

### Web App
- **Component tests:** Vitest + @testing-library/react
- **E2E tests:** Playwright with mocked relay API
- **Target:** All acceptance criteria covered

### Agent
- **Unit tests:** Vitest for RD client, download handler, media organizer
- **Integration tests:** End-to-end download flow with mocked RD API
- **Target:** 90%+ coverage on download pipeline

### Shared
- **Schema tests:** Validate Zod schemas accept valid messages and reject invalid ones
- **Target:** 100% coverage on message schemas

---

## 12. Resolved Decisions

1. **TV show downloads** — Default to downloading all cached files for the selected content. Once RD loads the cached files, give the user an option to select/deselect individual files before confirming.

2. **Multi-agent downloads** — Each user has a default device. The download button sends to the default, but a dropdown lets them pick a different online agent if they have multiple.

3. **Notifications** — None. The web UI's real-time progress is sufficient.

4. **Library browsing** — Not in scope. The web app is search + download only. Users manage their library through Plex/Jellyfin/etc.

5. **RD cache check** — Happens agent-side. When the user views streams for a title, the web app sends a `cache:check` message through the relay to the agent, which checks RD cache status using its own API key and returns `cache:result`. This adds 1–3 seconds but keeps RD keys off the server entirely.

6. **Business model** — Free + open source. Users bring their own Real-Debrid account. Hosted relay funded by donations. Self-hosting fully supported.

---

## 13. Open Questions

1. **Self-host deploy story** — How easy should self-hosting be? One-click Railway template? Docker Compose with Postgres included? Helm chart for Kubernetes?

2. **RD cache check latency** — The agent-side RD cache check adds a round trip (web → relay → agent → RD → agent → relay → web). Is 1–3 seconds acceptable, or should we explore optional server-side RD key storage for faster checks?

3. **Abuse vectors** — With a free service, what other abuse patterns should we anticipate beyond rate limiting? (e.g., using the relay as a general-purpose WebSocket proxy, account farming)
