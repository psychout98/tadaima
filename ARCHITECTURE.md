# Tadaima (ただいま) — Architecture Plan

> *Tadaima* — "I'm home." What your downloads say when they arrive.

## Vision

A **cloud-hosted media download orchestrator** that anyone can deploy for themselves (and their friends/family) with one click. Users browse and trigger downloads from anywhere through a Netflix-like web app; their agent (running on a PC, Mac, or NAS) receives commands and handles the actual downloading and file organization. If the user's machine is off, downloads queue in the cloud and start automatically when the machine comes back online.

Think: deploy your own private download service → search and click → file appears in your Plex library at home.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   CLOUD (Railway)                           │
│                                                             │
│  ┌──────────────┐       ┌──────────────────────────┐        │
│  │   Web App    │◄─────►│        Relay Server       │       │
│  │  (React/Vite)│  HTTP │  (Hono + WebSocket + DB)  │       │
│  └──────────────┘       └─────────┬────────────────┘        │
│                                   │                         │
└───────────────────────────────────┼─────────────────────────┘
                                    │ WebSocket (persistent)
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
              ┌──────────┐   ┌──────────┐   ┌──────────┐
              │  Agent   │   │  Agent   │   │  Agent   │
              │ (Noah's  │   │ (Dad's   │   │ (Friend's│
              │  Laptop) │   │  NAS)    │   │  PC)     │
              └──────────┘   └──────────┘   └──────────┘
```

### Three Components

| Component | What it does | Runs where |
|-----------|-------------|------------|
| **Relay** | Admin/profiles, WebSocket relay, TMDB/Torrentio proxy, download queue, instance data | Cloud (Railway — one-click deploy) |
| **Web App** | Profile select, search, browse, trigger downloads, monitor agents | Cloud (co-deployed with relay) |
| **Agent** | Receives download commands, runs RD pipeline, organizes files | User's machine (PC/Mac/NAS) |

### Deployment Model

Every Tadaima instance is **self-hosted** — there is no centralized `tadaima.app` service. Each instance is deployed by one person (the **admin**) who can then invite friends and family by creating **profiles**. This is similar to how a Plex server works: one person runs it, everyone in the household uses it.

**Standard deployment:** click "Deploy to Railway" from the GitHub README. Railway provisions the relay + Postgres automatically. The admin fills in their TMDB API key, opens the web app, and sets up profiles. Total cost: ~$5–10/month, split however the group wants.

**Alternative deployment:** Docker Compose on a home server or any VPS with Docker. Ideal for NAS users who want to keep everything local and skip the cloud cost entirely. Same codebase, same profile logic — the only difference is the URL agents connect to.

---

## Instance & Profile Model

Tadaima uses a **single-instance, multi-profile** model — like Netflix, Plex, or a shared streaming account.

### Concepts

| Concept | Description |
|---------|-------------|
| **Instance** | One Railway deployment. Has one admin, one RD account, one TMDB key. Shared infrastructure. |
| **Admin** | The person who deployed the instance. Has username + password login. Manages profiles, instance settings, RD key. |
| **Profile** | A lightweight identity within the instance (name, optional avatar, optional PIN). Each profile has their own devices, download queue, and download history. |

### How It Works

1. Admin deploys to Railway, opens the web app, creates their admin account (username + password)
2. Admin enters the shared Real-Debrid API key and TMDB key in instance settings
3. Admin creates profiles: "Noah", "Dad", "Sarah", etc.
4. Each person opens the web app, picks their profile from a profile picker (optionally enters a PIN)
5. Each person pairs their own devices to their own profile
6. Each person searches, downloads, and manages their own queue independently

### What's Shared vs. Per-Profile

| Shared (instance-level) | Per-profile |
|--------------------------|-------------|
| Railway deployment | Paired devices |
| PostgreSQL database | Download queue |
| Real-Debrid API key | Download history |
| TMDB API key | Default device preference |
| | Recently viewed titles |
| | Profile name / avatar / PIN |

### Why Not Individual Accounts?

Individual email + password accounts make sense for a public service with strangers. But Tadaima instances are private — you deployed it, you know everyone on it. The Netflix profile model is simpler: no signup flow, no email verification, no password recovery. The admin creates profiles, people pick theirs. An optional PIN keeps profiles from accidentally (or intentionally) switching to each other.

---

## Tech Stack

**Monorepo** — TypeScript everywhere, managed with Turborepo + pnpm workspaces.

```
tadaima/
├── packages/
│   ├── relay/          # Cloud API + WebSocket server
│   ├── web/            # React SPA
│   ├── agent/          # Download daemon
│   └── shared/         # Types, message protocol, validation
├── package.json        # Workspace root (pnpm)
├── turbo.json          # Build orchestration
└── docker-compose.yml  # Local dev environment
```

### Per-Package Stack

| Package | Runtime | Framework | Key Libraries |
|---------|---------|-----------|---------------|
| `relay` | Node.js 22 | Hono | `ws`, Drizzle ORM, PostgreSQL, `jose` (JWT) |
| `web` | Browser | React 19 + Vite | Tailwind CSS, TanStack Query, zustand |
| `agent` | Node.js 22 / Bun | — (plain TS) | `ws`, `conf` (config), `ora`/`cli-progress` (TUI), `got` (HTTP) |
| `shared` | — | — | Zod (message validation), TypeScript types |

---

## Component Details

### 1. Relay Server (`packages/relay`)

The relay is a Hono HTTP server with WebSocket upgrade support.

#### a) Admin Authentication

- **Admin account** — one per instance, created during first-run setup
- **Sign in** via username + password (bcrypt hashed). No email — this is a private instance, not a public service
- **JWT tokens** — short-lived access token (15m) + long-lived refresh token (7d)
- Admin-only endpoints for managing profiles, instance settings, and the RD API key

#### b) Profile Management

- Admin creates/edits/deletes profiles
- Each profile has: name, optional avatar (color/emoji), optional PIN (4–6 digits)
- Profile selection at the web app level (no email/password — just pick and optionally enter PIN)
- **Profile sessions** — selecting a profile issues a profile-scoped access token used for WebSocket auth and API calls
- **Device tokens** — long-lived tokens issued to agents during pairing, scoped to a profile (revocable)

#### c) WebSocket Relay

The relay maintains two pools of WebSocket connections:

- **Agent connections** — authenticated with a device token, identified by `(profileId, deviceId)`
- **Client connections** — authenticated with a profile session token, scoped to a profile

Message routing:

```
Web App → Relay → Agent       (commands: download, cancel, configure)
Agent  → Relay → Web App      (events: progress, status, error, completed)
Agent  → Relay                 (heartbeat, online/offline status)
```

The relay does NOT inspect or process download commands — it's a pass-through. This keeps it simple, stateless (aside from auth and the download queue), and cheap to run.

#### d) Download Queue

When a download is triggered and the target device is offline, the relay stores the request in a `download_queue` table instead of rejecting it. When the agent reconnects, the relay delivers queued requests automatically.

- Queue entries are small (a few hundred bytes of JSON metadata — title, magnet, etc.)
- No file storage — Real-Debrid serves as implicit cloud storage for cached content
- Configurable stale threshold: downloads queued for more than 14 days show a warning in the UI
- Queue is per-profile (each person only sees their own queued downloads)

#### e) API Proxy for External Services

The relay proxies TMDB and Torrentio requests to keep API keys server-side and enable caching:

| Endpoint | Upstream | Cache |
|----------|----------|-------|
| `GET /api/search?q=...` | TMDB `/search/multi` | 1 hour |
| `GET /api/media/:id` | TMDB `/movie/:id` or `/tv/:id` | 24 hours |
| `GET /api/streams/:type/:imdbId` | Torrentio addon API | 15 minutes |
| `GET /api/poster/:path` | TMDB image CDN | 7 days |

> **Note:** The Real-Debrid API key is configured at the instance level by the admin and distributed to agents during pairing. RD cache checks happen agent-side.

#### f) Database Schema (PostgreSQL via Drizzle)

```
admin
  id            UUID PK
  username      TEXT UNIQUE
  password_hash TEXT
  created_at    TIMESTAMP

instance_settings
  key           TEXT PK           -- e.g., "rd_api_key", "tmdb_api_key"
  value         TEXT              -- encrypted for sensitive values
  updated_at    TIMESTAMP

recently_viewed
  id            UUID PK
  profile_id    UUID FK → profiles
  tmdb_id       INT
  media_type    TEXT            -- "movie" or "tv"
  title         TEXT
  year          INT
  poster_path   TEXT
  imdb_id       TEXT
  viewed_at     TIMESTAMP       -- updated on each view, used for ordering

profiles
  id            UUID PK
  name          TEXT              -- e.g., "Noah", "Dad", "Sarah"
  avatar        TEXT              -- color or emoji identifier
  pin_hash      TEXT?             -- optional bcrypt hash of 4-6 digit PIN
  created_at    TIMESTAMP
  updated_at    TIMESTAMP

refresh_tokens
  id            UUID PK
  profile_id    UUID FK → profiles (nullable, null = admin)
  admin_id      UUID FK → admin (nullable, null = profile)
  token_hash    TEXT
  expires_at    TIMESTAMP
  created_at    TIMESTAMP

devices
  id            UUID PK
  profile_id    UUID FK → profiles
  name          TEXT            -- e.g., "Living Room NAS", "Office PC"
  platform      TEXT            -- windows, macos, linux, docker
  token_hash    TEXT            -- SHA-256 hash of device token
  is_online     BOOLEAN
  is_default    BOOLEAN
  last_seen_at  TIMESTAMP
  created_at    TIMESTAMP

pairing_codes
  code          TEXT PK         -- 6-char alphanumeric
  profile_id    UUID FK → profiles
  expires_at    TIMESTAMP
  claimed       BOOLEAN
  device_id     UUID FK → devices?
  created_at    TIMESTAMP

download_queue
  id            UUID PK
  profile_id    UUID FK → profiles
  device_id     UUID FK → devices
  payload       JSONB           -- full download:request message payload
  status        TEXT            -- "queued", "delivered", "cancelled", "expired"
  created_at    TIMESTAMP
  delivered_at  TIMESTAMP?

download_history
  id            UUID PK
  profile_id    UUID FK → profiles
  device_id     UUID FK → devices
  tmdb_id       INT
  imdb_id       TEXT
  title         TEXT
  year          INT
  media_type    TEXT            -- movie, tv
  season        INT?
  episode       INT?
  episode_title TEXT?
  magnet        TEXT            -- stored for seamless retry
  torrent_name  TEXT
  expected_size BIGINT          -- stored for retry
  size_bytes    BIGINT?         -- actual final size (null until completed)
  status        TEXT            -- completed, failed, cancelled
  error         TEXT?
  retryable     BOOLEAN?        -- whether a failed download can be retried
  started_at    TIMESTAMP
  completed_at  TIMESTAMP?
```

### 2. Web App (`packages/web`)

A React SPA served as static files co-deployed with the relay.

#### Pages / Views

| Route | Description |
|-------|-------------|
| `/setup` | First-run wizard (admin account creation, TMDB key, RD key) — only shown on fresh instance |
| `/login` | Admin login (username + password) |
| `/profiles` | Profile picker (Netflix-style grid of profile avatars/names) |
| `/` (Search) | Recently viewed strip + TMDB search → results grid → stream picker → download button |
| `/downloads` | Active + queued + recent downloads for the current profile |
| `/devices` | Current profile's paired agents with online/offline status |
| `/admin` | Admin-only: manage profiles, instance settings, RD key, TMDB key |

#### First-Run Setup Wizard

On a fresh instance (no admin account exists), the web app shows a setup wizard:

1. **Create admin account** — username + password
2. **Enter TMDB API key** — with link to TMDB's free API signup
3. **Enter Real-Debrid API key** — with link to RD account page
4. **Create first profile** — name + optional avatar
5. Done → redirect to profile picker

This means the admin never needs to set environment variables manually (beyond what Railway auto-configures). Everything is configured through the UI.

#### Profile Picker

Netflix-style profile selection screen:

- Grid of profile avatars with names
- Click a profile → enter optional PIN → enter profile session
- Admin has a small "Manage" link that goes to `/admin`
- Profile session token stored in memory (zustand), not localStorage

#### Recently Viewed

A horizontal strip of small poster thumbnails at the top of the search page, below the search bar. Clicking a poster jumps straight to the populated stream picker for that title — no re-searching needed.

- Stored per-profile in `recently_viewed` table (max 20 entries, oldest evicted)
- Updated whenever a user clicks into a title's stream picker
- Shows poster, title, and year — compact enough to fit 6-8 items in a single row
- Empty on first use (strip hidden until the profile has viewed at least one title)

#### Search & Download Flow

```
1. User types "Interstellar" → web app calls relay GET /api/search?q=interstellar
2. User clicks result → relay GET /api/streams/movie/tt0816692
3. Stream list displayed with filters (resolution, HDR, audio, RD cache)
4. User clicks "Download" on a stream
5. Web app sends WebSocket message:
   {
     type: "download:request",
     deviceId: "preferred-device-uuid",
     payload: {
       tmdbId: 157336,
       imdbId: "tt0816692",
       title: "Interstellar",
       year: 2014,
       type: "movie",
       magnet: "magnet:?xt=urn:btih:...",
       torrentName: "Interstellar.2014.2160p.UHD.BluRay...",
       fileSize: 45_000_000_000
     }
   }
6. Relay checks if target agent is online:
   - ONLINE: forward to agent's WebSocket
   - OFFLINE: store in download_queue, notify web client "Queued — will download when device is online"
7. Agent acknowledges, begins RD pipeline (or picks up queued job on reconnect)
8. Agent streams progress events back through relay to web app
```

#### Real-Time Updates

The web app maintains a WebSocket connection to the relay. Through this single connection it receives:

- Download progress for all active jobs across all of this profile's agents
- Agent online/offline status changes
- Download completion / error notifications
- Toast notifications pushed from agents
- Queue status updates (queued → delivered → in progress)

State managed with **zustand** — a lightweight store that merges WebSocket events into reactive state consumed by React components.

#### UI Design

Dark theme, `#0f0f0f` background, indigo accent `#6366f1`, card/badge/progress-bar patterns. The web app should feel like a polished personal media tool.

### 3. Agent (`packages/agent`)

The agent is a Node.js process that runs on the user's machine. It's the only component that talks to Real-Debrid and touches the filesystem.

#### Core Responsibilities

1. **Connect to relay** — persistent WebSocket, auto-reconnect with exponential backoff
2. **Pick up queued downloads** — on connect, receive any downloads queued while offline
3. **Listen for commands** — `download:request`, `download:cancel`, `config:update`
4. **Run RD pipeline** — add magnet → select files → poll until ready → unrestrict links → download files
5. **Organize files** — move to Plex-compatible folder structure
6. **Report progress** — stream `download:progress` events back through WebSocket
7. **Local config** — download directories, max concurrent downloads (RD key received from relay during pairing)

#### Configuration

First-run setup (interactive CLI):

```
$ tadaima setup
? Relay server URL: https://your-instance.up.railway.app
? Pairing code (from the web app): A7X9K2
? Movies directory: /mnt/media/Movies
? TV Shows directory: /mnt/media/TV
✓ Connected! This device is now paired as "noah-macbook" on profile "Noah"
```

Note: the RD API key is no longer configured per-agent. It's set once by the admin in the web app and distributed to agents during the pairing handshake. If the admin rotates the RD key, agents detect this automatically: when an RD API call returns a 401/403, the agent fetches the current key from the relay via `GET /api/agent/config` and retries. No manual intervention needed.

Config stored in `~/.config/tadaima/config.json`:

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

#### CLI Commands

```
tadaima setup              # First-time configuration
tadaima start              # Start the agent (foreground with TUI)
tadaima start -d           # Start as background daemon
tadaima status             # Show connection status + active downloads
tadaima stop               # Stop the background daemon
tadaima config set         # Update a config value
tadaima logs               # Tail recent logs
```

#### TUI (Terminal UI) — Optional

When running in foreground mode, the agent shows a simple terminal UI:

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

#### Running as a Service

The agent supports background operation on all platforms:

- **Windows**: installed as a Windows Service via the installer; also runs a system tray app for status/control
- **systemd** (Linux): `tadaima install-service` generates a unit file
- **launchd** (macOS): `tadaima install-service` generates a plist
- **Docker**: official image with volume mounts

#### File Organization

Plex-compatible structure:

```
Movies/
  Interstellar (2014) [tmdb-157336]/
    Interstellar (2014).mkv

TV/
  Breaking Bad [tmdb-1396]/
    Season 05/
      S05E16 - Felina.mkv
```

### 4. Shared Package (`packages/shared`)

Defines the contract between all components.

#### WebSocket Message Protocol

Every message is a JSON object validated with Zod:

```typescript
// Base message envelope
type WsMessage = {
  id: string           // unique message ID (ULID)
  type: string         // e.g., "download:request", "download:progress"
  timestamp: number    // unix ms
  payload: unknown     // type-specific
}

// Command messages (web → relay → agent)
type DownloadRequest = WsMessage & {
  type: "download:request"
  payload: {
    tmdbId: number
    imdbId: string
    title: string
    year: number
    mediaType: "movie" | "tv"
    season?: number
    episode?: number
    episodeTitle?: string
    magnet: string
    torrentName: string
    expectedSize: number
  }
}

type DownloadCancel = WsMessage & {
  type: "download:cancel"
  payload: { jobId: string }
}

// Event messages (agent → relay → web)
type DownloadAccepted = WsMessage & {
  type: "download:accepted"
  payload: { jobId: string, requestId: string }
}

type DownloadProgress = WsMessage & {
  type: "download:progress"
  payload: {
    jobId: string
    phase: "adding" | "waiting" | "unrestricting" | "downloading" | "organizing"
    progress: number        // 0-100
    downloadedBytes?: number
    totalBytes?: number
    speedBps?: number
    eta?: number            // seconds remaining
  }
}

type DownloadCompleted = WsMessage & {
  type: "download:completed"
  payload: {
    jobId: string
    filePath: string
    finalSize: number
  }
}

type DownloadFailed = WsMessage & {
  type: "download:failed"
  payload: {
    jobId: string
    error: string
    phase: string
    retryable: boolean
  }
}

type DownloadQueued = WsMessage & {
  type: "download:queued"
  payload: {
    queueId: string
    requestId: string
    title: string
    deviceName: string
  }
}

type AgentHeartbeat = WsMessage & {
  type: "agent:heartbeat"
  payload: {
    activeJobs: number
    diskFreeBytes: number
    uptimeSeconds: number
  }
}
```

---

## Device Pairing Flow

```
 ADMIN/PROFILE (Web App)         RELAY                     AGENT (CLI)
      │                            │                           │
      │  (Profile "Noah" is       │                           │
      │   selected in web app)    │                           │
      │                            │                           │
      │  POST /api/devices/pair/  │                           │
      │  request                  │                           │
      │──────────────────────────►│                           │
      │  { code: "A7X9K2",       │                           │
      │    expiresAt: "..." }     │                           │
      │◄──────────────────────────│                           │
      │                            │                           │
      │   "Enter code: A7X9K2"    │    tadaima setup          │
      │                            │    ? Code: A7X9K2         │
      │                            │◄──────────────────────────│
      │                            │   POST /api/devices/pair/ │
      │                            │   claim { code, name,     │
      │                            │   platform }              │
      │                            │──────────────────────────►│
      │                            │   { deviceId, deviceToken,│
      │                            │     rdApiKey, wsUrl }     │
      │   ✓ Device paired          │                           │
      │◄──────────────────────────│   ✓ Saved config, starting│
      │                            │     WebSocket connection  │
```

- Pairing codes are 6 characters, alphanumeric, valid for 10 minutes
- Each profile can pair multiple devices (max 5)
- Devices can be renamed or revoked from the web app
- **RD API key is distributed to the agent during pairing** — set once by admin, shared across all profiles/agents
- Agent setup no longer asks for the RD key — it receives it automatically

---

## Download Queue

The download queue is what makes Tadaima work for users whose computers aren't always on.

### How It Works

```
User triggers download          Agent is OFFLINE
        │                            │
        ▼                            │
   Relay receives                    │
   download:request                  │
        │                            │
        ├── Agent online? ──YES──► Forward via WebSocket (normal flow)
        │
        └── Agent offline? ─────► Store in download_queue table
                                     │
                                     ▼
                                  Web UI shows:
                                  "Queued — will download
                                   when [device] is online"
                                     │
              ┌──────────────────────┘
              │  (hours/days later...)
              ▼
         Agent comes online,
         connects via WebSocket
              │
              ▼
         Relay checks download_queue
         for this profile + device
              │
              ▼
         Delivers queued requests
         as normal download:request
         messages
              │
              ▼
         Agent processes them
         (RD pipeline → download → organize)
              │
              ▼
         Relay marks queue entries
         as "delivered"
```

### Queue States

| Status | Meaning |
|--------|---------|
| `queued` | Waiting for agent to come online |
| `delivered` | Sent to agent on reconnection |
| `expired` | Queued for too long (14 days), user warned |

### What the User Sees

- **Downloads page** has three sections: Active, Queued, History
- Queued items show: title, target device name, "Queued X hours ago", and a cancel button
- When a queued download is delivered to the agent, it transitions to Active with live progress
- If a download has been queued for more than 7 days, a subtle warning appears: "Queued 8 days ago — content may need to be re-cached on RD"

### Why This Works

Real-Debrid is the implicit cloud storage. When a torrent is RD-cached, the files sit on RD's servers ready to download at any time. The magnet link and info hash don't expire. So there's no urgency to download the file the moment the user clicks the button — the relay just needs to remember the intent.

The queue entry is a few hundred bytes of JSON. You could queue thousands of downloads and it wouldn't meaningfully affect the database or Railway bill.

---

## Distribution

### Relay (Cloud)

**Standard: Railway one-click deploy**

1. Click "Deploy to Railway" button in GitHub README
2. Railway provisions relay + Postgres automatically
3. Open the web app URL → first-run wizard handles everything else

The relay Docker image includes both the API server and the built web app as static files.

**Alternative: Docker Compose (for NAS / home server users)**

For users who already run a NAS or home server, self-hosting avoids the Railway cost entirely. Same codebase, same profile logic, same everything — just runs locally.

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

The relay is accessible at `http://nas-ip:3000` on the local network. For remote access (triggering downloads from outside the house), users can use Tailscale, Cloudflare Tunnel, or a reverse proxy — but that's their infrastructure, not ours to manage.

### Agent (Local)

The agent ships in four formats:

#### Windows Installer (recommended for Windows users)
Standard `.msi` installer built with WiX Toolset + Bun compile. The installer:
- Runs a GUI setup wizard (relay URL, pairing code, media directories)
- Installs the agent binary to Program Files
- Registers a Windows Service for background operation
- Installs a system tray app for status, start/stop, and settings
- Adds a Start Menu shortcut
- Registers an uninstaller in Add/Remove Programs
- Supports silent install: `tadaima-setup.msi /quiet RELAY_URL=... PAIRING_CODE=...`

After install, the agent pairs automatically and starts running as a service. The user never opens a terminal.

#### Standalone Binary (for macOS / Linux)
Compiled with `bun build --compile` for each platform:
- `tadaima-macos-arm64`
- `tadaima-linux-x64`

Distributed via GitHub Releases. Run `tadaima setup` in a terminal.

#### npm (for developers / Node.js users)
```bash
npm install -g @tadaima/agent
tadaima setup
```

#### Docker (for NAS / server users)
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
      - ./config:/config
    restart: unless-stopped
```

### Software Updates

#### Agent Updates
All agent formats support automatic updates:
- **Windows installer**: built-in auto-updater checks GitHub Releases on startup, downloads and applies the update in the background, prompts for restart (or auto-restarts the service)
- **Standalone binary (macOS/Linux)**: on startup, checks GitHub Releases; if newer version found, downloads replacement binary, swaps in place, and restarts
- **npm**: prints update notice with `npm update -g @tadaima/agent` command
- **Docker**: users pull the latest image (`docker compose pull && docker compose up -d`)

Update checks are non-blocking, at most once per 24 hours. The agent continues running on the current version if the update fails or is declined.

#### Relay Updates
- **Railway**: Railway auto-rebuilds on push to main. Users who deploy via the Railway button get updates by clicking "Redeploy" in their Railway dashboard, or by configuring auto-deploy from the GitHub repo
- **Docker Compose**: `docker compose pull && docker compose up -d` pulls the latest relay image. Drizzle migrations run automatically on startup, so schema changes are applied seamlessly
- The relay exposes `GET /api/version` so the web app can show a "new version available" banner when the running version is behind the latest GitHub Release

---

## Development Phases

### Phase 0: Local Dev Environment
- [ ] Initialize monorepo (pnpm workspaces + Turborepo)
- [ ] Set up all four packages with entry points
- [ ] Docker Compose for local Postgres
- [ ] Dev scripts, linting, TypeScript config

### Phase 1: Shared Protocol & Types
- [ ] Zod message schemas for all WebSocket message types
- [ ] TypeScript types, API type definitions
- [ ] Drizzle ORM schema (all tables including download_queue)
- [ ] Shared utilities (ULID, sanitize, path builders)

### Phase 2: Admin Auth & Profiles
- [ ] Relay: admin account creation + login (JWT)
- [ ] Relay: profile CRUD (create, list, update, delete)
- [ ] Relay: profile session management (PIN validation, profile-scoped tokens)
- [ ] Relay: instance settings (RD key, TMDB key — stored encrypted)
- [ ] Web: first-run setup wizard
- [ ] Web: admin login page
- [ ] Web: profile picker page
- [ ] Web: admin panel (manage profiles, instance settings)

### Phase 3: Device Pairing
- [ ] Relay: device pairing (code generation, claim with RD key distribution, confirmation)
- [ ] Relay: device management (list, rename, set default, revoke)
- [ ] Web: devices page with pair flow
- [ ] Agent: `tadaima setup` flow (relay URL, pairing code, media directories — no RD key prompt)

### Phase 4: WebSocket Relay
- [ ] Relay: WebSocket upgrade handler with auth (profile tokens + device tokens)
- [ ] Relay: connection pool management (agent + client connections per profile)
- [ ] Relay: message routing (client → agent, agent → client, scoped by profile)
- [ ] Relay: heartbeat handling + online/offline tracking
- [ ] Agent: WebSocket client with auto-reconnect
- [ ] Web: WebSocket client with zustand integration

### Phase 5: Search & Browse
- [ ] Relay: TMDB search proxy with caching
- [ ] Relay: TMDB media detail proxy
- [ ] Relay: Torrentio stream proxy with caching
- [ ] Relay: poster image proxy
- [ ] Web: search page (results grid)
- [ ] Web: stream picker (filters, RD cache badge, download button)
- [ ] Web: TV season/episode selector

### Phase 6: Download Pipeline & Queue
- [ ] Relay: download queue (store when offline, deliver on reconnect)
- [ ] Agent: Real-Debrid client (TypeScript)
- [ ] Agent: download command handler
- [ ] Agent: file download with progress streaming
- [ ] Agent: media file organizer (Plex structure)
- [ ] Agent: progress events → WebSocket
- [ ] Agent: cancellation support
- [ ] Agent: concurrent download queue
- [ ] Agent: on-connect queue pickup

### Phase 7: Real-Time UI
- [ ] Web: downloads page (active + queued + history sections)
- [ ] Web: live progress bars from WebSocket events
- [ ] Web: download queue display with "waiting for device" states
- [ ] Web: toast notifications (started, completed with "ただいま", failed, queued)
- [ ] Web: agent status indicators
- [ ] Web: settings page (profile settings, change PIN)

### Phase 8: Agent Polish
- [ ] Agent: TUI mode (terminal progress bars)
- [ ] Agent: daemon mode (`start -d` / `stop`)
- [ ] Agent: system service installation (Windows Service, systemd, launchd)
- [ ] Agent: Windows system tray app (status, start/stop, settings)
- [ ] Agent: config management CLI
- [ ] Agent: log viewer

### Phase 9: Testing & Hardening
- [ ] Full test suites (relay, web, agent, shared)
- [ ] Error handling audit
- [ ] Usage tracking in admin panel (per-profile download counts, searches, data volume)
- [ ] Edge cases (stale queue, RD errors, network drops)

### Phase 10: Distribution & Deployment
- [ ] Relay Dockerfile (API + web app)
- [ ] Railway deploy button + config (railway.json)
- [ ] Windows `.msi` installer (GUI wizard, Windows Service, tray app)
- [ ] Agent standalone binary builds for macOS/Linux (GitHub Actions)
- [ ] Agent Docker image (GitHub Container Registry)
- [ ] Agent npm package publish
- [ ] Self-hosted Docker Compose template
- [ ] Agent auto-update (Windows: in-place, macOS/Linux: binary swap, npm: notice, Docker: pull)
- [ ] Relay version endpoint (`GET /api/version`) + web app update banner

### Phase 11: Public Release
- [ ] Landing page / docs site
- [ ] GitHub README with screenshots, deploy button, quick start
- [ ] Documentation (setup guide, CLI reference, self-hosting)
- [ ] GitHub repo polish (templates, contributing guide, license)

---

## Resolved Decisions

1. **Deployment model** — Self-hosted only. No centralized hosted service. Railway one-click deploy is the standard path. Eliminates operational burden, abuse concerns, and liability exposure.

2. **Auth model** — Admin + profiles (Netflix-style), not individual user accounts. One admin deploys and manages the instance. Profiles are lightweight (name + optional PIN). Simpler for the target audience (friends/family sharing).

3. **Shared RD account** — One Real-Debrid API key per instance, configured by admin, distributed to agents during pairing. Everyone shares the same RD account. Keeps things simple and cheap.

4. **Download queue** — When a device is offline, download requests are queued in the database (just metadata, not files). Agent picks them up on reconnect. Real-Debrid serves as implicit cloud storage. No object storage needed.

5. **TV show downloads** — Default to downloading all cached files for the selected content. Once RD loads the cached files, give the user an option to select/deselect individual files before confirming.

6. **Multi-agent downloads** — Each profile has a default device. The download button sends to the default, but a dropdown lets them pick a different online agent if they have multiple.

7. **Notifications** — None beyond web UI toasts. Real-time progress is sufficient.

8. **Library browsing** — Not in scope. The web app is search + download only. Users manage their library through Plex/Jellyfin/etc.

9. **RD cache check** — Happens agent-side. The web app sends a `cache:check` message through the relay to the agent, which checks using the shared RD key and returns `cache:result`. Keeps the check on the agent so it works even if the relay can't reach RD.

10. **Usage tracking over rate limiting** — Since each instance is private, rate limiting is unnecessary. Instead, the admin panel shows usage stats per profile (downloads triggered, searches, storage consumed). Informational, not restrictive. The admin can see if someone is being excessive and handle it socially.

11. **Profile isolation via PIN** — The profile PIN is the isolation boundary. If you share your PIN with someone, you're sharing your download history and devices with them. No need for complex visibility rules or per-profile permissions. Keep it simple.

12. **RD key rotation** — Handled via error-based retry. When an agent gets a 401/403 from Real-Debrid, it fetches the current key from the relay and retries. No push mechanism, no polling, no manual intervention.

13. **Recently viewed titles** — Per-profile list of recently viewed titles shown as a compact poster strip on the search page. Click to jump straight back to the stream picker. Small DB table, big UX win.

14. **Business model** — Free and open source (MIT). No hosted service, no donations needed. Users pay for their own Railway instance (~$5–10/month, split across profiles) and their own RD account.

15. **Windows installer** — Windows users get a standard `.msi` installer with a GUI setup wizard, Windows Service, and system tray app. No terminal needed. Silent install supported for power users.

16. **Software updates** — Agents auto-update via GitHub Releases (Windows installer auto-applies, standalone binary self-replaces, npm prints notice, Docker pulls). Relay updates via Railway redeploy or Docker image pull; migrations run on startup. Web app shows a "new version available" banner when behind.

---

## Open Questions

1. **RD account limits** — Real-Debrid has its own concurrent download limits. If multiple profiles trigger downloads simultaneously through different agents, RD may throttle or reject some. Should the relay coordinate this, or let agents handle RD errors independently?
