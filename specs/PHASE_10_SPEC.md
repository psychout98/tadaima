# Phase 10: Distribution & Deployment — Detailed Spec

> **Goal**: Package and deploy everything: relay + web via Railway one-click button, agent as Windows `.msi` installer + standalone binary + npm package + Docker image. CI/CD pipeline for automated builds and releases. Auto-update mechanism for all agent formats.

---

## Table of Contents

1. [Overview](#overview)
2. [Relay Dockerfile](#relay-dockerfile)
3. [Railway One-Click Deploy](#railway-one-click-deploy)
4. [Self-Hosted Docker Compose Template](#self-hosted-docker-compose-template)
5. [Agent Distribution — Windows Installer](#agent-distribution--windows-installer)
6. [Agent Distribution — Standalone Binary](#agent-distribution--standalone-binary)
7. [Agent Distribution — npm Package](#agent-distribution--npm-package)
8. [Agent Distribution — Docker Image](#agent-distribution--docker-image)
9. [Agent Auto-Update Mechanism](#agent-auto-update-mechanism)
10. [Relay Version Endpoint & Web Update Banner](#relay-version-endpoint--web-update-banner)
11. [CI/CD Pipeline (GitHub Actions)](#cicd-pipeline-github-actions)
12. [Code Signing & Notarization](#code-signing--notarization)
13. [Implementation Order](#implementation-order)
14. [Common Pitfalls](#common-pitfalls)

---

## Overview

Phase 10 produces the distribution artifacts that let anyone install Tadaima without building from source. There are two sides:

**Relay (cloud):**
- Dockerfile for Railway and self-hosted Docker Compose
- Railway one-click deploy button in README
- Auto-migration on startup

**Agent (local):**
- Windows `.msi` installer (GUI wizard, Windows Service, tray app)
- Standalone binary for macOS (arm64) and Linux (x64) via Bun compile
- npm package (`@tadaima/agent`)
- Docker image for NAS/server users
- Auto-update mechanism for all formats

**CI/CD:**
- GitHub Actions pipeline: lint → test → build → publish on tag

---

## Relay Dockerfile

### 2.1 Multi-Stage Build

**File**: `Dockerfile` (root of monorepo)

```dockerfile
# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/relay/package.json packages/relay/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --prod=false

# ---- Stage 2: Build ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/relay/node_modules ./packages/relay/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY . .
RUN pnpm turbo build --filter=@tadaima/relay --filter=@tadaima/web

# ---- Stage 3: Production ----
FROM node:22-alpine AS production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy built artifacts
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/relay/dist ./packages/relay/dist
COPY --from=build /app/packages/relay/drizzle ./packages/relay/drizzle
COPY --from=build /app/packages/relay/package.json ./packages/relay/
COPY --from=build /app/packages/web/dist ./packages/web/dist

# Copy root workspace files
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# The relay serves the web app as static files
ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIST_PATH=/app/packages/web/dist

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "packages/relay/dist/index.js"]
```

### 2.2 Startup Behavior

The relay entry point (`packages/relay/src/index.ts`) handles:

1. **Auto-generate JWT secret** — if `JWT_SECRET` env var is not set, generate a random 256-bit secret on first run and store it in `instance_settings` table. On subsequent runs, read from the table.
2. **Run Drizzle migrations** — `migrate(db, { migrationsFolder: './drizzle' })` runs before the server starts. This ensures schema is always up to date after a version upgrade.
3. **Serve web app** — serve the built web app from `WEB_DIST_PATH` as static files. All non-API routes fall through to `index.html` (SPA routing).
4. **Start Hono server** — listen on `PORT` (default 3000).

```typescript
// packages/relay/src/index.ts (startup sequence)
import { Hono } from 'hono';
import { serveStatic } from 'hono/node-server/serve-static';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const app = new Hono();

async function start() {
  // 1. Connect to database
  const db = await connectDb(process.env.DATABASE_URL!);

  // 2. Run migrations
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Database migrations complete');

  // 3. Ensure JWT secret exists
  await ensureJwtSecret(db);

  // 4. Mount API routes
  app.route('/api', createApiRouter(db));
  app.route('/ws', createWsRouter(db));

  // 5. Serve web app static files
  const webDistPath = process.env.WEB_DIST_PATH ?? '../web/dist';
  app.use('/*', serveStatic({ root: webDistPath }));
  // SPA fallback: serve index.html for non-API, non-static routes
  app.get('*', (c) => c.html(/* read index.html */));

  // 6. Start server
  const port = parseInt(process.env.PORT ?? '3000');
  serve({ fetch: app.fetch, port });
  console.log(`Tadaima relay listening on port ${port}`);
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
```

### 2.3 Image Size Target

Target image size: **< 200 MB**. The `node:22-alpine` base is ~50 MB. The rest is Node.js dependencies and built code.

> **✅ RESOLVED**: Use `node:22-alpine` (~50 MB). If `bcrypt` causes glibc issues, switch to `bcryptjs` (pure JS) rather than changing the base image.

---

## Railway One-Click Deploy

### 3.1 Railway Configuration

**File**: `railway.json`

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node packages/relay/dist/index.js",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 10,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**File**: `railway.toml` (alternative — Railway supports both)

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node packages/relay/dist/index.js"
healthcheckPath = "/api/health"
restartPolicyType = "ON_FAILURE"
```

### 3.2 Deploy Button

Added to `README.md`:

```markdown
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/tadaima?referralCode=...)
```

> **✅ RESOLVED**: Publish a proper Railway template to the Railway template marketplace. This gives the best one-click deploy experience with auto-provisioned Postgres.

### 3.3 Environment Variables

| Variable | Source | Required | Notes |
|----------|--------|----------|-------|
| `DATABASE_URL` | Railway Postgres plugin | Auto-filled | Provisioned automatically |
| `PORT` | Railway | Auto-filled | Set by Railway |
| `JWT_SECRET` | Auto-generated | No | Generated on first run, stored in DB |
| `ENCRYPTION_MASTER_KEY` | Auto-generated | No | Used to encrypt sensitive settings (RD key, TMDB key) at rest. Auto-generated on first run if missing; user warned to save it. |
| `NODE_ENV` | Dockerfile | No | Set to `production` in Dockerfile |

The TMDB API key and RD API key are NOT environment variables — they're entered through the web UI setup wizard and stored encrypted in the database (using `ENCRYPTION_MASTER_KEY`). This means the deploy requires zero manual env var configuration.

### 3.4 User Experience

1. Click "Deploy on Railway" in README
2. Railway provisions relay service + Postgres database (~60 seconds)
3. User opens the deployed URL
4. First-run wizard: create admin, enter TMDB key, enter RD key, create first profile
5. Done — app is live

Total time from click to working app: **~2 minutes**.

---

## Self-Hosted Docker Compose Template

### 4.1 Docker Compose File

**File**: `docker-compose.prod.yml` (shipped in repo root)

```yaml
# Tadaima — Self-Hosted Docker Compose
# Usage: docker compose -f docker-compose.prod.yml up -d
#
# After starting, open http://localhost:3000 in your browser.
# The first-run wizard will guide you through setup.

services:
  relay:
    image: ghcr.io/tadaima-app/relay:latest
    environment:
      - DATABASE_URL=postgres://tadaima:${POSTGRES_PASSWORD:-tadaima}@postgres:5432/tadaima
    ports:
      - "${TADAIMA_PORT:-3000}:3000"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=tadaima
      - POSTGRES_USER=tadaima
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-tadaima}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tadaima"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

### 4.2 .env.example for Self-Hosted

**File**: `.env.prod.example`

```bash
# Tadaima Self-Hosted Configuration
# Copy to .env and adjust as needed

# Database password (change from default in production!)
POSTGRES_PASSWORD=change-me-to-something-secure

# Port the relay listens on (default: 3000)
TADAIMA_PORT=3000
```

### 4.3 Remote Access Note

The self-hosted setup is accessible at `http://<server-ip>:3000` on the local network. For remote access (triggering downloads from outside the house), users have several options. The documentation should cover:

- **Tailscale** (recommended for simplicity): Install on server + phone/laptop. Access via Tailscale IP.
- **Cloudflare Tunnel**: Free, no port forwarding. Requires a domain name.
- **Reverse proxy (nginx/Caddy)**: For users who already run a reverse proxy. Include example Caddy config:

```
# Caddyfile example
tadaima.yourdomain.com {
    reverse_proxy localhost:3000
}
```

---

## Agent Distribution — Windows Installer

### 5.1 Technology Choice

> **✅ RESOLVED**: Use WiX Toolset + Bun compile (Option B) for the smallest installer (~30 MB). Tray app built with `systray2` — no Chromium dependency.

### 5.2 Installer Contents

The `.msi` installer packages:

| Component | Install Location | Purpose |
|-----------|-----------------|---------|
| `tadaima.exe` | `C:\Program Files\Tadaima\` | Agent binary (Bun-compiled or pkg'd) |
| `tadaima-tray.exe` | `C:\Program Files\Tadaima\` | System tray app |
| `unins000.exe` | `C:\Program Files\Tadaima\` | Uninstaller |

### 5.3 GUI Setup Wizard Pages

The installer runs a standard Windows setup wizard:

**Page 1 — Welcome**
- App name, version, MIT license text
- "Next" button

**Page 2 — Install Location**
- Default: `C:\Program Files\Tadaima`
- "Browse" button to change
- Disk space required display

**Page 3 — Relay Connection**
- Text input: "Relay URL" (e.g., `https://your-instance.up.railway.app`)
- "Test Connection" button → calls `GET /api/health` to verify
- Status indicator: green check or red X

**Page 4 — Pairing Code**
- Text input: "Pairing Code" (6 characters)
- Instructions: "Open Tadaima in your browser, go to Devices, and click 'Pair new device' to get a code."
- On "Next": calls `POST /api/devices/pair/claim` to pair
- Shows success with device name and profile name

**Page 5 — Media Directories**
- "Movies folder" — folder picker (default: `D:\Movies` or `C:\Users\{user}\Videos\Movies`)
- "TV Shows folder" — folder picker (default: `D:\TV` or `C:\Users\{user}\Videos\TV`)
- Both must exist or be creatable

**Page 6 — Options**
- [x] Start on Windows login (adds tray app to Startup)
- [x] Install as Windows Service (registers background service)
- [x] Check for updates automatically

**Page 7 — Install Progress**
- Progress bar during file copy + service registration
- On completion: "Tadaima has been installed successfully!"
- Checkbox: "Launch Tadaima tray app now"

### 5.4 What the Installer Does (Post-Install)

1. Copies binaries to install directory
2. Writes config to `%APPDATA%\Tadaima\config.json`
3. Registers Windows Service (`tadaima-agent`) via `sc.exe create` or `node-windows`
4. Starts the service
5. Adds `tadaima-tray.exe` to `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run` (startup)
6. Creates Start Menu shortcuts:
   - "Tadaima" → launches tray app
   - "Uninstall Tadaima" → runs uninstaller
7. Registers uninstaller in Add/Remove Programs

### 5.5 Silent Install

For power users and automated deployment:

```cmd
msiexec /i tadaima-setup-x64.msi /quiet ^
  RELAY_URL=https://your-instance.up.railway.app ^
  PAIRING_CODE=A7X9K2 ^
  MOVIES_DIR=D:\Movies ^
  TV_DIR=D:\TV ^
  START_ON_LOGIN=1 ^
  INSTALL_SERVICE=1
```

### 5.6 Uninstaller

- Stops and removes the Windows Service
- Removes tray app from Startup
- Deletes program files
- Removes Start Menu shortcuts
- Removes from Add/Remove Programs
- **Does NOT delete** config file or media directories (preserves user data)

---

## Agent Distribution — Standalone Binary

### 6.1 Build Process

Use `bun build --compile` to produce single-file executables:

```bash
# macOS (Apple Silicon)
bun build packages/agent/src/index.ts --compile --target=bun-darwin-arm64 --outfile=tadaima-macos-arm64

# Linux (x64)
bun build packages/agent/src/index.ts --compile --target=bun-linux-x64 --outfile=tadaima-linux-x64

# Linux (ARM64 — for ARM NAS, Raspberry Pi)
bun build packages/agent/src/index.ts --compile --target=bun-linux-arm64 --outfile=tadaima-linux-arm64
```

> **✅ RESOLVED**: Build three binary targets from v1.0: `macos-arm64`, `linux-x64`, and `linux-arm64`. The ARM64 Linux binary supports ARM NAS devices (Synology, Raspberry Pi). Skip `macos-x64` — Rosetta 2 handles arm64 binaries on Intel Macs.

### 6.2 Binary Distribution

Published as GitHub Release assets:

```
tadaima-v1.0.0-macos-arm64     (macOS Apple Silicon)
tadaima-v1.0.0-linux-x64       (Linux x86_64)
tadaima-v1.0.0-linux-arm64     (Linux ARM64)
```

Each binary includes a SHA-256 checksum file:

```
tadaima-v1.0.0-macos-arm64.sha256
tadaima-v1.0.0-linux-x64.sha256
tadaima-v1.0.0-linux-arm64.sha256
```

### 6.3 Installation Instructions

**macOS:**
```bash
# Download
curl -fsSL https://github.com/tadaima-app/tadaima/releases/latest/download/tadaima-macos-arm64 -o tadaima
chmod +x tadaima
sudo mv tadaima /usr/local/bin/

# Setup
tadaima setup

# Run
tadaima start
```

**Linux:**
```bash
# Download
curl -fsSL https://github.com/tadaima-app/tadaima/releases/latest/download/tadaima-linux-x64 -o tadaima
chmod +x tadaima
sudo mv tadaima /usr/local/bin/

# Setup
tadaima setup

# Install as service (optional)
tadaima install-service

# Or run in foreground
tadaima start
```

---

## Agent Distribution — npm Package

### 7.1 Package Configuration

**File**: `packages/agent/package.json`

```json
{
  "name": "@tadaima/agent",
  "version": "1.0.0",
  "description": "Tadaima download agent — receives commands from the relay and manages media downloads",
  "bin": {
    "tadaima": "./dist/index.js"
  },
  "files": [
    "dist/**",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=22.0.0"
  },
  "keywords": [
    "tadaima",
    "media",
    "download",
    "plex",
    "real-debrid",
    "torrent"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/tadaima-app/tadaima.git",
    "directory": "packages/agent"
  }
}
```

### 7.2 Entry Point Shebang

**File**: `packages/agent/src/index.ts` (top of file)

```typescript
#!/usr/bin/env node
```

This must be present for the npm `bin` field to work correctly on Unix systems.

### 7.3 Publishing

```bash
# From packages/agent directory (automated via CI)
pnpm publish --access public
```

The npm package is the simplest distribution for developers and Node.js users:

```bash
npm install -g @tadaima/agent
tadaima setup
tadaima start
```

---

## Agent Distribution — Docker Image

### 8.1 Agent Dockerfile

**File**: `packages/agent/Dockerfile`

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/
RUN pnpm install --frozen-lockfile --prod=false
COPY . .
RUN pnpm turbo build --filter=@tadaima/agent

FROM node:22-alpine AS production
WORKDIR /app
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/agent/dist ./packages/agent/dist
COPY --from=build /app/packages/agent/package.json ./packages/agent/
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile --prod

ENV NODE_ENV=production

CMD ["node", "packages/agent/dist/index.js", "start"]
```

### 8.2 Docker Compose for Agent

```yaml
# docker-compose.agent.yml
services:
  tadaima-agent:
    image: ghcr.io/tadaima-app/agent:latest
    environment:
      - RELAY_URL=https://your-instance.up.railway.app
      - DEVICE_TOKEN=eyJ...
      - MOVIES_DIR=/media/movies
      - TV_DIR=/media/tv
    volumes:
      - /path/to/movies:/media/movies
      - /path/to/tv:/media/tv
      - tadaima-config:/config
    restart: unless-stopped

volumes:
  tadaima-config:
```

### 8.3 Environment Variable Override

When running in Docker, config values can be provided via environment variables instead of the config file. The agent checks env vars first, then falls back to config file:

| Env Var | Config Key | Description |
|---------|-----------|-------------|
| `RELAY_URL` | `relay` | Relay server URL |
| `DEVICE_TOKEN` | `deviceToken` | Device authentication token |
| `MOVIES_DIR` | `directories.movies` | Movies directory path |
| `TV_DIR` | `directories.tv` | TV shows directory path |
| `MAX_CONCURRENT` | `maxConcurrentDownloads` | Max concurrent downloads |

### 8.4 Multi-Architecture Builds

The Docker image is built for both `linux/amd64` and `linux/arm64` using Docker buildx:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/tadaima-app/agent:latest \
  --push \
  -f packages/agent/Dockerfile .
```

---

## Agent Auto-Update Mechanism

### 9.1 Update Check Flow

All agent formats share the same update check logic:

```typescript
// packages/agent/src/updater/updateChecker.ts
import { readConfig, writeConfig } from '../config/configManager';

const GITHUB_RELEASES_API = 'https://api.github.com/repos/tadaima-app/tadaima/releases/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  assets: { name: string; url: string; size: number }[];
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  const config = readConfig();

  // Rate limit: at most once per 24 hours
  const lastCheck = config.lastUpdateCheck ?? 0;
  if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return null;

  // Don't check if auto-update is disabled
  if (config.autoUpdate === false) return null;

  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (!res.ok) return null;

    const release = await res.json();
    const latestVersion = release.tag_name.replace(/^v/, '');

    // Update last check timestamp
    writeConfig({ ...config, lastUpdateCheck: Date.now() });

    if (latestVersion === currentVersion) return null;

    return {
      currentVersion,
      latestVersion,
      updateAvailable: semverGt(latestVersion, currentVersion),
      releaseUrl: release.html_url,
      assets: release.assets.map((a: any) => ({
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
      })),
    };
  } catch {
    // Network error — silently skip
    return null;
  }
}
```

### 9.2 Per-Format Update Behavior

**Windows Installer (`autoUpdate: true` by default):**

```typescript
// packages/agent/src/updater/windowsUpdater.ts
export async function applyWindowsUpdate(update: UpdateInfo): Promise<void> {
  const msiAsset = update.assets.find(a => a.name.endsWith('.msi'));
  if (!msiAsset) return;

  // 1. Download new .msi to temp directory
  const tmpPath = path.join(os.tmpdir(), msiAsset.name);
  await downloadFile(msiAsset.url, tmpPath);

  // 2. Verify checksum
  const checksumAsset = update.assets.find(a => a.name === `${msiAsset.name}.sha256`);
  if (checksumAsset) {
    await verifyChecksum(tmpPath, checksumAsset.url);
  }

  // 3. Show tray notification: "Update available — click to install"
  showTrayNotification(
    'Tadaima Update Available',
    `Version ${update.latestVersion} is ready to install.`
  );

  // 4. On user confirmation (or if silent auto-update enabled):
  //    Run msiexec /i {tmpPath} /quiet and restart the service
}
```

**Standalone Binary (macOS/Linux) (`autoUpdate: "notify"` by default):**

```typescript
// packages/agent/src/updater/binaryUpdater.ts
export async function applyBinaryUpdate(update: UpdateInfo): Promise<void> {
  const platform = process.platform === 'darwin' ? 'macos-arm64' : 'linux-x64';
  const binaryAsset = update.assets.find(a => a.name.includes(platform));
  if (!binaryAsset) return;

  // 1. Download new binary to temp location
  const tmpPath = path.join(os.tmpdir(), `tadaima-${update.latestVersion}`);
  await downloadFile(binaryAsset.url, tmpPath);

  // 2. Verify checksum
  const checksumAsset = update.assets.find(a => a.name === `${binaryAsset.name}.sha256`);
  if (checksumAsset) {
    await verifyChecksum(tmpPath, checksumAsset.url);
  }

  // 3. Swap: rename current binary to .old, move new binary into place
  const currentPath = process.execPath;
  const backupPath = `${currentPath}.old`;
  await fs.rename(currentPath, backupPath);
  await fs.rename(tmpPath, currentPath);
  await fs.chmod(currentPath, 0o755);

  // 4. If running as service, the service manager restarts automatically
  // 5. If running in foreground, print message and exit
  console.log(`Updated to v${update.latestVersion}. Restarting...`);
  process.exit(0); // Service manager or user restarts
}
```

**npm (`autoUpdate: "notify"` by default):**

```typescript
console.log(
  `\n  Tadaima v${update.latestVersion} is available (current: v${update.currentVersion}).` +
  `\n  Run: npm update -g @tadaima/agent\n`
);
```

**Docker (`autoUpdate: "notify"` by default):**

```typescript
console.log(
  `\n  Tadaima v${update.latestVersion} is available (current: v${update.currentVersion}).` +
  `\n  Run: docker compose pull && docker compose up -d\n`
);
```

### 9.3 Auto-Update Config

The `autoUpdate` config field controls behavior:

| Value | Windows | macOS/Linux Binary | npm/Docker |
|-------|---------|-------------------|------------|
| `true` | Download + prompt to install (auto-apply if silent mode) | Download + swap binary | Print notice |
| `"notify"` | Print notice in logs + tray notification | Print notice in logs | Print notice |
| `false` | No check | No check | No check |

Default: `true` for Windows installer, `"notify"` for everything else.

---

## Relay Version Endpoint & Web Update Banner

### 10.1 Version Endpoint

**Route**: `GET /api/version`

```typescript
// packages/relay/src/routes/version.ts
import { Hono } from 'hono';
import { version } from '../../package.json';

const GITHUB_RELEASES_API = 'https://api.github.com/repos/tadaima-app/tadaima/releases/latest';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cachedLatest: { version: string; checkedAt: number } | null = null;

export const versionRouter = new Hono();

versionRouter.get('/', async (c) => {
  let latestVersion = version; // default to current
  let updateAvailable = false;

  // Check GitHub Releases (cached, at most every 6 hours)
  if (!cachedLatest || Date.now() - cachedLatest.checkedAt > CHECK_INTERVAL_MS) {
    try {
      const res = await fetch(GITHUB_RELEASES_API, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const release = await res.json();
        cachedLatest = {
          version: release.tag_name.replace(/^v/, ''),
          checkedAt: Date.now(),
        };
      }
    } catch {
      // Silently fail — use current version as latest
    }
  }

  if (cachedLatest) {
    latestVersion = cachedLatest.version;
    updateAvailable = latestVersion !== version;
  }

  return c.json({
    version,
    latestVersion,
    updateAvailable,
  });
});
```

### 10.2 Web App Update Banner

**Component**: `packages/web/src/components/UpdateBanner.tsx`

```tsx
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';

export function UpdateBanner() {
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const { data } = useQuery({
    queryKey: ['version'],
    queryFn: () => fetch('/api/version').then(r => r.json()),
    staleTime: 6 * 60 * 60 * 1000, // 6 hours
    enabled: isAdmin, // Only check for admin
  });

  if (!data?.updateAvailable || !isAdmin) return null;

  return (
    <div className="bg-indigo-900/50 text-indigo-200 px-4 py-2 text-sm text-center">
      Tadaima v{data.latestVersion} is available.{' '}
      <a
        href={`https://github.com/tadaima-app/tadaima/releases/tag/v${data.latestVersion}`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-white"
      >
        View release notes
      </a>
    </div>
  );
}
```

- Only shown on the **admin panel** page
- Links to the GitHub Release page
- Non-intrusive: subtle banner at top, dismissible
- Non-admin profiles never see it

---

## CI/CD Pipeline (GitHub Actions)

### 11.1 Workflow: CI (on push to main + PRs)

**File**: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: tadaima_test
          POSTGRES_USER: tadaima
          POSTGRES_PASSWORD: tadaima
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test -- --coverage
        env:
          TEST_DATABASE_URL: postgres://tadaima:tadaima@localhost:5432/tadaima_test

  e2e:
    runs-on: ubuntu-latest
    needs: [test]
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: tadaima_test
          POSTGRES_USER: tadaima
          POSTGRES_PASSWORD: tadaima
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: npx playwright install --with-deps chromium
      - run: pnpm test:e2e
        env:
          TEST_DATABASE_URL: postgres://tadaima:tadaima@localhost:5432/tadaima_test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: packages/web/playwright-report/
```

### 11.2 Workflow: Release (on tag `v*`)

**File**: `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write
  packages: write

jobs:
  build-and-test:
    # Same as CI test job — must pass before release
    uses: ./.github/workflows/ci.yml

  build-relay-image:
    needs: [build-and-test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: .
          file: Dockerfile
          push: true
          platforms: linux/amd64,linux/arm64
          tags: |
            ghcr.io/tadaima-app/relay:latest
            ghcr.io/tadaima-app/relay:${{ github.ref_name }}

  build-agent-image:
    needs: [build-and-test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: .
          file: packages/agent/Dockerfile
          push: true
          platforms: linux/amd64,linux/arm64
          tags: |
            ghcr.io/tadaima-app/agent:latest
            ghcr.io/tadaima-app/agent:${{ github.ref_name }}

  build-standalone-binaries:
    needs: [build-and-test]
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: bun-darwin-arm64
            artifact: tadaima-macos-arm64
          - os: ubuntu-latest
            target: bun-linux-x64
            artifact: tadaima-linux-x64
          - os: ubuntu-latest
            target: bun-linux-arm64
            artifact: tadaima-linux-arm64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter=@tadaima/agent
      - run: bun build packages/agent/dist/index.js --compile --target=${{ matrix.target }} --outfile=${{ matrix.artifact }}
      - run: sha256sum ${{ matrix.artifact }} > ${{ matrix.artifact }}.sha256 || shasum -a 256 ${{ matrix.artifact }} > ${{ matrix.artifact }}.sha256
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: |
            ${{ matrix.artifact }}
            ${{ matrix.artifact }}.sha256

  build-windows-installer:
    needs: [build-and-test]
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter=@tadaima/agent
      # Build Windows binary
      - uses: oven-sh/setup-bun@v2
      - run: bun build packages/agent/dist/index.js --compile --target=bun-windows-x64 --outfile=tadaima.exe
      # Build MSI using WiX Toolset
      - run: node scripts/build-msi.js
      - uses: actions/upload-artifact@v4
        with:
          name: tadaima-setup-x64.msi
          path: dist/tadaima-setup-x64.msi

  publish-npm:
    needs: [build-and-test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter=@tadaima/agent
      - run: cd packages/agent && pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  create-release:
    needs: [build-relay-image, build-agent-image, build-standalone-binaries, build-windows-installer, publish-npm]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
      - name: Generate changelog
        id: changelog
        run: |
          # Generate changelog from conventional commits since last tag
          PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
          if [ -n "$PREV_TAG" ]; then
            CHANGELOG=$(git log ${PREV_TAG}..HEAD --pretty=format:"- %s" --no-merges)
          else
            CHANGELOG=$(git log --pretty=format:"- %s" --no-merges)
          fi
          echo "changelog<<EOF" >> $GITHUB_OUTPUT
          echo "$CHANGELOG" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
      - uses: softprops/action-gh-release@v2
        with:
          body: |
            ## What's Changed
            ${{ steps.changelog.outputs.changelog }}

            ## Installation
            - **Railway**: Click "Redeploy" in your Railway dashboard
            - **Docker**: `docker compose pull && docker compose up -d`
            - **Windows**: Download `tadaima-setup-x64.msi` below
            - **macOS**: Download `tadaima-macos-arm64` below
            - **Linux (x64)**: Download `tadaima-linux-x64` below
            - **Linux (ARM64)**: Download `tadaima-linux-arm64` below
            - **npm**: `npm update -g @tadaima/agent`
          files: |
            artifacts/tadaima-macos-arm64/tadaima-macos-arm64
            artifacts/tadaima-macos-arm64/tadaima-macos-arm64.sha256
            artifacts/tadaima-linux-x64/tadaima-linux-x64
            artifacts/tadaima-linux-x64/tadaima-linux-x64.sha256
            artifacts/tadaima-linux-arm64/tadaima-linux-arm64
            artifacts/tadaima-linux-arm64/tadaima-linux-arm64.sha256
            artifacts/tadaima-setup-x64.msi/tadaima-setup-x64.msi
```

### 11.3 Version Management

Version is stored in the root `package.json` and in each package's `package.json`. Use `pnpm version` or a script to bump all simultaneously:

```bash
# scripts/bump-version.sh
#!/bin/bash
VERSION=$1
# Update root package.json
npm version $VERSION --no-git-tag-version
# Update each package
for pkg in packages/shared packages/relay packages/web packages/agent; do
  cd $pkg && npm version $VERSION --no-git-tag-version && cd -
done
# Commit and tag
git add -A
git commit -m "chore: bump version to v${VERSION}"
git tag "v${VERSION}"
```

> **✅ RESOLVED**: Lockstep versioning — all packages share the same version number. Every release bumps all packages to the same version. Simpler, no compatibility matrix.

---

## Code Signing & Notarization

### 12.1 Windows Code Signing

> **✅ RESOLVED**: Skip code signing for the initial release. Document the SmartScreen bypass in the install guide ("More info" → "Run anyway"). Add signing later when the user base grows.

### 12.2 macOS Notarization

> **✅ RESOLVED**: Skip macOS notarization for the initial release. Document the Gatekeeper bypass in the install guide (`xattr -d com.apple.quarantine tadaima`). Add notarization later.

---

## Implementation Order

### Step 1: Relay Dockerfile + Railway Config (Day 1-2)
1. Write multi-stage Dockerfile
2. Test locally: `docker build -t tadaima-relay .` → `docker run -p 3000:3000`
3. Verify: health check, migrations, static file serving, SPA routing
4. Write `railway.json`
5. Test Railway deploy (create template or use direct deploy)

### Step 2: Self-Hosted Docker Compose (Day 2)
6. Write `docker-compose.prod.yml`
7. Write `.env.prod.example`
8. Test: `docker compose -f docker-compose.prod.yml up` → fresh instance → setup wizard

### Step 3: Agent npm Package (Day 3)
9. Configure `packages/agent/package.json` for publishing
10. Add shebang to entry point
11. Test locally: `npm pack` → `npm install -g ./tadaima-agent-1.0.0.tgz` → `tadaima version`

### Step 4: Agent Standalone Binaries (Day 3-4)
12. Install Bun, test `bun build --compile` locally
13. Build macOS and Linux binaries
14. Test on target platforms (or VMs)
15. Generate SHA-256 checksums

### Step 5: Agent Docker Image (Day 4)
16. Write agent Dockerfile
17. Test: build → run with relay URL + device token
18. Test multi-arch build with buildx

### Step 6: CI/CD Pipeline (Day 5-7)
19. Write CI workflow (`ci.yml`)
20. Write Release workflow (`release.yml`)
21. Set up GitHub secrets (NPM_TOKEN, etc.)
22. Test: push a tag → verify all artifacts produced
23. Test: GitHub Release created with all assets

### Step 7: Windows Installer (Day 7-10)
24. Set up WiX Toolset for MSI builds
25. Build Windows binary via Bun compile
26. Create installer project with GUI wizard pages
27. Test: full install → pair → service running → tray app → uninstall
28. Test: silent install
29. Add to CI release workflow

### Step 8: Auto-Update + Version Endpoint (Day 10-12)
30. Implement `checkForUpdate()` in agent
31. Implement per-format update behavior
32. Implement `GET /api/version` in relay
33. Implement UpdateBanner component in web app
34. Test: tag a new version → agents detect update → appropriate behavior per format

---

## Common Pitfalls

1. **Don't forget SPA routing in the Dockerfile** — the relay must serve `index.html` for ALL non-API routes. Without this, direct navigation to `/downloads` or `/admin` will 404.

2. **Don't hardcode the relay URL in the web app** — the web app is served FROM the relay, so all API calls should use relative URLs (`/api/...`). No `VITE_API_URL` needed.

3. **Don't store secrets in `railway.json`** — the TMDB and RD keys go through the setup wizard, not env vars. Only `DATABASE_URL` (auto-filled) is needed.

4. **Docker layer caching matters** — copy `package.json` and lockfile BEFORE copying source code. This ensures `pnpm install` is cached unless dependencies change.

5. **Test the Railway deploy on a fresh account** — don't just test on your own Railway account where things might be cached or pre-configured.

6. **Windows Service must run as a user, not SYSTEM** — the service needs access to the user's media directories, which may be on a different drive or network share. Running as SYSTEM can cause permission issues.

7. **Bun compile produces large binaries** — expect 50-80 MB per binary. This is normal for Bun-compiled executables. The alternative (pkg/Node SEA) is similar in size.

8. **npm publish requires `--no-git-checks`** — since we're publishing from CI and the working directory may have build artifacts, `--no-git-checks` skips the clean-tree requirement.

9. **Multi-arch Docker builds are slow** — ARM64 builds on GitHub Actions use QEMU emulation, which is 5-10x slower. Budget 15-20 minutes for the full build. Consider using separate runners if this becomes a bottleneck.

10. **Version in package.json must match the git tag** — the release workflow extracts the version from the tag. If `package.json` says `1.0.0` but the tag is `v1.0.1`, things break. The bump script should ensure consistency.

---

## Verification Checklist

Before marking Phase 10 as complete:

- [ ] `docker build` succeeds and produces a working relay image
- [ ] Railway deploy button works end-to-end (click → running instance in ~2 min)
- [ ] First-run wizard completes on fresh Railway deployment
- [ ] Self-hosted Docker Compose works (`docker compose up` → setup wizard → functional)
- [ ] Windows `.msi` installer: full GUI flow (install → pair → service → tray → uninstall)
- [ ] Windows silent install works with command-line parameters
- [ ] Standalone binaries run on macOS (arm64), Linux (x64), and Linux (arm64)
- [ ] `npm install -g @tadaima/agent && tadaima version` works
- [ ] Agent Docker image runs and connects to relay
- [ ] Multi-arch Docker images build successfully
- [ ] CI workflow passes on push to main
- [ ] Release workflow produces all artifacts on tag
- [ ] GitHub Release created with binaries, checksums, installer, and changelog
- [ ] npm package published successfully
- [ ] Docker images pushed to GHCR
- [ ] Agent auto-update: detects new version, behaves correctly per format
- [ ] `GET /api/version` returns correct current + latest version
- [ ] Web admin panel shows update banner when relay is behind latest release
- [ ] Update banner only visible to admin, not profiles

---

End of Phase 10 Spec.
