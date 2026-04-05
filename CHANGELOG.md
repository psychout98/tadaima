# Changelog

## v0.1.0 — Initial Release

### Features

- **Setup Wizard** — Guided first-run flow: admin account, TMDB/RD API keys, first profile
- **Profile System** — Netflix-style multi-profile with optional PINs
- **Device Pairing** — 6-character code flow with automatic RD key distribution
- **WebSocket Relay** — Real-time message routing between web clients and agents, profile-scoped
- **Search & Browse** — TMDB search proxy with poster images, Torrentio stream discovery
- **Stream Picker** — Filter by resolution, HDR, audio; TV season/episode selection; device selector
- **Download Pipeline** — Full Real-Debrid integration: magnet → cache → unrestrict → download → organize
- **Offline Queue** — Downloads queue when device is offline, auto-deliver on reconnect
- **Real-Time Progress** — Live progress bars, speed, ETA via WebSocket
- **Plex Organization** — Automatic Plex-compatible folder structure for movies and TV
- **Admin Panel** — Profile management, instance settings with encrypted storage
- **Agent CLI** — setup, start, daemon mode, config management, log viewer, service installer
- **TUI** — Terminal progress bars with in-place rendering
- **Toast Notifications** — Download lifecycle events with "ただいま" completion message
- **Docker Support** — Multi-stage Dockerfile for relay, separate agent Dockerfile
- **Railway Deploy** — One-click deploy with railway.json
- **CI/CD** — GitHub Actions for lint/test/build on push, Docker image builds on release
- **RD Key Rotation** — Agent auto-recovers when admin updates the RD API key

### Infrastructure

- TypeScript monorepo (Turborepo + pnpm)
- 78 tests across 4 packages (shared, relay, agent, web)
- PostgreSQL 16 with Drizzle ORM (9 tables)
- AES-256-GCM encryption for sensitive settings
- JWT auth (HS256) with token rotation
