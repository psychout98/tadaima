# Tadaima (ただいま) — Project Plan

> From one-click deploy to public release.

This document is the master project plan for Tadaima. It breaks the full build into iterative development phases, each with clear deliverables, feature specs, and acceptance criteria. Phases are sequential — each builds on the last — but there are no deadlines. Ship when it's ready.

---

## How This Plan Is Organized

Each phase follows a consistent structure:

- **Goal** — what this phase accomplishes in one sentence
- **Deliverables** — concrete outputs (packages, endpoints, pages, configs)
- **Feature Specs** — detailed requirements for every feature in the phase
- **Demo Checkpoints** — for phases that touch the web app, a description of what should be demonstrable in a browser
- **Acceptance Criteria** — testable conditions that confirm the phase is done
- **Exit Criteria** — what must be true before moving to the next phase

---

## Phase Overview

| Phase | Name | Focus |
|-------|------|-------|
| 0 | **Local Dev Environment** | Monorepo scaffold, tooling, local Postgres, dev scripts |
| 1 | **Shared Protocol & Types** | Zod schemas, TypeScript types, message protocol contract |
| 2 | **Admin Auth & Profiles** | Admin login, profile CRUD, first-run wizard, profile picker |
| 3 | **Device Pairing** | Pairing code flow, RD key distribution, agent setup CLI |
| 4 | **WebSocket Relay** | Connection pools, message routing, heartbeat, online/offline |
| 5 | **Search & Browse** | TMDB/Torrentio proxy, caching, web search page + stream picker |
| 6 | **Download Pipeline & Queue** | Agent RD client, download handler, file organizer, offline queue |
| 7 | **Real-Time UI** | Live progress bars, queued downloads, download history, toasts |
| 8 | **Agent Polish** | TUI, daemon mode, system service install, config CLI, log viewer |
| 9 | **Testing & Hardening** | Full test suites, error handling audit, edge cases |
| 10 | **Distribution & Deployment** | Railway deploy button, Docker builds, standalone binaries, npm |
| 11 | **Public Release** | Landing page, docs site, GitHub repo polish, initial launch |

---

## Phase 0: Local Dev Environment

### Goal
Stand up the monorepo with all four packages, local Postgres, and a dev workflow where every package hot-reloads.

### Deliverables

- Initialized pnpm workspace with Turborepo
- Four empty packages: `relay`, `web`, `agent`, `shared`
- `docker-compose.yml` for local Postgres
- Root-level dev scripts (`dev`, `build`, `lint`, `test`, `typecheck`)
- ESLint + Prettier config (shared across packages)
- TypeScript project references (composite builds)
- `.env.example` files for relay and agent
- GitHub repo initialized with `.gitignore`, license (MIT), and branch protection

### Feature Specs

**F0.1 — Monorepo Structure**
```
tadaima/
├── packages/
│   ├── relay/          # Hono server (src/index.ts entry)
│   ├── web/            # Vite + React (src/main.tsx entry)
│   ├── agent/          # CLI entry (src/index.ts)
│   └── shared/         # Types + schemas (src/index.ts barrel export)
├── package.json        # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json          # Pipeline: build, dev, lint, test, typecheck
├── tsconfig.base.json  # Shared TS config
├── .eslintrc.cjs
├── .prettierrc
├── docker-compose.yml  # Postgres 16 + adminer (dev only)
└── .env.example
```

**F0.2 — Turborepo Pipeline**
- `dev` — runs all packages in parallel with watch mode
- `build` — builds `shared` → `relay` → `web` → `agent` (respects dependency graph)
- `lint` — ESLint across all packages
- `test` — Vitest across all packages
- `typecheck` — `tsc --noEmit` across all packages

**F0.3 — Local Postgres**
- Docker Compose service: `postgres:16-alpine`
- Default database: `tadaima_dev`
- Adminer on port 8080 for visual inspection
- Relay reads `DATABASE_URL` from `.env`

**F0.4 — Package Entry Points**
- `relay`: Hono server listening on port 3000, `GET /api/health` returns `{ "status": "ok" }`
- `web`: Vite dev server on port 5173, renders "Tadaima" placeholder
- `agent`: CLI entry that prints version and exits
- `shared`: Barrel export (empty for now)

### Exit Criteria
- [ ] `pnpm install` succeeds from a fresh clone
- [ ] `pnpm dev` starts all four packages + Postgres concurrently
- [ ] `pnpm build` completes without errors
- [ ] `pnpm typecheck` passes
- [ ] Relay health endpoint responds at `http://localhost:3000/api/health`
- [ ] Web dev server renders at `http://localhost:5173`
- [ ] Agent CLI prints version info

---

## Phase 1: Shared Protocol & Types

### Goal
Define the contract between all components — every message type, API schema, and shared utility — so that relay, web, and agent can be built independently against a stable interface.

### Deliverables

- Zod schemas for all WebSocket message types
- TypeScript types exported from schemas
- Shared error type definitions
- API request/response type definitions
- Utility functions: ULID message ID generation, timestamp helpers
- Drizzle ORM schema definitions (all tables including `download_queue` and `recently_viewed`)

### Feature Specs

**F1.1 — WebSocket Message Schemas (Zod)**

All messages share a base envelope:
```typescript
{
  id: string       // ULID
  type: string     // message type identifier
  timestamp: number // unix milliseconds
  payload: unknown  // type-specific
}
```

Command messages (web → relay → agent):
- `download:request` — trigger a download (tmdbId, imdbId, title, year, mediaType, season?, episode?, episodeTitle?, magnet, torrentName, expectedSize)
- `download:cancel` — cancel active download (jobId)
- `cache:check` — request RD cache check (requestId, infoHashes[])

Event messages (agent → relay → web):
- `download:accepted` — agent acknowledges (jobId, requestId)
- `download:progress` — progress update (jobId, phase, progress 0–100, downloadedBytes?, totalBytes?, speedBps?, eta?)
- `download:completed` — finished (jobId, filePath, finalSize)
- `download:failed` — errored (jobId, error, phase, retryable)
- `download:rejected` — relay or agent rejects (requestId, reason)
- `download:queued` — relay queued for offline device (queueId, requestId, title, deviceName)
- `cache:result` — RD cache response (requestId, cached: Record<string, boolean>)

System messages:
- `agent:hello` — agent connection announcement (version, platform, activeJobs, diskFreeBytes)
- `agent:heartbeat` — periodic status (activeJobs, diskFreeBytes, uptimeSeconds)
- `device:status` — relay notifies web of agent state changes (deviceId, isOnline, lastSeenAt)
- `error` — generic error (code, detail, originalMessageId?)

**F1.2 — API Type Definitions**

Type-safe interfaces for all relay HTTP endpoints covering admin auth, profiles, devices, search, streams, downloads, instance settings, and system routes. Includes request bodies, response bodies, query parameters, and the standard error envelope (`{ error, detail }`).

**F1.3 — Database Schema (Drizzle)**

Nine tables: `admin`, `instance_settings`, `profiles`, `refresh_tokens`, `devices`, `pairing_codes`, `download_queue`, `download_history`, `recently_viewed`. Defined as Drizzle ORM table definitions with proper relations, constraints, and indices.

**F1.4 — Shared Utilities**
- `createMessageId()` — generates ULID
- `createTimestamp()` — returns unix milliseconds
- `sanitizeFilename(name)` — removes illegal chars (`< > " / \ | ? *`), replaces `:` with ` - `, collapses spaces, strips leading/trailing dots/spaces/dashes
- `buildMoviePath(title, year, tmdbId, ext)` — Plex-compatible movie path
- `buildEpisodePath(title, tmdbId, season, episode, episodeTitle, ext)` — Plex-compatible episode path

### Exit Criteria
- [ ] All Zod schemas parse valid fixtures and reject invalid ones (unit tests)
- [ ] TypeScript types inferred from schemas compile correctly
- [ ] Drizzle schema generates expected SQL via `drizzle-kit generate`
- [ ] Shared package exports all types and utilities cleanly
- [ ] Relay and web packages can import from `@tadaima/shared` without errors

---

## Phase 2: Admin Auth & Profiles

### Goal
The admin can create an account, log in, configure instance settings (RD key, TMDB key), and create profiles. Users can pick a profile from a Netflix-style picker to enter the app.

### Deliverables

- Relay admin auth service (create account, login, refresh, logout)
- Relay profile CRUD service
- Relay instance settings service (RD key, TMDB key — encrypted storage)
- Relay recently viewed service
- Database migrations for `admin`, `profiles`, `refresh_tokens`, `instance_settings`, `recently_viewed`
- Web first-run setup wizard
- Web admin login page
- Web profile picker page
- Web admin panel (manage profiles, instance settings, usage stats)

### Feature Specs

**F2.1 — First-Run Detection**
- On startup, relay checks if an admin account exists
- If no admin: `GET /api/setup/status` returns `{ "needsSetup": true }`
- Web app checks this on load and redirects to `/setup` if needed
- Once admin is created, setup is locked out permanently

**F2.2 — First-Run Setup Wizard (Web)**
Steps presented as a clean, guided flow:
1. **Create admin account** — username + password (min 8 chars)
2. **Enter TMDB API key** — text input + link to TMDB's free API key page + "Test" button
3. **Enter Real-Debrid API key** — text input + link to RD account page + "Test" button that validates against RD `/user` endpoint
4. **Create first profile** — name + select avatar color/emoji
5. **Done** — redirect to profile picker

All settings stored in `instance_settings` table (sensitive values encrypted at rest).

**F2.3 — Admin Auth Endpoints**

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/setup/status` | Returns `{ needsSetup: boolean }`. Public endpoint. |
| POST | `/api/setup/complete` | Creates admin account + saves instance settings. Only works once. |
| POST | `/api/auth/login` | Admin username + password → JWT access + refresh tokens. |
| POST | `/api/auth/refresh` | Rotate refresh token, issue new pair. |
| POST | `/api/auth/logout` | Revoke refresh token. |

**F2.4 — JWT Structure**
- Admin access token: `{ sub: adminId, type: "admin", iat, exp }` — 15-minute expiry
- Admin refresh token: `{ sub: adminId, type: "admin_refresh", iat, exp }` — 7-day expiry
- Profile session token: `{ sub: profileId, type: "profile", iat, exp }` — 24-hour expiry (longer since profiles are low-risk)
- Device token: `{ sub: profileId, type: "device", deviceId, iat }` — no expiry, revocable
- All signed with `jose` (HS256), secret auto-generated on first run and stored in `instance_settings`

**F2.5 — Profile Management Endpoints (Admin-only)**

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/profiles` | List all profiles (public — needed for profile picker). Returns id, name, avatar, hasPin. |
| POST | `/api/profiles` | Create profile (admin-only). Name, avatar, optional PIN. |
| PATCH | `/api/profiles/:id` | Update profile name, avatar, or PIN (admin-only). |
| DELETE | `/api/profiles/:id` | Delete profile and all associated data (admin-only). |
| POST | `/api/profiles/:id/select` | Select a profile. Validates optional PIN. Returns profile session token. |

**F2.6 — Instance Settings Endpoints (Admin-only)**

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/admin/settings` | Get instance settings (RD key masked, TMDB key masked). |
| PATCH | `/api/admin/settings` | Update instance settings (RD key, TMDB key). |
| POST | `/api/admin/settings/test-rd` | Test RD API key against `/user` endpoint. |
| POST | `/api/admin/settings/test-tmdb` | Test TMDB API key against `/configuration` endpoint. |

**F2.7 — Profile Picker (Web)**
- Netflix-style grid: avatar circles/squares with profile name underneath
- Click a profile:
  - No PIN → immediately issue profile session token, enter app
  - Has PIN → show PIN input (4–6 digits), validate, then enter app
- Small "Manage" link visible only when admin is logged in → goes to `/admin`
- Profile session stored in zustand (memory only)

**F2.8 — Admin Panel (Web)**
- Accessible at `/admin`, requires admin auth
- **Profiles section**: list of profiles with edit/delete buttons, "Add profile" button
- **Instance settings section**: RD API key (masked input with reveal toggle), TMDB API key (same), "Test" buttons for each
- **Usage stats section**: per-profile usage — downloads triggered, searches performed, total data downloaded. Informational only (no limits imposed). Helps admin see if someone is being excessive.
- **Instance info**: relay version, database status

**F2.9 — Web App Shell**
- Sidebar nav: Search, Downloads, Devices (visible when profile is selected)
- Profile avatar + name in sidebar header, click to switch profiles
- Connection status dot (green/yellow/red) — placeholder until Phase 4

### Demo Checkpoint

> **Demo 2**: Open the web app on a fresh instance. You see the setup wizard. Create an admin account, enter TMDB and RD API keys (with validation), create a profile named "Noah". Get redirected to the profile picker. Click "Noah" — enter the app shell with placeholder pages. Click the profile name in the sidebar to go back to profile picker. Click "Manage" → log in as admin → see the admin panel with profile list and settings. Create a second profile "Dad" with a PIN. Go back to profile picker — both profiles appear. Click "Dad" → enter PIN → enter app.

### Acceptance Criteria

| # | Criteria |
|---|---|
| 2.1 | First-run wizard only appears on fresh instance (no admin exists) |
| 2.2 | Admin account created with valid username + password (min 8 chars); password bcrypt hashed |
| 2.3 | TMDB and RD API keys validated during setup and stored encrypted |
| 2.4 | Setup wizard locked out after admin account created |
| 2.5 | Admin login returns JWT access + refresh tokens; 401 on invalid credentials |
| 2.6 | Access token expires after 15 minutes; refresh token after 7 days |
| 2.7 | Refresh rotation works (old token revoked, new pair issued) |
| 2.8 | Profiles created with name + optional avatar + optional PIN |
| 2.9 | Profile picker shows all profiles; PIN-protected profiles require correct PIN |
| 2.10 | Profile selection issues profile-scoped session token (24h expiry) |
| 2.11 | Admin-only endpoints reject non-admin tokens with 403 |
| 2.12 | Instance settings update correctly; sensitive values encrypted at rest |

### Exit Criteria
- [ ] Full setup wizard flow works end-to-end on a fresh database
- [ ] Admin login/logout/refresh works
- [ ] Profiles CRUD works from admin panel
- [ ] Profile picker renders and selects profiles correctly
- [ ] PIN validation works
- [ ] Instance settings save and mask correctly
- [ ] Profile session token scopes access correctly

---

## Phase 3: Device Pairing

### Goal
Each profile can pair agents to their account using a short code flow. The web app shows a devices page. The agent CLI has a `tadaima setup` command that walks through pairing and receives the shared RD API key automatically.

### Deliverables

- Relay pairing service (code generation, claim with RD key distribution, confirm)
- Relay device management endpoints (list, rename, set default, revoke)
- Database migrations for `devices` and `pairing_codes`
- Web devices page with pair-new-device flow
- Agent CLI: `tadaima setup` interactive flow
- Agent config file management (`~/.config/tadaima/config.json`)

### Feature Specs

**F3.1 — Pairing Code Generation**
- 6 characters, alphanumeric, excluding ambiguous chars (I, O, 0, 1)
- Valid for 10 minutes
- One active code per profile at a time
- Stored in `pairing_codes` table with expiry timestamp

**F3.2 — Pairing Flow (Updated with RD Key Distribution)**

```
Profile (Web App)                Relay                          Agent CLI
   │                              │                               │
   │  POST /api/devices/pair/     │                               │
   │  request                     │                               │
   │─────────────────────────────►│                               │
   │  { code: "A7X9K2" }         │                               │
   │◄─────────────────────────────│                               │
   │                              │                               │
   │  User reads code aloud       │    $ tadaima setup            │
   │  or copies it                │    ? Relay URL: https://...   │
   │                              │    ? Pairing code: A7X9K2     │
   │                              │◄──────────────────────────────│
   │                              │  POST /api/devices/pair/claim │
   │                              │  { code, name, platform }     │
   │                              │──────────────────────────────►│
   │                              │  { deviceId, deviceToken,     │
   │                              │    rdApiKey, wsUrl }          │
   │                              │                               │
   │  Auto-detects pairing via    │                               │
   │  WebSocket or polling        │                               │
   │◄─────────────────────────────│   ✓ Config saved, starting   │
   │                              │     WebSocket connection      │
```

Key change: the **claim response includes the RD API key** from instance settings. The agent stores it locally and uses it for all RD operations. The agent setup flow no longer prompts for an RD key.

**F3.3 — Device Management Endpoints**

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/devices` | List all devices for the current profile session. |
| PATCH | `/api/devices/:id` | Update device name or isDefault. |
| DELETE | `/api/devices/:id` | Revoke device. Deletes row, invalidates token. |
| POST | `/api/devices/pair/request` | Generate pairing code for current profile. |
| POST | `/api/devices/pair/claim` | Agent claims code. Returns deviceId, deviceToken, rdApiKey, wsUrl. |
| GET | `/api/agent/config` | Agent fetches current config (RD key, relay version). Authenticated via device token. Used for RD key rotation recovery. |

**F3.4 — Device Constraints**
- Max 5 devices per profile
- First paired device automatically set as default
- Device token is a long-lived JWT: `{ sub: profileId, type: "device", deviceId, iat }` (no expiry, revocable)
- Token stored as SHA-256 hash in `devices.token_hash`

**F3.5 — Agent `tadaima setup` Flow**
1. Prompt for relay URL (e.g., `https://your-instance.up.railway.app`)
2. Prompt for pairing code (user gets this from web app)
3. Call `POST /api/devices/pair/claim` with code + auto-detected device name + platform
4. Receive device token + RD API key, store both in config
5. Prompt for movies directory path
6. Prompt for TV shows directory path
7. Write config to `~/.config/tadaima/config.json`
8. Print success: "Connected! This device is now paired as 'noah-macbook' on profile 'Noah'"

**F3.6 — Agent Config File**
```json
{
  "relay": "https://your-instance.up.railway.app",
  "deviceToken": "eyJ...",
  "deviceId": "uuid",
  "deviceName": "noah-macbook",
  "profileName": "Noah",
  "directories": {
    "movies": "/mnt/media/Movies",
    "tv": "/mnt/media/TV",
    "staging": "/tmp/tadaima/staging"
  },
  "realDebrid": {
    "apiKey": "received-during-pairing"
  },
  "maxConcurrentDownloads": 2,
  "rdPollInterval": 30
}
```

**F3.7 — Web Devices Page**
- Device list: cards showing name, platform icon, online/offline dot, "Last seen X ago", default star, active download count
- Inline rename (click device name to edit)
- "Set as default" button on non-default devices
- Remove button with confirmation dialog
- "Pair new device" button → generates code → displays in large copyable format → shows expiration countdown → instructions text → auto-detects when claimed
- Empty state: "No devices paired yet. Install the agent on your machine to get started."

### Demo Checkpoint

> **Demo 3**: Select a profile in the web app. Navigate to the Devices page — empty state. Click "Pair new device" — a 6-character code appears with a countdown. In a terminal, run `tadaima setup`, enter the relay URL and code. Note: no RD key prompt. The web app updates to show the newly paired device. Rename the device. Remove it and pair again.

### Acceptance Criteria

| # | Criteria |
|---|---|
| 3.1 | Pairing code is 6 chars alphanumeric, excluding ambiguous chars (I/O/0/1) |
| 3.2 | Pairing code expires after 10 minutes |
| 3.3 | Agent claims code → receives device token + device ID + RD API key |
| 3.4 | Claiming expired code returns 404 |
| 3.5 | Claiming already-claimed code returns 409 |
| 3.6 | Each profile can pair up to 5 devices |
| 3.7 | First paired device is automatically set as default |
| 3.8 | Revoking a device closes its WebSocket connection (once Phase 4 is built) |
| 3.9 | Device can be renamed via PATCH |
| 3.10 | Agent config file written with relay URL, tokens, RD key, and media directories |
| 3.11 | RD API key distributed from instance settings, not prompted during agent setup |

### Exit Criteria
- [ ] Full pairing flow works end-to-end (code → claim → device appears)
- [ ] Expired and already-claimed codes rejected correctly
- [ ] Max 5 devices per profile enforced
- [ ] Agent config file written and readable
- [ ] Agent setup flow completes without asking for RD key
- [ ] Devices page renders device list with all controls
- [ ] Inline rename and set-default work

---

## Phase 4: WebSocket Relay

### Goal
The relay maintains persistent WebSocket connections from both agents and web clients, routes messages between them, and tracks agent online/offline status in real time — all scoped per profile.

### Deliverables

- Relay WebSocket upgrade handler (two endpoints: `/ws` for clients, `/ws/agent` for agents)
- Connection pool manager (agents map + clients map, keyed by profile)
- Message routing logic
- Heartbeat handling + online/offline status tracking
- Agent WebSocket client with auto-reconnect
- Web WebSocket client integrated with zustand

### Feature Specs

**F4.1 — WebSocket Authentication**
- Client endpoint: `wss://{host}/ws?token={profileSessionToken}` — validated as profile session JWT
- Agent endpoint: `wss://{host}/ws/agent?token={deviceToken}` — validated as device JWT
- Invalid/expired token → reject with close code `4001`
- Connection adds to appropriate pool on success

**F4.2 — Connection Pools**
```
agents:  Map<"${profileId}:${deviceId}", WebSocket>
clients: Map<profileId, Set<WebSocket>>
```
- On agent connect: set `devices.is_online = true`, broadcast `device:status` to profile's web clients
- On agent disconnect: set `devices.is_online = false`, update `devices.last_seen_at`, broadcast `device:status`

**F4.3 — Message Routing Rules (Profile-Scoped)**

All routing is scoped by profile — messages from one profile never reach another profile's agents or clients.

- `download:*` commands from web → route to target agent (by profile's default device or explicit `targetDeviceId`)
- `download:*` events from agent → broadcast to all connected web clients for that profile
- `cache:check` from web → route to specified agent
- `cache:result` from agent → route to requesting web client
- `agent:heartbeat` → consumed by relay (update DB), NOT forwarded
- `device:status` → generated by relay on connect/disconnect, sent to web clients
- Message to offline agent → handled by download queue (Phase 6), respond with `download:queued`

**F4.4 — Heartbeat Handling**
- Agent sends `agent:heartbeat` every 30 seconds
- Relay updates `devices.last_seen_at` and `devices.is_online`
- If no heartbeat received for 90 seconds, mark device offline

**F4.5 — Agent WebSocket Client**
- Connect to `wss://{relay}/ws/agent?token={deviceToken}`
- Send `agent:hello` immediately after connection
- Send `agent:heartbeat` every 30 seconds
- Auto-reconnect with exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
- Reset backoff on successful connection
- Queue outbound messages during reconnection

**F4.6 — Web WebSocket Client**
- Single persistent connection per profile session
- Connect on profile selection, disconnect on profile switch or logout
- Auto-reconnect with exponential backoff (1s → 30s max)
- Merge incoming events into zustand store (`activeDownloads`, `devices` status)
- Queue outbound messages during reconnection
- Connection status exposed in store: `"connecting" | "connected" | "disconnected"`

### Demo Checkpoint

> **Demo 4**: Select a profile in the web app. Start the agent in a terminal (`tadaima start`). The web app's connection indicator turns green. The Devices page shows the agent as "Online". Stop the agent — status changes to "Offline" within a few seconds. Start it again — back to "Online". Open a second browser tab — both tabs reflect the same status. Switch to a different profile — the first profile's agent status is not visible.

### Acceptance Criteria

| # | Criteria |
|---|---|
| 4.1 | Agent connects with valid device token; rejected with 4001 on invalid token |
| 4.2 | Client connects with valid profile session token; rejected with 4001 on invalid token |
| 4.3 | Agent connection updates `devices.is_online = true`; disconnect updates to `false` |
| 4.4 | `device:status` broadcast to web clients on agent connect/disconnect |
| 4.5 | Commands from web routed to correct agent by deviceId within profile |
| 4.6 | Events from agent broadcast to all web clients for that profile only |
| 4.7 | Heartbeat updates `devices.last_seen_at`; NOT forwarded to web clients |
| 4.8 | Auto-reconnect with exponential backoff works after network drop |
| 4.9 | Message queue drains after reconnection |
| 4.10 | Profile isolation: messages from one profile never reach another |

### Exit Criteria
- [ ] Agent connects and sends `agent:hello`
- [ ] Heartbeat updates `last_seen_at` in database
- [ ] Online/offline status changes broadcast to web clients in real time
- [ ] Messages route correctly between web and agent within profile scope
- [ ] Auto-reconnect works after network drop
- [ ] Message queue drains after reconnection
- [ ] Profile isolation verified (cross-profile messages never leak)

---

## Phase 5: Search & Browse

### Goal
Users can search for movies and TV shows through the web app, view available streams with filtering, and see the full browse experience — everything up to (but not including) actually triggering a download.

### Deliverables

- Relay API proxy endpoints (TMDB search, media detail, Torrentio streams, poster images)
- In-memory cache layer with configurable TTLs
- Web search page with results grid
- Web stream picker with filter bar
- TV season/episode selector
- Device selector dropdown
- RD cache check flow (web → relay → agent → RD → back)

### Feature Specs

**F5.1 — Relay API Proxy Endpoints**

| Endpoint | Upstream | Cache TTL | Notes |
|----------|----------|-----------|-------|
| `GET /api/search?q=...` | TMDB `/search/multi` | 1 hour | Max 20 results. Returns tmdbId, title, year, mediaType, overview, posterPath, imdbId. |
| `GET /api/media/:type/:tmdbId` | TMDB `/movie/:id` or `/tv/:id` | 24 hours | Includes seasons array for TV. Anime detection via keyword 210024 or genre 16 + JP origin. |
| `GET /api/streams/:type/:imdbId` | Torrentio addon API | 15 min | Query params `?season=N&episode=N` for TV. Returns name, infoHash, sizeBytes, seeders, magnet. |
| `GET /api/poster/:path` | TMDB image CDN | 7 days | Returns `image/jpeg` binary. |

**Recently Viewed Endpoints:**
- `GET /api/recently-viewed` — returns the current profile's recently viewed titles (max 20, newest first)
- `POST /api/recently-viewed` — upsert a title (called when user clicks into stream picker). Body: `{ tmdbId, mediaType, title, year, posterPath, imdbId }`

- TMDB API key read from `instance_settings` table (set during setup wizard)
- Upstream failure returns 502 with standard error envelope
- Cache stored in-memory (Map with TTL eviction); Redis-ready interface for future scaling

**F5.2 — Search Page**

Layout (top to bottom):
1. **Search bar** — text input with placeholder "Search movies and TV shows...", submit button, search on Enter
2. **Recently viewed strip** — horizontal row of small poster thumbnails (6-8 visible). Click any to jump straight to its stream picker. Hidden until the profile has viewed at least one title. Stored per-profile in `recently_viewed` table (max 20 entries, oldest evicted). Updated whenever a user clicks into a title's stream picker.
3. **Results grid** — responsive grid of poster cards
4. **Stream picker** — slides in below/replaces results when a card is clicked

**Search result card:**
- TMDB poster image (via `/api/poster/:path`)
- Title
- Year
- Type badge: "Movie" (indigo) or "TV" (blue)
- Truncated overview (2 lines)
- Click → fetch streams → show stream picker

**F5.3 — Stream Picker**

Appears after clicking a search result:

1. **Media header**: poster thumbnail, title, year, type badge, IMDb link badge, overview
2. **Filter bar**: toggleable chip groups
   - Resolution: 480p, 720p, 1080p, 2160p
   - HDR/DV: HDR, HDR10+, Dolby Vision
   - Audio: 2.0, 5.1, 7.1, Atmos
   - Cache: RD Cached (populated after agent-side check)
   - Filter logic: OR within a group, AND across groups
   - Active filter count badge, "Clear all" button
   - "Showing X of Y streams" counter
3. **Stream table**: columns — name, attribute badges (resolution, HDR, audio parsed from torrent name), size (human-readable), seeders, download button
4. **Pagination**: 5 / 10 / 25 per page selector

**F5.4 — TV Season/Episode Selector**
- When a TV result is clicked, show season dropdown (populated from `/api/media/tv/:tmdbId`)
- On season select, show episode list or allow "Full Season" selection
- Stream list fetched for the specific season+episode (or season pack)

**F5.5 — Device Selector**
- Dropdown near the download button
- Shows all online devices for the current profile (name + platform icon)
- Default device pre-selected
- Offline devices shown but enabled with "Offline — will queue" label

**F5.6 — RD Cache Check**
- When stream list is displayed and an agent is online:
  1. Web sends `cache:check` with all stream infoHashes via WebSocket
  2. Relay routes to the profile's default (or selected) agent
  3. Agent calls RD `GET /torrents/instantAvailability/{hashes}`
  4. Agent sends `cache:result` back through relay
  5. Web updates stream table with "RD Cached" badges
- If no agent online, cache badges are simply not shown (graceful degradation)
- Loading state: "Checking RD cache..." spinner in filter bar

### Demo Checkpoint

> **Demo 5**: Select a profile. Type "Interstellar" in the search bar. A grid of results appears with poster images. Click on the Interstellar movie card. The stream picker appears showing available torrents with resolution/size/seeder info. Toggle the "2160p" filter — the list narrows. The device selector shows your paired agent. If the agent is running, "RD Cached" badges appear on some streams after a brief loading state. For a TV show like "Breaking Bad", clicking it shows a season selector, then episodes, then streams for a specific episode. The device selector shows "Offline — will queue" for devices that aren't running.

### Acceptance Criteria

| # | Criteria |
|---|---|
| 5.1 | Search proxy returns TMDB results; cached for 1 hour |
| 5.2 | Media detail proxy returns movie or TV info; cached for 24 hours |
| 5.3 | Stream proxy returns Torrentio streams; cached for 15 minutes |
| 5.4 | Poster proxy serves TMDB images; cached for 7 days |
| 5.5 | Proxy returns 502 on upstream failure with standard error envelope |
| 5.6 | TMDB API key never exposed to clients (read from instance_settings server-side) |
| 5.7 | TV media details include season/episode counts |
| 5.8 | Search input + submit button; search on Enter; button disabled when empty |
| 5.9 | Results show poster, title, year, type badge, overview |
| 5.10 | Stream filter bar filters correctly (OR within group, AND across groups) |
| 5.11 | "Showing X of Y streams" counter updates on filter change |
| 5.12 | RD cache check works end-to-end when agent is online; degrades gracefully when offline |
| 5.13 | Device selector shows online/offline agents with queue indication for offline |
| 5.14 | Recently viewed strip shows titles the profile has clicked into |
| 5.15 | Clicking a recently viewed title jumps to populated stream picker |
| 5.16 | Recently viewed updates when a new title is viewed; oldest entries evicted past 20 |

### Exit Criteria
- [ ] Search returns TMDB results with posters
- [ ] Stream lookup returns Torrentio data
- [ ] Caching works at correct TTLs
- [ ] Stream filter bar filters correctly
- [ ] TV season/episode selector populates and fetches streams
- [ ] RD cache check round-trip works when agent is online
- [ ] Graceful handling when agent is offline

---

## Phase 6: Download Pipeline & Queue

### Goal
The agent receives download commands, runs the full Real-Debrid pipeline, downloads files, organizes them into Plex-compatible structure, and reports progress. When a device is offline, downloads queue in the relay and get delivered automatically on reconnect.

### Deliverables

- Relay download queue service (store when offline, deliver on reconnect)
- Agent Real-Debrid client (TypeScript)
- Agent download handler (command processing + job queue)
- Agent file download service (chunked HTTP with progress)
- Agent media organizer (Plex-compatible folder structure)
- Progress event streaming through WebSocket
- Download cancellation support
- Concurrent download queue with semaphore
- Agent on-connect queue pickup

### Feature Specs

**F6.1 — Relay Download Queue**

When a `download:request` arrives and the target device is offline:
1. Store the full request payload in `download_queue` table with status `"queued"`
2. Respond to web client with `download:queued` message (includes title, device name)
3. When the target agent connects (sends `agent:hello`):
   a. Query `download_queue` for pending entries matching this profile + device
   b. Send each as a normal `download:request` via WebSocket
   c. Update queue status to `"delivered"`
4. If queued for >14 days, mark as `"expired"` (don't auto-deliver)
5. Queue entries cancelable from web UI (deletes from queue)

**F6.2 — Real-Debrid Client**

Base URL: `https://api.real-debrid.com/rest/1.0`
Auth: `Authorization: Bearer {rdApiKey}` (key received during pairing)

| Method | Behavior |
|--------|----------|
| `addMagnet(magnet)` | `POST /torrents/addMagnet` → returns torrent ID. Throws on HTTP error. |
| `selectFiles(torrentId, fileIds?)` | `POST /torrents/selectFiles/{id}` → select all or specific files. 204 on success. |
| `pollUntilReady(torrentId)` | Poll `GET /torrents/info/{id}` every `rdPollInterval` seconds (default 30). Done when status is `"downloaded"`. Error on `"error"`, `"virus"`, `"dead"`, `"magnet_error"`. Timeout after 30 minutes. |
| `unrestrictLink(link)` | `POST /unrestrict/link` → download URL + file size. |
| `unrestrictAll(links)` | Unrestrict all links in sequence, return array of `{ url, size }`. |
| `checkCache(infoHashes)` | `GET /torrents/instantAvailability/{hashes}` → `Record<string, boolean>`. |
| `downloadMagnet(magnet)` | Full pipeline: add → select → poll → unrestrict. |

**F6.3 — Download Handler**

Processes `download:request` messages (whether live or from queue):
1. Validate request payload against Zod schema
2. Generate job ID (ULID)
3. Check concurrent download limit (per-agent semaphore with `maxConcurrentDownloads`, default 2)
4. If agent's local queue is full, send `download:rejected` with reason `"queue_full"`
5. Send `download:accepted` with jobId + requestId
6. Execute pipeline:
   - Phase `"adding"` — `addMagnet(magnet)`
   - Phase `"waiting"` — `pollUntilReady(torrentId)` with periodic progress events
   - Phase `"unrestricting"` — `unrestrictAll(links)`
   - Phase `"downloading"` — download files to staging dir with progress
   - Phase `"organizing"` — move to Plex-compatible structure
7. On success: send `download:completed` with filePath + finalSize
8. On error: send `download:failed` with error message, phase, retryable flag
9. Clean up staging files after successful organization

**F6.4 — File Download Service**
- Chunked HTTP download using `got` or native `fetch` with streaming
- 64KB read chunks, write to disk in staging directory
- Progress reporting: `downloadedBytes`, `totalBytes`, `speedBps`, `eta`
- Progress events throttled to 1 per second via WebSocket
- Cancellation via `AbortController` (triggered by `download:cancel`)
- No resume on failure — retry from RD unrestrict step

**F6.5 — Media Organizer**

Movies:
```
{moviesDir}/{Title} ({Year}) [tmdb-{tmdbId}]/
  {Title} ({Year}).{ext}
```

TV Shows:
```
{tvDir}/{Title} [tmdb-{tmdbId}]/
  Season {NN}/
    S{NN}E{NN} - {Episode Title}.{ext}
```

- `sanitize(name)` — remove `< > " / \ | ? *`, replace `:` with ` - `, collapse spaces, strip leading/trailing dots/spaces/dashes
- Create parent directories if they don't exist
- Overwrite duplicate files at destination
- Handle missing episode title gracefully (episode number only)

**F6.6 — Cancellation**
- `download:cancel` with `jobId` → abort current operation at any phase
- Clean up partial files in staging
- For queued (not-yet-delivered) downloads: web sends cancel → relay deletes from `download_queue`

**F6.7 — Agent On-Connect Queue Pickup**
- After sending `agent:hello`, the relay checks for queued downloads
- Queued requests delivered as normal `download:request` messages
- Agent processes them identically to live requests (no special handling needed)
- Web clients notified as each queued item transitions to active

### Demo Checkpoint

> **Demo 6a (Online)**: Search for "The Matrix" in the web app. Click on a cached stream and hit Download. Switch to the terminal where the agent is running — you see log output showing the RD pipeline phases. The file appears in the configured movies directory in Plex-compatible structure. Cancel a second download mid-progress — the agent aborts and cleans up.

> **Demo 6b (Offline Queue)**: Stop the agent. Search for "Interstellar" and hit Download. The web app shows "Queued — will download when noah-macbook is online." Start the agent — within seconds, the queued download starts automatically. The web UI transitions from "Queued" to active progress.

### Acceptance Criteria

| # | Criteria |
|---|---|
| 6.1 | Download request to offline agent stored in queue (not rejected) |
| 6.2 | Queued downloads delivered to agent on reconnect |
| 6.3 | Queue entries cancelable from web UI |
| 6.4 | Queue entries expire after 14 days |
| 6.5 | `addMagnet` returns torrent ID; throws on HTTP error |
| 6.6 | `pollUntilReady` returns links on "downloaded"; throws on error/timeout |
| 6.7 | `checkCache` returns boolean map for each info hash |
| 6.8 | Full RD pipeline works: add → select → poll → unrestrict → download |
| 6.9 | Progress events sent every 1 second during download phase |
| 6.10 | `download:completed` sent with file path and final size |
| 6.11 | `download:failed` sent with error, phase, and retryable flag |
| 6.12 | Cancellation aborts active download at any phase |
| 6.13 | Concurrent downloads limited by semaphore |
| 6.14 | Staging files cleaned up after successful organization |
| 6.15 | Movie organized to Plex-compatible path |
| 6.16 | Episode organized to Plex-compatible path |
| 6.17 | `sanitize` removes illegal chars, replaces colons, collapses spaces |
| 6.18 | RD API key used from agent config (received during pairing, never sent back to relay) |

### Exit Criteria
- [ ] Full RD pipeline works end-to-end (magnet → organized file)
- [ ] Download queue stores, delivers, and cancels correctly
- [ ] Agent picks up queued downloads on reconnect
- [ ] Progress events stream at 1/second during download phase
- [ ] Concurrent downloads limited by semaphore
- [ ] Cancellation aborts cleanly at any phase
- [ ] Plex-compatible paths verified for both movies and TV episodes

---

## Phase 7: Real-Time UI

### Goal
The web app displays live download progress, a queued downloads section, download history, toast notifications, and polished settings — bringing the full loop from "click download" to "see it complete" entirely within the browser.

### Deliverables

- Web downloads page (active + queued + history)
- Real-time progress bars fed by WebSocket events
- Download history from HTTP API
- Toast notification system
- Relay download history service
- Settings page (profile settings, change PIN)

### Feature Specs

**F7.1 — Downloads Page — Active Section**

Cards for each in-progress download:
- Media title + type badge (Movie/TV)
- Agent/device name badge
- Phase indicator: Adding to RD → Waiting → Downloading → Organizing (step dots or text)
- Progress bar: animated fill, percentage label
- Download speed (e.g., "18.4 MB/s") + ETA (e.g., "ETA 12m")
- Cancel button (sends `download:cancel` via WebSocket)

All data sourced from zustand store, updated in real time from `download:progress` WebSocket events.

**F7.2 — Downloads Page — Queued Section**

Between active and history, a list of queued downloads waiting for a device:
- Title, target device name badge, "Queued X hours ago"
- Cancel button (removes from relay queue)
- If queued >7 days: subtle warning "Content may need to be re-cached on RD"
- When agent connects and queue delivers, item transitions from Queued to Active with animation

**F7.3 — Downloads Page — History Section**

Completed/failed/cancelled downloads:
- Title, device name badge, file size, status badge (green "Completed" / red "Failed" / yellow "Cancelled"), timestamp
- Failed entries: show error message + "Retry" button (resends `download:request`)
- Delete button to remove entry from history

Data loaded from `GET /api/downloads` on page mount, with pagination.

**F7.4 — Downloads Page — Filters**
- Tab bar: All | Active | Queued | Completed | Failed
- Empty state per filter: "No downloads yet. Search for something to get started."

**F7.5 — Relay Download History Service**
- On `download:completed` or `download:failed` from agent: create `download_history` row
- `GET /api/downloads` — paginated (limit/offset), filterable by status, sorted newest first
- `GET /api/downloads/:id` — single record
- `DELETE /api/downloads/:id` — remove history entry

**F7.6 — Toast Notification System**
- Types: success (green), error (red), info (blue)
- Auto-dismiss after 5 seconds, dismissible with X button
- Stack vertically (newest on top)
- Triggered by:
  - `download:accepted` → info: "Download started: {title}"
  - `download:queued` → info: "Queued: {title} — will download when {device} is online"
  - `download:completed` → success: "ただいま — {title} has arrived"
  - `download:failed` → error: "Download failed: {title} — {error}"
  - `download:rejected` → error: "Download rejected: {reason}"

**F7.7 — Agent Status Indicators**
- Sidebar: connection status dot (green = connected, yellow = connecting, red = disconnected)
- Devices referenced in active/queued downloads show inline status

**F7.8 — Settings Page**
- **Profile section**: name display, change PIN (set/update/remove)
- **About section**: relay server version, GitHub repo link, open source license info
- **Switch profile** button → back to profile picker
- Admin users also see a link to the admin panel

### Demo Checkpoint

> **Demo 7**: Search for a movie and trigger a download. Navigate to the Downloads page. Watch the progress bar fill in real time — speed and ETA update every second. Toast: "Download started: Interstellar". On completion, toast: "ただいま — Interstellar has arrived". Card moves to history with green "Completed" badge. Stop the agent, trigger another download — it appears in the "Queued" section with device name and timestamp. Start the agent — the queued item slides up to "Active" and starts downloading. Cancel a download mid-way — "Cancelled" in history. Trigger a failing download — red "Failed" badge with error and Retry button. Filter tabs work. Visit Settings — profile name shown, PIN change works.

### Acceptance Criteria

| # | Criteria |
|---|---|
| 7.1 | Active downloads show title, device badge, phase, progress bar, speed, ETA |
| 7.2 | Progress bar and stats update in real-time from WebSocket |
| 7.3 | Cancel button sends `download:cancel` |
| 7.4 | Queued downloads show title, device name, queue time |
| 7.5 | Queued items transition to active on agent reconnect |
| 7.6 | Completed downloads show title, device, size, timestamp |
| 7.7 | Failed downloads show error + retry button |
| 7.8 | Download history loaded from HTTP API, sorted newest first |
| 7.9 | Filter tabs: All, Active, Queued, Completed, Failed |
| 7.10 | Empty state message when no downloads exist |
| 7.11 | Toast notifications fire for all download lifecycle events |
| 7.12 | Connection status dot reflects WebSocket state |
| 7.13 | Settings page: profile info, change PIN, about section |
| 7.14 | Sidebar navigation highlights active route |
| 7.15 | Dark theme applied consistently across all pages |

### Exit Criteria
- [ ] Active downloads show real-time progress from WebSocket
- [ ] Queued downloads display and transition correctly
- [ ] Cancel button works for both active and queued
- [ ] Download history loads and displays correctly
- [ ] Filter tabs work
- [ ] Toast notifications fire for all lifecycle events
- [ ] Settings page functional
- [ ] Connection status dot reflects WebSocket state

---

## Phase 8: Agent Polish

### Goal
The agent becomes a polished CLI tool with a terminal UI for foreground mode, daemon mode for background operation, system service installation, configuration management, and log viewing.

### Deliverables

- TUI mode (terminal progress bars, status display)
- Daemon mode (`tadaima start -d` / `tadaima stop`)
- System service installation (Windows Service, systemd, launchd)
- Windows system tray app (status, start/stop, open web UI, settings)
- Config CLI (`tadaima config get/set/list`)
- Log viewer (`tadaima logs`)
- Status command (`tadaima status`)
- Version command (`tadaima version`)

### Feature Specs

**F8.1 — TUI (Terminal UI)**

When running `tadaima start` (foreground, no `-d` flag):

```
 tadaima v1.0.0 — Connected to relay (Noah)
 ──────────────────────────────────────────
 ↓ Interstellar (2014)           45.2 GB
   ████████████████░░░░░░░░░░░░  62%  18.4 MB/s  ETA 12m

 ↓ Breaking Bad S05E16            1.8 GB
   ██████████████████████████░░  89%  22.1 MB/s  ETA 1m

 ✓ The Matrix (1999)             12.4 GB  ただいま — completed 3m ago
 ──────────────────────────────────────────
 2 active · 847 GB free on /mnt/media
```

- Header: version + connection status + profile name
- Active downloads: title, size, progress bar, percentage, speed, ETA
- Recently completed: title, size, "ただいま — completed X ago"
- Footer: active count + disk free space
- Updates in place (no scrolling log output)
- Ctrl+C gracefully disconnects and exits

**F8.2 — Daemon Mode**
- `tadaima start -d` — fork process to background, write PID to `~/.config/tadaima/tadaima.pid`
- `tadaima stop` — read PID file, send SIGTERM, wait for graceful shutdown
- `tadaima status` — check if daemon is running, show connection status + active downloads
- Daemon logs to `~/.config/tadaima/logs/tadaima.log` (rotating, max 10MB × 5 files)

**F8.3 — System Service Installation**
- `tadaima install-service` — detect platform:
  - **Windows**: register as a Windows Service (via `node-windows` or `windows-service`), set to auto-start
  - **Linux (systemd)**: generate unit file, enable + start
  - **macOS (launchd)**: generate plist, load
- `tadaima uninstall-service` — stop + disable + remove service file
- Service runs as current user, auto-restarts on failure
- On Windows, the installer handles service registration automatically — `install-service` is the CLI fallback

**F8.7 — Windows System Tray App**
- Lightweight tray icon (built with `systray2`)
- Tray icon states:
  - Green dot overlay: connected, no active downloads
  - Animated arrow overlay: downloads in progress
  - Red dot overlay: disconnected from relay
- Right-click menu:
  - **Status**: "Connected to relay (Noah) · 2 active downloads"
  - **Open Tadaima**: opens the web app in default browser
  - **Start / Stop Agent**: toggle the background service
  - **Settings**: opens a small config window (relay URL, media dirs, max concurrent)
  - **Logs**: opens log file in default text editor
  - **Check for Updates**: manually trigger update check
  - **Quit**: stop agent + close tray app
- Starts automatically on Windows login (Start Menu → Startup folder or registry run key)
- Toast notification on download complete: "ただいま — Interstellar has arrived" (Windows native notification)

**F8.4 — Config CLI**
- `tadaima config get <key>` — read a config value (dot notation: `directories.movies`)
- `tadaima config set <key> <value>` — update a config value, write to disk
- `tadaima config list` — show all config (redact sensitive values like API key and device token)

**F8.5 — Log Viewer**
- `tadaima logs` — tail the log file (last 50 lines by default)
- `tadaima logs -f` — follow mode (live tail)
- `tadaima logs -n 100` — last N lines

**F8.6 — CLI Command Summary**

```
tadaima setup              # First-time configuration (interactive)
tadaima start              # Start agent (foreground with TUI)
tadaima start -d           # Start as background daemon
tadaima status             # Show connection status + active downloads
tadaima stop               # Stop background daemon
tadaima config get <key>   # Read a config value
tadaima config set <key>   # Update a config value
tadaima config list        # Show all config values
tadaima logs               # Tail recent logs
tadaima logs -f            # Follow log output
tadaima install-service    # Install as system service
tadaima uninstall-service  # Remove system service
tadaima version            # Show version info
```

Note: On Windows, the `.msi` installer handles setup, service registration, and tray app installation. The CLI commands above are still available but most Windows users will interact through the installer wizard and tray app instead.

### Exit Criteria
- [ ] TUI renders active downloads with progress bars in terminal
- [ ] TUI updates in place without scroll
- [ ] Daemon mode starts/stops cleanly with PID file
- [ ] `tadaima status` reports accurate state
- [ ] Config CLI reads/writes/lists values
- [ ] Log viewer tails log file
- [ ] System service installs and auto-starts on Windows, Linux, and macOS
- [ ] Windows tray app shows connection status + download activity
- [ ] Windows tray app start/stop controls work
- [ ] Windows native toast notification fires on download complete

---

## Phase 9: Testing & Hardening

### Goal
Comprehensive test coverage, error handling audit, and edge case coverage across all packages. The system should be resilient to bad input, network failures, and stale state.

### Deliverables

- Relay unit + integration test suite (Vitest + Supertest)
- Relay WebSocket test harness
- Web component tests (Vitest + @testing-library/react)
- Web E2E tests (Playwright)
- Agent unit tests (RD client, download handler, media organizer)
- Agent integration tests (end-to-end flow with mocked RD)
- Shared schema tests (100% coverage)
- Error handling audit across all packages (including RD key rotation via error-based retry)

### Feature Specs

**F9.1 — Relay Tests**
- Unit tests for all services: admin auth, profiles, pairing, download queue, download history, message routing, cache
- Integration tests for all HTTP endpoints against test Postgres
- WebSocket tests: connection, auth rejection, message routing, heartbeat, profile isolation
- Target: 90%+ coverage on service logic

**F9.2 — Web Tests**
- Component tests for all pages and shared components
- API client tests with mocked fetch
- WebSocket client tests with mock WebSocket
- zustand store tests
- E2E tests (Playwright) covering:
  - First-run setup wizard
  - Admin login + profile management
  - Profile picker + PIN flow
  - Search → stream picker → download trigger
  - Downloads page with progress + queue
  - Device management
  - Settings page
- Target: all acceptance criteria covered

**F9.3 — Agent Tests**
- RD client tests with mocked HTTP (all methods, error cases, timeout)
- Download handler tests (full pipeline, cancellation, concurrent limits)
- Media organizer tests (movie paths, TV paths, sanitization edge cases)
- WebSocket client tests (connection, reconnect, message queue, queue pickup)
- Config management tests
- Target: 90%+ coverage on download pipeline

**F9.4 — Shared Tests**
- Every Zod schema: valid fixture passes, invalid fixture fails
- Utility functions: sanitize, path builders, ID generation
- Target: 100% coverage

**F9.5 — RD Key Rotation Handling**
- Agent detects RD 401/403 errors during any RD API call
- Agent calls `GET /api/agent/config` on the relay to fetch the current RD key
- Agent updates local config and retries the failed operation
- If new key also fails, report `download:failed` with retryable flag
- Test: change RD key in admin panel → active agent recovers on next download without restart

**F9.6 — Error Handling Audit**
- All relay endpoints return standard error envelope
- All error paths tested
- Agent handles network failures gracefully (retry, reconnect, user-friendly messages)
- Web displays errors via toast with fallback chain: `detail` → `error` → HTTP status text
- Download queue edge cases: stale entries, expired entries
- RD key rotation: agent auto-recovers via error-based retry

### Exit Criteria
- [ ] All test suites pass
- [ ] Relay: 90%+ coverage on service logic
- [ ] Agent: 90%+ coverage on download pipeline
- [ ] Shared: 100% coverage on schemas
- [ ] No unhandled promise rejections or uncaught exceptions in any package
- [ ] E2E tests pass in headless Playwright
- [ ] Stale queue entries handled gracefully

---

## Phase 10: Distribution & Deployment

### Goal
Package and deploy everything: relay + web via Railway one-click button, agent as npm package + standalone binary + Docker image. CI/CD pipeline for automated builds and releases.

### Deliverables

- Relay Dockerfile (API + static web app)
- Railway deploy button + `railway.json` config
- Windows `.msi` installer (GUI wizard, Windows Service, tray app, auto-update)
- Agent standalone binary builds for macOS/Linux (Bun compile)
- Agent Docker image (GitHub Container Registry)
- Agent npm package (`@tadaima/agent`)
- GitHub Actions CI/CD pipeline
- Self-hosted Docker Compose template (for NAS / home server users)
- Agent auto-update mechanism (all formats)
- Relay version endpoint + web app update banner

### Feature Specs

**F10.1 — Relay Dockerfile**
- Multi-stage build: install deps → build shared + relay + web → production image
- Serves Hono API + built web app as static files (single deployment unit)
- Health check endpoint for container orchestration
- Auto-generates `JWT_SECRET` on first run if not provided
- Runs Drizzle migrations on startup

**F10.2 — Railway One-Click Deploy**
- "Deploy on Railway" button in GitHub README
- `railway.json` configures:
  - Relay service from Dockerfile
  - Postgres plugin (auto-provisioned)
  - Environment variables: `DATABASE_URL` (auto-filled by Railway), `PORT` (auto-filled)
  - User-provided: `TMDB_API_KEY` (prompted in Railway UI during deploy)
- After deploy: user opens the URL → first-run wizard handles admin account, RD key, profiles
- Total time from click to working app: ~2 minutes

**F10.3 — Agent Distribution — Windows Installer**

The primary distribution for Windows users. A standard `.msi` installer with no terminal required.

- Built with WiX Toolset + Bun compile
- GUI setup wizard pages:
  1. Welcome + license (MIT)
  2. Install location (default: `C:\Program Files\Tadaima`)
  3. Relay URL input (with "Test Connection" button)
  4. Pairing code input (user gets this from the web app)
  5. Media directories (Movies folder picker, TV Shows folder picker)
  6. Options: "Start on Windows login" (checked by default), "Install as Windows Service" (checked by default)
  7. Install progress → completion
- What gets installed:
  - Agent binary (`tadaima.exe`) in Program Files
  - Windows Service registered and started
  - System tray app (`tadaima-tray.exe`) added to Startup
  - Start Menu shortcuts (Tadaima Tray, Uninstall)
  - Uninstaller registered in Add/Remove Programs
- Silent install for power users:
  ```
  msiexec /i tadaima-setup.msi /quiet RELAY_URL=https://... PAIRING_CODE=ABC123 MOVIES_DIR=D:\Movies TV_DIR=D:\TV
  ```
- Signed with a code signing certificate (to avoid SmartScreen warnings)
- Published as a GitHub Release asset: `tadaima-setup-x64.msi`

**F10.4 — Agent Distribution — Standalone Binary (macOS / Linux)**
- Compiled with `bun build --compile`:
  - `tadaima-macos-arm64`
  - `tadaima-linux-x64`
- Published as GitHub Release assets
- Versioned (semver)
- macOS: notarized with Apple Developer ID to avoid Gatekeeper warnings
- Setup via terminal: `tadaima setup` (interactive prompts)

**F10.5 — Agent Distribution — npm**
```bash
npm install -g @tadaima/agent
tadaima setup
```
- Published to npm as `@tadaima/agent`
- `bin` field in `package.json` → `tadaima` command
- Requires Node.js 22+
- Cross-platform (works on Windows, macOS, Linux)

**F10.6 — Agent Distribution — Docker**
```yaml
services:
  tadaima:
    image: ghcr.io/tadaima-app/agent:latest
    environment:
      - RELAY_URL=https://your-instance.up.railway.app
      - DEVICE_TOKEN=eyJ...
    volumes:
      - /path/to/movies:/media/movies
      - /path/to/tv:/media/tv
    restart: unless-stopped
```
- Published to GitHub Container Registry
- Multi-arch: `linux/amd64`, `linux/arm64`

**F10.7 — CI/CD Pipeline (GitHub Actions)**
- On push to `main`: lint, typecheck, test, build
- On tag `v*`:
  - Build + publish npm package
  - Compile standalone binaries (macOS/Linux)
  - Build Windows `.msi` installer
  - Build + push Docker images (relay + agent)
  - Create GitHub Release with all assets + changelog
- Separate workflows for relay image and agent release
- Automated changelog generation from conventional commits
- Code signing: Windows MSI signed via CI, macOS binary notarized via CI

**F10.8 — Self-Hosted Docker Compose Template**
```yaml
services:
  relay:
    image: ghcr.io/tadaima-app/relay:latest
    environment:
      - DATABASE_URL=postgres://tadaima:password@postgres:5432/tadaima
    ports:
      - "3000:3000"
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=tadaima
      - POSTGRES_USER=tadaima
      - POSTGRES_PASSWORD=password
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```
- Alternative to Railway for users with their own servers
- One command: `docker compose up`
- Accessible at `http://nas-ip:3000` on the local network
- For remote access: users can use Tailscale, Cloudflare Tunnel, or a reverse proxy

**F10.9 — Agent Auto-Update**

All agent formats check GitHub Releases API on startup (non-blocking, at most once per 24 hours):

- **Windows installer**: downloads new `.msi` in the background → prompts the user via tray notification ("Update available — click to install") → applies update and restarts the service. Can also auto-apply silently if the user enables it in settings.
- **Standalone binary (macOS/Linux)**: downloads the new binary to a temp location → verifies checksum → swaps the old binary → restarts. If running as a systemd/launchd service, the service manager handles the restart.
- **npm**: prints a notice: "Tadaima v1.2.0 is available. Run `npm update -g @tadaima/agent` to update."
- **Docker**: prints a notice: "Tadaima v1.2.0 is available. Run `docker compose pull && docker compose up -d` to update."

Update checks respect a `autoUpdate` config flag (default: `true` for Windows, `"notify"` for others). Users can disable via `tadaima config set autoUpdate false`.

**F10.10 — Relay Version Endpoint + Web App Update Banner**

- Relay exposes `GET /api/version` returning `{ version: "1.0.0", latestVersion: "1.2.0", updateAvailable: true }`
- The relay checks GitHub Releases API periodically (every 6 hours, cached)
- When `updateAvailable` is true, the web app shows a subtle banner at the top of the admin panel: "Tadaima v1.2.0 is available" with a link to the GitHub Release page
- Banner is only shown to the admin, not to profiles
- Railway users: the banner links to instructions for redeploying
- Docker Compose users: the banner shows the `docker compose pull` command

### Exit Criteria
- [ ] Railway deploy button works end-to-end (click → running instance)
- [ ] First-run wizard completes on fresh Railway deployment
- [ ] Windows `.msi` installer: full GUI flow from download to running agent with no terminal
- [ ] Windows installer registers service + tray app + uninstaller
- [ ] Windows silent install works with command-line parameters
- [ ] Standalone binaries run on macOS and Linux
- [ ] Agent installable via npm and Docker
- [ ] CI/CD pipeline runs on push and tag, produces all artifacts
- [ ] Self-hosted Docker Compose template works
- [ ] Agent auto-update: Windows downloads and applies update, macOS/Linux swaps binary, npm/Docker prints notice
- [ ] Relay `GET /api/version` returns current + latest version
- [ ] Web app admin panel shows update banner when new relay version available

---

## Phase 11: Public Release

### Goal
Prepare the project for public visibility — documentation, landing page, GitHub repo polish, and initial launch.

### Deliverables

- Landing page / docs site
- GitHub README with deploy button, screenshots, quick start
- Contributing guide
- Documentation (setup, CLI reference, self-hosting)
- GitHub Releases with changelogs

### Feature Specs

**F11.1 — Landing Page**
- Hosted at project domain or GitHub Pages
- Hero section: tagline, system diagram, "Deploy to Railway" button
- Feature highlights: search & browse, real-time downloads, offline queue, multi-profile, self-hostable
- Quick start guide: 3 steps (deploy to Railway, run setup wizard, install agent)
- Screenshots/GIFs of the web app (profile picker, search, downloads, devices)
- Links: GitHub, docs

**F11.2 — GitHub README**
- Project name + tagline + system diagram
- Badges: CI status, npm version, Docker pulls, license
- **"Deploy to Railway" button** (prominent, above the fold)
- Screenshots of web app
- Quick start (3 steps)
- Feature list
- Self-hosting section (Docker Compose alternative)
- Agent install options (Windows installer, standalone binary, npm, Docker)
- Contributing link
- License (MIT)

**F11.3 — Documentation**
- Getting started guide (Railway deploy → wizard → agent install → first download; separate paths for Windows installer vs. macOS/Linux CLI)
- Admin guide (managing profiles, instance settings, RD key rotation)
- Agent CLI reference (all commands with examples)
- Self-hosting guide (Docker Compose on NAS / home server)
- Configuration reference (instance settings, agent config file)
- FAQ / Troubleshooting

**F11.4 — GitHub Repo Polish**
- Issue templates (bug report, feature request)
- PR template
- CONTRIBUTING.md (dev setup, code style, PR process)
- CODE_OF_CONDUCT.md
- CHANGELOG.md
- GitHub Discussions enabled
- Release notes for v1.0.0

### Exit Criteria
- [ ] Landing page is live and accessible
- [ ] README has deploy button, screenshots, and quick start
- [ ] Documentation covers setup, admin, CLI, and self-hosting
- [ ] First GitHub Release (v1.0.0) published with changelog
- [ ] Project is publicly accessible and deployable by a new user following the docs

---

## Web App Demo Specifications

Each demo builds on the previous ones. These are the key visual/interactive checkpoints that validate the web app is working correctly at each phase.

### Demo 2 — Setup & Profiles
**Setup**: Fresh Railway deployment, no admin account.
**Steps**: Open relay URL → see setup wizard → create admin account (username + password) → enter TMDB key (test it) → enter RD key (test it) → create profile "Noah" → redirected to profile picker → click "Noah" → enter app shell → click profile name → back to picker → click "Manage" → admin login → admin panel with usage stats → create profile "Dad" with PIN → back to picker → click "Dad" → enter PIN → enter app.
**Validates**: First-run wizard, admin auth, profile CRUD, profile picker, PIN flow, usage stats.

### Demo 3 — Device Pairing
**Setup**: Profile selected, agent CLI available.
**Steps**: Navigate to Devices → empty state → click "Pair new device" → code displayed with countdown → run `tadaima setup` in terminal (no RD key prompt) → device appears on web page → rename device → set as default → remove device → pair again.
**Validates**: Pairing flow with RD key distribution, device CRUD.

### Demo 4 — WebSocket Connection
**Setup**: Profile selected, paired agent.
**Steps**: Start agent → connection dot turns green → devices page shows "Online" → stop agent → "Offline" → start again → "Online" → open second tab → both reflect state → switch to different profile → first profile's agent not visible.
**Validates**: WebSocket connection, heartbeat, status broadcast, profile isolation.

### Demo 5 — Search & Browse
**Setup**: Profile selected, paired agent running.
**Steps**: Search "Interstellar" → results with posters → click movie → stream picker with filters → toggle "2160p" → list narrows → "RD Cached" badges appear → go back to search → "Interstellar" now appears in the Recently Viewed strip → search "Breaking Bad" → TV result → season selector → episode list → streams load → go back → both titles now in Recently Viewed → click Interstellar thumbnail in the strip → jumps straight to stream picker → device selector shows online agent and offline devices with "will queue" label.
**Validates**: TMDB/Torrentio proxy, caching, filters, TV flow, RD cache check, recently viewed, device selector.

### Demo 6a — Online Download
**Setup**: Profile selected, agent running, cached stream available.
**Steps**: Download a cached stream → toast: "Download started" → agent terminal shows pipeline phases → file appears in media directory → WebSocket messages visible in devtools.
**Validates**: End-to-end download, agent pipeline, WebSocket flow.

### Demo 6b — Offline Queue
**Setup**: Profile selected, agent stopped.
**Steps**: Trigger download → toast: "Queued — will download when device is online" → downloads page shows item in Queued section → start agent → item transitions to Active → downloads normally.
**Validates**: Download queue, on-connect delivery, UI state transitions.

### Demo 7 — Downloads & Settings
**Setup**: Profile selected, agent running, some download history.
**Steps**: Active download with live progress → completion toast with "ただいま" → card moves to history → cancel a download → "Cancelled" in history → failed download → "Failed" with Retry → filter tabs work → visit Settings → profile name shown → change PIN → about section shows version.
**Validates**: Real-time progress, history, cancellation, failure handling, toasts, filters, settings.

### Demo 8 — Multi-Profile
**Setup**: Two profiles, each with a paired device.
**Steps**: Select "Noah" profile → trigger a download → switch to "Dad" profile → downloads page is empty (profile isolation) → trigger a download on Dad's device → switch back to "Noah" → only Noah's downloads visible → admin panel shows both profiles.
**Validates**: Profile isolation, multi-profile UX.

---

## Appendix A: Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (everywhere) |
| Monorepo | Turborepo + pnpm workspaces |
| Relay Server | Hono, Node.js 22, ws |
| Database | PostgreSQL 16, Drizzle ORM |
| Auth | JWT (jose), bcrypt |
| Web App | React 19, Vite, Tailwind CSS, TanStack Query, zustand |
| Agent | Node.js 22 / Bun, ws, conf, got |
| Validation | Zod |
| Testing | Vitest, Supertest, Playwright, @testing-library/react |
| CI/CD | GitHub Actions |
| Cloud Hosting | Railway (one-click deploy) or Docker Compose (self-hosted) |
| Containerization | Docker, Docker Compose |
| Binary Builds | Bun compile (macOS/Linux) |
| Windows Installer | MSI via WiX Toolset + Bun compile |
| Package Registry | npm, GitHub Container Registry |

## Appendix B: Resolved Design Decisions

1. **Deployment model** — Self-hosted only. No centralized hosted service. Railway one-click deploy is the standard path. Eliminates operational burden, abuse concerns, and liability.

2. **Auth model** — Admin + profiles (Netflix-style), not individual user accounts. One admin deploys and manages. Profiles are lightweight (name + optional PIN). Simpler for friends/family sharing.

3. **Shared RD account** — One Real-Debrid API key per instance, configured by admin in setup wizard, distributed to agents during pairing. Everyone shares one RD account. Keeps costs minimal.

4. **Download queue** — When a device is offline, download requests queue in the database (just metadata, not files). Agent picks them up on reconnect. Real-Debrid is the implicit cloud storage. No object storage, no extra cost.

5. **TV show downloads** — Default to downloading all cached files. After RD loads cached files, user can select/deselect individual files before confirming.

6. **Multi-agent downloads** — Each profile has a default device. Download button sends to default; dropdown allows picking a different agent. Offline agents show "will queue" in the selector.

7. **Notifications** — Web UI toasts only. No push notifications, no email.

8. **Library browsing** — Not in scope. Users manage libraries through Plex/Jellyfin.

9. **RD cache check** — Agent-side only. Keeps the RD key on the agent and works even if the relay can't reach RD.

10. **Usage tracking over rate limits** — Since each instance is private, rate limiting is unnecessary. The admin panel shows usage stats per profile (downloads triggered, searches, data downloaded). Informational, not restrictive.

11. **Profile isolation via PIN** — PIN is the isolation boundary. Share your PIN, share your stuff. No complex visibility rules or permissions.

12. **RD key rotation** — Error-based retry. Agent detects RD auth failures, fetches current key from relay, retries. No push mechanism or polling.

13. **Recently viewed titles** — Per-profile strip on the search page. Click to jump back to the stream picker for a previously viewed title.

14. **Business model** — Free and open source (MIT). No hosted service. Users pay for their own Railway (~$5–10/month, splittable) and their own RD account.

15. **Windows installer** — Windows users get a standard `.msi` installer with a GUI setup wizard, Windows Service, and system tray app. No terminal required. Silent install supported for power users.

16. **Software updates** — Agents auto-update via GitHub Releases. Windows installer downloads and applies updates in the background. macOS/Linux standalone binary self-replaces. npm and Docker print update notices. Relay updates via Railway redeploy or Docker image pull; Drizzle migrations run on startup. Web app admin panel shows an update banner when the relay is behind the latest release.

## Appendix C: Open Questions

1. **RD account limits** — Real-Debrid has its own concurrent download limits. If multiple profiles trigger downloads simultaneously through different agents, RD may throttle or reject some. Should the relay coordinate this, or let agents handle RD errors independently?
