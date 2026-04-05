# Phase 11: Public Release — Detailed Spec

> **Goal**: Prepare the project for public visibility — documentation, landing page, GitHub repo polish, and initial launch. After this phase, a new user can discover Tadaima, understand what it does, deploy it, and start using it without any help.

---

## Table of Contents

1. [Overview](#overview)
2. [GitHub README](#github-readme)
3. [Landing Page / Docs Site](#landing-page--docs-site)
4. [Documentation](#documentation)
5. [GitHub Repo Polish](#github-repo-polish)
6. [Screenshots & Demo Assets](#screenshots--demo-assets)
7. [Launch Checklist](#launch-checklist)
8. [Implementation Order](#implementation-order)
9. [Common Pitfalls](#common-pitfalls)

---

## Overview

Phase 11 is about presentation and polish. The code is done — now the project needs to communicate what it is, why someone would want it, and how to get started. There are four deliverables:

1. **GitHub README** — the front door. Must convey the project in 30 seconds and have a deploy button above the fold.
2. **Landing page / docs site** — a polished web presence with quick start, feature highlights, and full documentation.
3. **Documentation** — getting started, admin guide, CLI reference, self-hosting, FAQ.
4. **GitHub repo polish** — issue templates, PR template, contributing guide, first release.

---

## GitHub README

### 2.1 Structure

The README is the most important marketing document. It should be scannable in under 30 seconds.

**File**: `README.md`

```markdown
<div align="center">

# ただいま — Tadaima

**"I'm home." What your downloads say when they arrive.**

Search and download media from anywhere. Your agent handles the rest.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/tadaima)
[![npm](https://img.shields.io/npm/v/@tadaima/agent)](https://www.npmjs.com/package/@tadaima/agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/tadaima-app/tadaima/actions/workflows/ci.yml/badge.svg)](https://github.com/tadaima-app/tadaima/actions/workflows/ci.yml)

[Screenshots / GIF demo]

</div>

---

## What is Tadaima?

Tadaima is a self-hosted media download orchestrator. Deploy a cloud relay, search for movies and TV shows through a Netflix-like web app, and your agent — running on your PC, Mac, or NAS — handles downloading via Real-Debrid and organizing files into your Plex library.

Think: deploy your own private download service → search and click → file appears in Plex.

## Quick Start

### 1. Deploy the relay

Click the Railway button above, or self-host with Docker:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 2. Run the setup wizard

Open the deployed URL. Create an admin account, enter your TMDB and Real-Debrid API keys, and create profiles.

### 3. Install the agent

**Windows** — [Download the installer](https://github.com/tadaima-app/tadaima/releases/latest)

**macOS / Linux:**
```bash
curl -fsSL https://github.com/tadaima-app/tadaima/releases/latest/download/tadaima-$(uname -s | tr A-Z a-z)-$(uname -m) -o tadaima
chmod +x tadaima && sudo mv tadaima /usr/local/bin/
tadaima setup
```

**npm:**
```bash
npm install -g @tadaima/agent
tadaima setup
```

**Docker:**
```yaml
services:
  tadaima:
    image: ghcr.io/tadaima-app/agent:latest
    environment:
      - RELAY_URL=https://your-instance.up.railway.app
      - DEVICE_TOKEN=your-token-here
    volumes:
      - /path/to/movies:/media/movies
      - /path/to/tv:/media/tv
```

## Features

- **Netflix-like web UI** — Search TMDB, browse streams, trigger downloads from any device
- **Real-Debrid integration** — Instant cached downloads, no seeding required
- **Plex-compatible** — Files organized automatically into the right folder structure
- **Multi-profile** — Share one instance with family and friends, Netflix-style
- **Offline queue** — Downloads queue when your machine is off, start automatically when it comes back
- **Real-time progress** — Live progress bars, speed, ETA — all in the browser
- **Self-hosted** — Your data, your server, your rules. Deploy to Railway (~$5/mo) or Docker Compose (free)
- **Cross-platform agent** — Windows installer, macOS/Linux binary, npm, Docker

## How It Works

```
┌─────────────────────────────────────────┐
│            CLOUD (Railway)              │
│  ┌──────────┐    ┌────────────────┐     │
│  │  Web App  │◄──►│  Relay Server  │    │
│  └──────────┘    └───────┬────────┘     │
└──────────────────────────┼──────────────┘
                           │ WebSocket
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌────────┐  ┌────────┐  ┌────────┐
         │ Agent  │  │ Agent  │  │ Agent  │
         │ (PC)   │  │ (NAS)  │  │ (Mac)  │
         └────────┘  └────────┘  └────────┘
```

## Self-Hosting

Prefer to skip Railway? Run everything on your own server:

```bash
git clone https://github.com/tadaima-app/tadaima.git
cd tadaima
cp .env.prod.example .env
docker compose -f docker-compose.prod.yml up -d
```

Access at `http://your-server:3000`. For remote access, use [Tailscale](https://tailscale.com), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), or a reverse proxy.

## Documentation

- [Getting Started Guide](https://tadaima-app.github.io/docs/getting-started)
- [Admin Guide](https://tadaima-app.github.io/docs/admin)
- [Agent CLI Reference](https://tadaima-app.github.io/docs/cli)
- [Self-Hosting Guide](https://tadaima-app.github.io/docs/self-hosting)
- [FAQ](https://tadaima-app.github.io/docs/faq)

## Requirements

- **Real-Debrid account** — [Sign up](https://real-debrid.com/) (~€3/month)
- **TMDB API key** — [Free](https://www.themoviedb.org/settings/api)
- **Railway account** (for cloud hosting) — [Free tier available](https://railway.com)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR process.

## License

MIT — see [LICENSE](LICENSE) for details.
```

### 2.2 README Design Principles

- **Deploy button above the fold** — the first thing a visitor sees
- **30-second pitch** — "What is Tadaima?" answered in 2 sentences
- **3-step quick start** — deploy, setup, install. Not 10 steps.
- **Screenshots/GIF** — visual proof that it works and looks good
- **No jargon** — avoid "monorepo", "Hono", "Drizzle" in the README. Keep it user-facing.
- **Feature list as benefits** — "Real-time progress" not "WebSocket event streaming"

---

## Landing Page / Docs Site

### 3.1 Technology

> **✅ RESOLVED**: Use Astro Starlight for the docs site. Fast, dark mode by default (matches Tadaima's aesthetic), Markdown-based, built-in search. Free hosting via GitHub Pages.

### 3.2 Site Structure

```
tadaima-app.github.io/
├── /                        # Landing page (hero, features, quick start)
├── /docs/                   # Documentation home
├── /docs/getting-started    # Step-by-step setup
├── /docs/admin              # Admin & profile management
├── /docs/cli                # Agent CLI reference
├── /docs/self-hosting       # Docker Compose / NAS setup
├── /docs/configuration      # Config reference (instance settings, agent config)
├── /docs/faq                # FAQ / Troubleshooting
└── /docs/changelog          # Changelog (pulled from GitHub Releases)
```

### 3.3 Landing Page Content

**URL**: `https://tadaima-app.github.io/` (or custom domain if acquired)

**Sections:**

1. **Hero**
   - Headline: `ただいま — "I'm home."`
   - Subheadline: "What your downloads say when they arrive."
   - Brief description (2 sentences max)
   - Two CTAs: "Deploy to Railway" (primary) and "Read the Docs" (secondary)
   - System architecture diagram (simplified SVG)

2. **How It Works** (3-step visual)
   - Step 1: "Search from anywhere" — screenshot of search page
   - Step 2: "Click download" — screenshot of stream picker
   - Step 3: "File arrives in Plex" — screenshot of TUI showing "ただいま — completed"

3. **Features** (card grid)
   - Netflix-like web UI
   - Real-Debrid integration
   - Plex-compatible organization
   - Multi-profile sharing
   - Offline download queue
   - Real-time progress
   - Self-hosted & open source
   - Cross-platform agent

4. **Screenshots** (carousel or grid)
   - Profile picker
   - Search results
   - Stream picker with filters
   - Downloads page with progress
   - Devices page
   - Admin panel
   - Agent TUI

5. **Quick Start** (same 3 steps as README)

6. **Footer**
   - GitHub link
   - License (MIT)
   - "Built by Noah" or similar

> **✅ RESOLVED**: Use GitHub Pages for now (`username.github.io/tadaima`). Register a custom domain later if the project gains traction.

### 3.4 Hosting

GitHub Pages via the `docs/` branch or a separate `docs` repository. Astro builds static HTML that deploys for free.

GitHub Actions workflow to build and deploy on push to main:

```yaml
# .github/workflows/docs.yml
name: Deploy Docs

on:
  push:
    branches: [main]
    paths: ['docs/**']

permissions:
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: cd docs && pnpm install && pnpm build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
    steps:
      - uses: actions/deploy-pages@v4
```

---

## Documentation

### 4.1 Getting Started Guide

**File**: `docs/src/content/docs/getting-started.md`

Target audience: non-technical user who has a Real-Debrid account and wants to set up Tadaima.

**Outline:**

1. **Prerequisites**
   - Real-Debrid account (link to sign up)
   - TMDB API key (link to get one — free, explain the steps briefly)
   - A computer to run the agent (Windows, macOS, or Linux)

2. **Deploy the relay**
   - **Railway (recommended)**: Click the deploy button, wait 60 seconds, open the URL
   - **Docker Compose (self-hosted)**: Clone repo, `docker compose up`, open `http://localhost:3000`

3. **Run the setup wizard**
   - Screenshots of each step: admin account, TMDB key (with "Test" button), RD key (with "Test" button), first profile
   - Emphasize: "You'll only do this once."

4. **Install the agent**
   - **Windows**: Download `.msi` → run installer → follow wizard → done
   - **macOS**: Download binary → setup command → start
   - **Linux**: Same as macOS
   - **Docker (NAS)**: Docker Compose snippet
   - **npm (developers)**: npm install command

5. **Your first download**
   - Walk through: open web app → pick profile → search for a movie → click result → pick a stream → click Download → watch progress → "ただいま — Interstellar has arrived"

6. **Add more profiles**
   - Log in as admin → admin panel → create profiles for family/friends
   - Each person picks their profile, pairs their own device

### 4.2 Admin Guide

**File**: `docs/src/content/docs/admin.md`

1. **Managing profiles** — create, edit PIN, delete (with cascade warning)
2. **Instance settings** — update TMDB key, update RD key (with rotation note)
3. **Usage stats** — what each column means, how to interpret
4. **RD key rotation** — update in admin panel → agents auto-recover
5. **Viewing connected devices** — which devices are online, last seen

### 4.3 Agent CLI Reference

**File**: `docs/src/content/docs/cli.md`

```markdown
## Commands

### `tadaima setup`
Interactive first-time configuration. Prompts for relay URL, pairing code, and media directories.

### `tadaima start`
Start the agent in foreground mode with TUI (terminal progress bars).

Options:
- `-d, --daemon` — Run as background daemon

### `tadaima stop`
Stop the background daemon.

### `tadaima status`
Show connection status, active downloads, and disk space.

### `tadaima config get <key>`
Read a config value. Supports dot notation: `directories.movies`

### `tadaima config set <key> <value>`
Update a config value.

### `tadaima config list`
Show all config values (sensitive values redacted).

### `tadaima logs`
Show recent log output (last 50 lines).

Options:
- `-f, --follow` — Live tail
- `-n <lines>` — Number of lines

### `tadaima install-service`
Install as a system service (Windows Service, systemd, launchd).

### `tadaima uninstall-service`
Remove the system service.

### `tadaima version`
Show version information.
```

### 4.4 Self-Hosting Guide

**File**: `docs/src/content/docs/self-hosting.md`

1. **Requirements**: Docker, Docker Compose, a machine that stays on
2. **Setup**: Clone, configure `.env`, `docker compose up`
3. **Remote access options**:
   - Tailscale (simplest — install on server + phone, use Tailscale IP)
   - Cloudflare Tunnel (free, requires domain, more setup)
   - Reverse proxy (Caddy example, nginx example)
4. **Updating**: `docker compose pull && docker compose up -d`
5. **Backups**: PostgreSQL dump command, config file backup
6. **Running alongside Plex**: common setup with shared media volumes

### 4.5 Configuration Reference

**File**: `docs/src/content/docs/configuration.md`

**Instance settings** (configured in web UI):

| Setting | Description | Where |
|---------|-------------|-------|
| TMDB API Key | For movie/TV search | Admin panel |
| Real-Debrid API Key | For downloads (shared across all profiles) | Admin panel |

**Agent config file** (`~/.config/tadaima/config.json`):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `relay` | string | — | Relay server URL |
| `deviceToken` | string | — | Device authentication token |
| `deviceId` | string | — | Device UUID |
| `deviceName` | string | auto-detected | Device display name |
| `profileName` | string | — | Associated profile name |
| `directories.movies` | string | — | Movies destination folder |
| `directories.tv` | string | — | TV shows destination folder |
| `directories.staging` | string | `/tmp/tadaima/staging` | Temporary download directory |
| `realDebrid.apiKey` | string | — | RD API key (received during pairing) |
| `maxConcurrentDownloads` | number | `2` | Max simultaneous downloads |
| `rdPollInterval` | number | `30` | Seconds between RD status polls |
| `autoUpdate` | boolean / "notify" | varies | Auto-update behavior |

### 4.6 FAQ / Troubleshooting

**File**: `docs/src/content/docs/faq.md`

| Question | Answer |
|----------|--------|
| "Do I need a Real-Debrid account?" | Yes. Tadaima uses RD for downloading. ~€3/month. |
| "Is this legal?" | Tadaima is a download tool. What you download is your responsibility. |
| "Can I use this without Plex?" | Yes. Files are organized in a standard folder structure that works with any media server (Jellyfin, Emby, etc.) or just a file browser. |
| "How much does Railway cost?" | ~$5-10/month for the relay + Postgres. Split it with your profiles. |
| "Can multiple people download at the same time?" | Yes, each profile has their own queue. RD may throttle if too many concurrent downloads hit their servers. |
| "My agent can't connect to the relay" | Check: relay URL correct? Device token valid? Firewall blocking WebSocket? Try `tadaima status`. |
| "Downloads are stuck in 'Waiting'" | RD is processing the torrent. If it stays stuck for >30 minutes, the torrent may not have enough seeders. |
| "SmartScreen is blocking the Windows installer" | The installer isn't code-signed yet. Click "More info" → "Run anyway". |
| "macOS says the binary is from an unidentified developer" | Run: `xattr -d com.apple.quarantine /usr/local/bin/tadaima` |
| "How do I update?" | Windows: auto-updates. macOS/Linux: re-download the binary. npm: `npm update -g @tadaima/agent`. Docker: `docker compose pull`. |
| "Can I run the relay and agent on the same machine?" | Yes! Use Docker Compose for the relay and run the agent natively, or run both in Docker. |
| "How do I back up my data?" | Back up the PostgreSQL database: `docker compose exec postgres pg_dump -U tadaima tadaima > backup.sql` |

---

## GitHub Repo Polish

### 5.1 Issue Templates

**File**: `.github/ISSUE_TEMPLATE/bug_report.yml`

```yaml
name: Bug Report
description: Report something that isn't working correctly
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting a bug! Please fill out the details below.
  - type: dropdown
    id: component
    attributes:
      label: Component
      options:
        - Web App
        - Relay Server
        - Agent (CLI)
        - Agent (Windows Installer)
        - Agent (Docker)
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Version
      placeholder: "e.g., 1.0.0"
    validations:
      required: true
  - type: textarea
    id: description
    attributes:
      label: What happened?
      placeholder: Describe the bug
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: What did you expect?
      placeholder: What should have happened instead
    validations:
      required: true
  - type: textarea
    id: reproduce
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Go to ...
        2. Click on ...
        3. See error ...
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Relevant logs
      description: Paste any error messages or log output
      render: shell
```

**File**: `.github/ISSUE_TEMPLATE/feature_request.yml`

```yaml
name: Feature Request
description: Suggest an idea or improvement
labels: ["enhancement"]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem does this solve?
      placeholder: Describe the problem or need
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: Proposed solution
      placeholder: How would you like this to work?
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
      placeholder: Any other approaches you've thought of
```

### 5.2 PR Template

**File**: `.github/pull_request_template.md`

```markdown
## What does this PR do?

<!-- Brief description of the change -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation
- [ ] CI/CD

## Checklist

- [ ] Tests pass (`pnpm test`)
- [ ] TypeScript compiles (`pnpm typecheck`)
- [ ] Linting passes (`pnpm lint`)
- [ ] New tests added for new functionality
- [ ] Documentation updated (if applicable)
```

### 5.3 Contributing Guide

**File**: `CONTRIBUTING.md`

```markdown
# Contributing to Tadaima

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. **Prerequisites**: Node.js 22+, pnpm 9+, Docker (for Postgres)

2. **Clone and install**:
   ```bash
   git clone https://github.com/tadaima-app/tadaima.git
   cd tadaima
   pnpm install
   ```

3. **Start the dev environment**:
   ```bash
   pnpm dev
   ```
   This starts:
   - Postgres (Docker) on port 5432
   - Relay server on port 3000
   - Web app on port 5173
   - Agent in watch mode

4. **Run tests**:
   ```bash
   pnpm test          # Unit + integration tests
   pnpm test:e2e      # Playwright E2E tests
   ```

## Code Style

- TypeScript everywhere
- ESLint + Prettier (run `pnpm lint` to check)
- camelCase for JSON/API, snake_case for database columns
- Zod schemas for all message types and API contracts

## PR Process

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run `pnpm lint && pnpm typecheck && pnpm test`
5. Open a PR against `main`

## Project Structure

```
packages/
  shared/   # Types, schemas, utilities (imported by all other packages)
  relay/    # Cloud API server (Hono + PostgreSQL)
  web/      # React SPA (Vite + Tailwind)
  agent/    # Download daemon / CLI (Node.js)
```

## Questions?

Open a [Discussion](https://github.com/tadaima-app/tadaima/discussions) or file an issue.
```

### 5.4 Code of Conduct

**File**: `CODE_OF_CONDUCT.md`

Use the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) — the industry standard.

### 5.5 Changelog

**File**: `CHANGELOG.md`

Generated from conventional commits. Maintained by the release workflow. Format:

```markdown
# Changelog

## v1.0.0 (YYYY-MM-DD)

### Features
- Netflix-style profile picker with optional PIN
- TMDB search with poster images
- Stream picker with resolution/HDR/audio filters
- Real-Debrid integration (add magnet → poll → download)
- Plex-compatible file organization
- Offline download queue (queue when device is off, deliver on reconnect)
- Real-time download progress via WebSocket
- Agent TUI with progress bars
- Agent daemon mode + system service installation
- Windows installer with GUI wizard + system tray app
- Railway one-click deploy
- Self-hosted Docker Compose support
- Agent auto-update mechanism

### Initial Release
This is the first public release of Tadaima.
```

### 5.6 License

**File**: `LICENSE`

MIT License. Already specified in the architecture doc.

### 5.7 GitHub Repository Settings

Enable via GitHub UI or API:

- **Discussions** — enabled (for questions, feature ideas, show-and-tell)
- **Topics** — `plex`, `media`, `download`, `real-debrid`, `self-hosted`, `typescript`
- **Description** — "ただいま — Self-hosted media download orchestrator. Search, click, arrive."
- **Website** — link to docs site
- **Social preview image** — branded card with name + tagline + system diagram

> **✅ RESOLVED**: Keep the repo on Noah's personal GitHub account. Simpler for a solo project. Can transfer to an organization later if needed.

---

## Screenshots & Demo Assets

### 6.1 Required Screenshots

Screenshots should be taken from the actual app running with realistic data (not placeholder text). Use the dark theme.

| Screenshot | Shows | Used In |
|-----------|-------|---------|
| `profile-picker.png` | Netflix-style profile grid with 3-4 profiles | README, landing page, docs |
| `search-results.png` | Search for "Interstellar" with poster grid | README, landing page |
| `stream-picker.png` | Stream list with resolution/HDR badges + RD cache badges | README, landing page |
| `downloads-active.png` | Active downloads with progress bars, speed, ETA | README, landing page |
| `downloads-history.png` | Download history with status badges | Landing page |
| `devices-page.png` | Paired devices with online/offline status | Landing page |
| `admin-panel.png` | Admin panel with profiles + settings | Docs |
| `setup-wizard.png` | Setup wizard step (e.g., RD key entry) | Docs |
| `agent-tui.png` | Terminal showing TUI with progress bars | README, landing page |
| `windows-tray.png` | Windows tray app with right-click menu | Docs |

### 6.2 Demo GIF/Video

> **✅ RESOLVED**: Both formats. A short GIF (10-15 seconds) embedded in the README showing search → pick stream → download progress → completion toast. Plus a link to a longer YouTube video (2-3 minutes) showing the full flow from deploy to first download.

**GIF content** (10-15 seconds):
1. Type "Interstellar" in search bar
2. Click result → stream picker appears
3. Click download → progress bar fills
4. "ただいま — Interstellar has arrived" toast

**Video content** (2-3 minutes):
1. Click "Deploy to Railway" → instance spins up
2. Setup wizard: admin account, API keys, profile
3. Profile picker → select profile
4. Search → stream picker → download
5. Agent TUI showing progress
6. File appears in Plex-compatible folder
7. Quick look at admin panel

### 6.3 Social Preview Image

**File**: `docs/public/social-preview.png`

1200×630px image for Open Graph / Twitter Cards:
- Dark background (`#0f0f0f`)
- "ただいま" in large text
- Tagline: "Self-hosted media download orchestrator"
- Simplified system diagram or app screenshot

---

## Launch Checklist

> **✅ RESOLVED**: Launch first on r/selfhosted and r/PleX — the most aligned audiences. These communities actively seek tools like this. Save Hacker News for after initial feedback is incorporated.

### Pre-Launch

- [ ] All Phase 0-10 exit criteria met
- [ ] README finalized with screenshots and deploy button
- [ ] Landing page / docs site live on GitHub Pages
- [ ] Getting started guide tested by someone who hasn't seen the project before
- [ ] All documentation reviewed for accuracy
- [ ] GitHub repo settings configured (topics, description, social preview)
- [ ] Issue templates and PR template in place
- [ ] CONTRIBUTING.md and CODE_OF_CONDUCT.md in place
- [ ] First GitHub Release (v1.0.0) published with changelog and all assets
- [ ] Railway template published and deploy button tested
- [ ] npm package published and installable
- [ ] Docker images pushed to GHCR and pullable
- [ ] Windows installer tested on a clean Windows machine
- [ ] macOS binary tested (with Gatekeeper bypass documented)
- [ ] Linux binary tested

### Launch Day

- [ ] Verify all links in README work
- [ ] Verify Railway deploy button works (test on a fresh account)
- [ ] Verify docs site is accessible
- [ ] Publish announcement post(s)
- [ ] Monitor GitHub Issues and Discussions for the first 48 hours
- [ ] Respond to all issues and questions within 24 hours

### Post-Launch (First Week)

- [ ] Triage and address any bug reports
- [ ] Collect feedback on UX, installation, documentation gaps
- [ ] Plan v1.1 based on feedback
- [ ] Add "Community" or "Users" section to README if people share screenshots

---

## Implementation Order

### Step 1: GitHub Repo Polish (Day 1)
1. Create issue templates (bug report, feature request)
2. Create PR template
3. Write CONTRIBUTING.md
4. Add CODE_OF_CONDUCT.md (Contributor Covenant)
5. Configure GitHub repo settings (topics, description, discussions)

### Step 2: Documentation (Day 2-4)
6. Set up Astro Starlight project in `docs/` directory
7. Write Getting Started guide (with screenshots from running app)
8. Write Admin guide
9. Write Agent CLI reference
10. Write Self-Hosting guide
11. Write Configuration reference
12. Write FAQ / Troubleshooting
13. Deploy docs to GitHub Pages

### Step 3: Screenshots & Assets (Day 4-5)
14. Take all screenshots from running app with realistic data
15. Record demo GIF (10-15 seconds)
16. Record demo video (2-3 minutes) — optional for v1.0
17. Create social preview image

### Step 4: README (Day 5)
18. Write final README with screenshots, badges, deploy button
19. Review README for scannability (can someone understand the project in 30 seconds?)

### Step 5: Landing Page (Day 5-7)
20. Design and build landing page in Astro
21. Add hero section, features, quick start, screenshots
22. Deploy to GitHub Pages alongside docs

### Step 6: First Release (Day 7)
23. Write CHANGELOG.md for v1.0.0
24. Verify all CI/CD artifacts build successfully
25. Create and push `v1.0.0` tag
26. Verify GitHub Release appears with all assets
27. Verify Railway template works
28. Verify npm package installable
29. Verify Docker images pullable

### Step 7: Launch (Day 8)
30. Final check: all links, all downloads, all docs
31. Publish launch post(s)
32. Monitor and respond to feedback

---

## Common Pitfalls

1. **Don't launch without testing the deploy button on a fresh Railway account** — your own account may have cached settings or provisioned services that mask issues.

2. **Don't write docs from memory** — follow the actual setup steps while writing. You'll catch missing steps, unclear instructions, and changed defaults.

3. **Don't skip the "tested by a fresh set of eyes" check** — have someone who hasn't seen the project try the getting started guide. They'll find the blind spots.

4. **Don't over-engineer the landing page** — a clean, fast static page is better than a slow, fancy one. The content matters more than the animations.

5. **Don't publish the npm package with test files** — double-check the `files` field in `package.json`. Run `npm pack --dry-run` to see what's included.

6. **Don't forget to update version numbers everywhere** — root `package.json`, all package `package.json` files, and the version constant in the relay code must match.

7. **Don't link to docs pages that don't exist** — verify every documentation link in the README resolves.

8. **Screenshots should use realistic data** — "Movie 1", "Test User", and "lorem ipsum" look amateurish. Use real movie titles, real names, realistic download sizes.

9. **Don't announce on too many channels at once** — start with 1-2 communities, incorporate feedback, then expand. A bad first impression is hard to recover from.

10. **Respond to every issue and question in the first week** — early community engagement determines whether people stick around. Fast responses signal an active, maintained project.

---

## Verification Checklist

Before marking Phase 11 as complete:

- [ ] README in repo root with deploy button, screenshots, quick start, feature list
- [ ] Landing page live and accessible
- [ ] Documentation covers: getting started, admin, CLI, self-hosting, config, FAQ
- [ ] Getting started guide tested end-to-end by a fresh user
- [ ] Issue templates and PR template in place
- [ ] CONTRIBUTING.md describes dev setup and PR process
- [ ] CODE_OF_CONDUCT.md present
- [ ] CHANGELOG.md for v1.0.0
- [ ] GitHub Release v1.0.0 published with all assets and changelog
- [ ] All documentation links resolve
- [ ] Social preview image set on GitHub repo
- [ ] GitHub Discussions enabled
- [ ] Deploy button tested on fresh Railway account
- [ ] npm package installable
- [ ] Docker images pullable
- [ ] Project is publicly accessible and usable by a new user following only the docs

---

End of Phase 11 Spec.
