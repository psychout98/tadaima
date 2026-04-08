# Tadaima (ただいま)

> "I'm home." — What your downloads say when they arrive.

A self-hosted media download orchestrator. Deploy your own private instance, search and trigger downloads from a Netflix-like web app, and have files organized into your Plex library automatically.

[![CI](https://github.com/psychout98/tadaima/actions/workflows/ci.yml/badge.svg)](https://github.com/psychout98/tadaima/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/giving-simplicity)

---

## How It Works

```
              CLOUD (Railway / Docker)
 ┌──────────────────────────────────────────┐
 │  Web App ◄──► Relay Server ◄──► Postgres │
 └──────────────────┬───────────────────────┘
                    │ WebSocket
        ┌───────────┼───────────┐
        ▼           ▼           ▼
    Agent        Agent        Agent
  (Your PC)    (Dad's NAS)  (Friend's Mac)
```

1. **Deploy** the relay to Railway (one click) or self-host with Docker
2. **Search** movies and TV shows through the web app
3. **Download** — the agent on your machine handles Real-Debrid and file organization
4. **Arrive** — files appear in your Plex library, organized automatically

## Features

- **Search & Browse** — TMDB-powered search with poster images, stream picker with resolution/HDR/audio filters
- **Real-Debrid Integration** — Full download pipeline: magnet → RD cache → unrestrict → download → organize
- **Plex-Compatible** — Files organized into `Movies/Title (Year)/` and `TV/Show/Season 01/` structure
- **Multi-Profile** — Netflix-style profiles with optional PINs, each with their own devices and download history
- **Offline Queue** — Downloads queue when your machine is off, start automatically when it comes back online
- **Real-Time Progress** — Live progress bars, speed, ETA via WebSocket
- **Multi-Device** — Pair up to 5 devices per profile, download to any of them
- **Self-Hosted** — No central service. You own your data. Deploy on Railway (~$5/mo) or Docker Compose (free)

## Quick Start

### 1. Deploy the Relay

**Railway (recommended):**

Click the Deploy button above. Railway provisions the relay + Postgres automatically.

**Self-hosted (Docker Compose):**

```bash
curl -O https://raw.githubusercontent.com/psychout98/tadaima/main/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
```

### 2. Run the Setup Wizard

Open the relay URL in your browser. The setup wizard walks you through:
- Creating an admin account
- Entering your TMDB API key ([get one free](https://www.themoviedb.org/settings/api))
- Entering your Real-Debrid API key ([get yours](https://real-debrid.com/apitoken))
- Creating your first profile

### 3. Install the Agent

**Windows** — Download [Tadaima-Setup.msi](https://github.com/psychout98/tadaima/releases/latest/download/Tadaima-Setup.msi) and run the installer. It downloads the latest agent, registers a Windows Service, and starts on login automatically.

**macOS** — Download [Tadaima-Setup.dmg](https://github.com/psychout98/tadaima/releases/latest/download/Tadaima-Setup.dmg), open it, and run the installer package. It downloads the latest agent, installs a launchd service, and starts on login automatically.

**npm (all platforms):**
```bash
npm install -g @psychout98/tadaima
tadaima setup
tadaima install-service   # start on login
```

**Standalone binary (Linux):**
```bash
curl -L -o /usr/local/bin/tadaima \
  https://github.com/psychout98/tadaima/releases/latest/download/tadaima-linux-x64
chmod +x /usr/local/bin/tadaima
tadaima setup
tadaima install-service
```

The agent checks for updates on startup and every 24 hours. Service installations update and restart seamlessly. npm and Docker users see an update notice in the logs.

**Docker:**

The agent image is published to the GitHub Container Registry. Because `setup` is interactive, Docker agents are configured by writing the config file directly.

1. **Generate a pairing code** in the web app (Profile → Devices → Pair New Device).

2. **Claim the pairing code** from the machine that will run the agent:

   ```bash
   curl -X POST https://your-instance.up.railway.app/api/devices/pair/claim \
     -H "Content-Type: application/json" \
     -d '{"code":"ABC123","name":"my-nas","platform":"linux"}'
   ```

   The response contains `deviceId`, `deviceToken`, and `rdApiKey` — save these.

3. **Create a config file** at `./agent-config/config.json`:

   ```json
   {
     "relay": "https://your-instance.up.railway.app",
     "deviceToken": "<deviceToken from step 2>",
     "deviceId": "<deviceId from step 2>",
     "deviceName": "my-nas",
     "directories": {
       "movies": "/mnt/media/Movies",
       "tv": "/mnt/media/TV",
       "staging": "/tmp/tadaima/staging"
     },
     "realDebrid": {
       "apiKey": "<rdApiKey from step 2>"
     },
     "maxConcurrentDownloads": 2,
     "rdPollInterval": 30
   }
   ```

4. **Run the container:**

   ```yaml
   # docker-compose.agent.yml
   services:
     tadaima-agent:
       image: ghcr.io/psychout98/tadaima/agent:latest
       volumes:
         - ./agent-config:/root/.config/tadaima   # config file
         - /path/to/movies:/mnt/media/Movies      # must match directories.movies
         - /path/to/tv:/mnt/media/TV              # must match directories.tv
       restart: unless-stopped
   ```

   Or with `docker run`:

   ```bash
   docker run -d \
     --name tadaima-agent \
     -v ./agent-config:/root/.config/tadaima \
     -v /path/to/movies:/mnt/media/Movies \
     -v /path/to/tv:/mnt/media/TV \
     --restart unless-stopped \
     ghcr.io/psychout98/tadaima/agent:latest
   ```

   The volume paths on the left side are directories on your host machine. The right side paths must match what's in `config.json`.

## Agent CLI

```
tadaima setup              # Pair with your Tadaima instance
tadaima start              # Start (foreground with TUI)
tadaima start -d           # Start as background daemon
tadaima stop               # Stop daemon
tadaima status             # Show connection status
tadaima config list        # Show configuration
tadaima logs -f            # Follow log output
tadaima install-service    # Install as system service
tadaima update             # Check for and apply updates
tadaima rollback           # Restore previous version
tadaima version            # Show version
```

## Self-Hosting

For users who want to keep everything on their own hardware:

```bash
# Clone and start
git clone https://github.com/psychout98/tadaima.git
cd tadaima
docker compose -f docker-compose.prod.yml up -d
```

Access at `http://your-server:3000`. For remote access, use [Tailscale](https://tailscale.com), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), or a reverse proxy.

## Development

```bash
# Prerequisites: Node.js 22+, pnpm, PostgreSQL

pnpm install
docker compose up -d          # Start local Postgres
pnpm build                    # Build all packages
pnpm dev                      # Start all packages in dev mode
pnpm test                     # Run all tests
pnpm typecheck                # TypeScript check
pnpm lint                     # ESLint
```

### Project Structure

```
packages/
  shared/    # Zod schemas, TypeScript types, Drizzle DB schema, utilities
  relay/     # Hono API server + WebSocket relay
  web/       # React 19 + Vite + Tailwind CSS web app
  agent/     # CLI download agent
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript |
| Monorepo | Turborepo + pnpm |
| Relay | Hono, Node.js 22, ws |
| Database | PostgreSQL 16, Drizzle ORM |
| Auth | JWT (jose), bcrypt |
| Web | React 19, Vite, Tailwind CSS, zustand |
| Agent | Node.js 22, ws, conf |
| Validation | Zod |
| Testing | Vitest |
| CI/CD | GitHub Actions |
| Deploy | Railway / Docker Compose |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
