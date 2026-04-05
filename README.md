# Tadaima (ただいま)

> "I'm home." — What your downloads say when they arrive.

A self-hosted media download orchestrator. Deploy your own private instance, search and trigger downloads from a Netflix-like web app, and have files organized into your Plex library automatically.

[![CI](https://github.com/psychout98/tadaima/actions/workflows/ci.yml/badge.svg)](https://github.com/psychout98/tadaima/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/tadaima?referralCode=tadaima)

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

**npm (all platforms):**
```bash
npm install -g @tadaima/agent
tadaima-agent setup
tadaima-agent start
```

**Docker:**
```yaml
services:
  tadaima:
    image: ghcr.io/psychout98/tadaima/agent:latest
    environment:
      - RELAY_URL=https://your-instance.up.railway.app
      - DEVICE_TOKEN=your-device-token
    volumes:
      - /path/to/movies:/media/movies
      - /path/to/tv:/media/tv
    restart: unless-stopped
```

## Agent CLI

```
tadaima-agent setup              # Pair with your Tadaima instance
tadaima-agent start              # Start (foreground with TUI)
tadaima-agent start -d           # Start as background daemon
tadaima-agent stop               # Stop daemon
tadaima-agent status             # Show connection status
tadaima-agent config list        # Show configuration
tadaima-agent logs -f            # Follow log output
tadaima-agent install-service    # Install as system service
tadaima-agent version            # Show version
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
