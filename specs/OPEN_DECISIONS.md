# Tadaima — Resolved Decisions

> All 37 decisions across phase specs, now resolved. Resolutions marked with ✅.

---

## Phase 1: Shared Protocol & Types

**#1 — Drizzle config location**
Should the Drizzle config live in `packages/shared/` (co-located with the schema) or `packages/relay/` (the package that runs migrations)?
✅ **`packages/shared/`** — co-located with the schema. Relay references it for running migrations.

**#2 — Migration runner sync vs async**
The `migrate.ts` uses `await`. Verify this works in the Node.js ESM environment.
✅ **Async** — works fine in Node.js 22 ESM. Verify during implementation.

---

## Phase 2: Admin Auth & Profiles

**#3 — Encryption master key storage**
The JWT secret and sensitive settings (RD key, TMDB key) are encrypted at rest. Where does the encryption master key live?
✅ **`ENCRYPTION_MASTER_KEY` environment variable** — auto-generated on first run if missing, with a warning to save it.

**#4 — Admin login required for profile selection?**
Can any profile be selected without admin login, or does the admin need to be authenticated first?
✅ **Open picker** — no admin login needed. Profile picker is open to anyone. Admin login is only for managing profiles and settings.

**#5 — First profile creation mandatory in setup wizard?**
Should the wizard require creating at least one profile, or allow skipping?
✅ **Mandatory** — the app is useless without a profile. Require one during setup.

---

## Phase 3: Device Pairing

**#6 — Config management library**
`conf` (~13.0.0, lightweight, ESM, file-based) vs `rc` + custom validation?
✅ **`conf`** — stable, atomic writes, good TypeScript support.

**#7 — CLI prompt library**
`prompts` (~2.4.0, lightweight, ESM) vs `inquirer` (~12.0.0, more features, larger)?
✅ **`prompts`** — smaller, faster, sufficient for setup flow.

**#8 — JWT signing algorithm**
HS256 (shared secret) vs RS256 (RSA key pair)?
✅ **HS256** — simpler, sufficient for single-instance self-hosted app.

**#9 — Synchronous config with `conf`**
`conf` is synchronous (blocking reads/writes). Acceptable for the setup flow?
✅ **Yes** — config is small, setup is interactive, user is already waiting.

**#10 — Platform auto-detection: generic hostnames**
When the hostname is generic (e.g., "localhost", "raspberrypi"), should the device name be auto-generated with a random suffix or should the user be prompted?
✅ **Auto-generate with random suffix** — faster UX, no extra prompt.

**#11 — Device token payload: include deviceId?**
`deviceId` in the JWT payload is redundant but useful for debugging. Keep or remove?
✅ **Keep it** — useful for log inspection without requiring a DB lookup.

---

## Phase 4: WebSocket Relay

**#12 — Hono + ws integration approach**
(A) Raw HTTP server with manual WebSocket upgrade (verbose but full control), or (B) Hono middleware wrapper (more idiomatic but may leak implementation details)?
✅ **(A) Manual upgrade** — standard practice for Hono-on-Node. Full control.

**#13 — Agent timeout: active close vs natural reconnect**
When an agent hasn't sent a heartbeat in 90s, should the relay actively close the socket, or just mark it offline and let the agent reconnect on its own?
✅ **Active close** — cleaner state management. Agent detects the close and reconnects.

**#14 — Profile token lifespan**
Short-lived (page session, re-request on load) vs long-lived (days, stays logged in)?
✅ **24-hour expiry** — longer than admin tokens since profiles are low-risk. Re-select daily.

---

## Phase 5: Search & Browse

**#15 — Stream count from Torrentio**
Limit to top 50 results, or fetch all (100+) and paginate in the UI?
✅ **Fetch all, paginate in UI** — better filtering since all data is available client-side.

---

## Phase 6: Download Pipeline & Queue

**#16 — Agent HTTP client: `got` vs native `fetch`**
`got` has streaming, retry, and timeout built-in (~15KB). Native `fetch` requires manual implementation but has no extra dependency.
✅ **`got`** — battle-tested streaming and retry logic saves code.

---

## Phase 7: Real-Time UI

**#17 — Failed download retry: store full request metadata?**
Should the download history table store enough info (magnet, torrent name, etc.) to retry directly, or should the user re-search?
✅ **Store full metadata** — add magnet, torrentName, expectedSize to history for seamless retry.

---

## Phase 8: Agent Polish

**#18 — Windows Service library**
`windows-service` vs `node-windows`?
✅ **`node-windows`** — more mature, better documented, handles registry automatically.

**#19 — System tray app framework**
Electron (tray-only mode, ~150 MB) vs `systray2`/`node-systray` (lightweight, <5 MB)?
✅ **`systray2`** — lightweight, no Chromium bloat. Fall back to Electron if too limited.

---

## Phase 9: Testing & Hardening

**#20 — Mock HTTP library**
`msw` (Mock Service Worker, network-level interception, works with `got` and `fetch`) vs `nock` (patches `http` module, doesn't work with `fetch`)?
✅ **`msw`** — framework-agnostic, works with whatever HTTP client we use.

**#21 — E2E test backend strategy**
(A) Full relay + test Postgres (realistic, slower), (B) Mock server (fast, less realistic), or (C) Hybrid?
✅ **Always real backend** — full relay + test Postgres for both CI and local dev. Maximum confidence.

**#22 — Stale-while-revalidate caching**
When cached data expires and upstream is down, serve stale or return 502?
✅ **TMDB: serve stale. Torrentio: return 502.** — Movie info rarely changes; stream availability does.

---

## Phase 10: Distribution & Deployment

**#23 — Docker base image**
`node:22-alpine` (~50 MB, potential glibc issues) vs `node:22-slim` (~80 MB, Debian-based, more compatible)?
✅ **`node:22-alpine`** — smallest image. Fall back to `bcryptjs` (pure JS) if bcrypt has glibc issues.

**#24 — Railway template vs plain deploy button**
Publish a proper Railway template (best one-click UX) vs plain deploy-from-repo button?
✅ **Railway template** — publish to the template marketplace for the best one-click experience.

**#25 — Windows installer toolchain**
(A) `electron-builder` MSI (~100 MB), (B) WiX + Bun compile (~30 MB), or (C) Electron tray-only + WiX (~60 MB)?
✅ **(B) WiX + Bun compile** — smallest installer (~30 MB). Tray app via systray2.

**#26 — Additional binary targets**
Add `linux-arm64` (ARM NAS like Synology)? Add `macos-x64` (Intel Macs)?
✅ **Include `linux-arm64` from v1.0.** Skip `macos-x64` — Rosetta 2 handles it.

**#27 — Versioning strategy**
All packages share one version (lockstep) vs independent versioning?
✅ **Lockstep** — all packages bump to the same version on every release.

**#28 — Windows code signing**
(A) Buy certificate (~$25-200/yr), (B) Azure Trusted Signing (~$10/mo), or (C) Skip for now?
✅ **Skip for initial release** — document SmartScreen bypass. Add signing when user base grows.

**#29 — macOS notarization**
(A) Apple Developer Program ($99/yr) + notarize, or (B) Skip?
✅ **Skip for initial release** — document Gatekeeper bypass via `xattr`. Add notarization later.

---

## Phase 11: Public Release

**#30 — Docs site framework**
(A) Astro Starlight, (B) Docusaurus, (C) VitePress, or (D) Plain static HTML?
✅ **Astro Starlight** — fast, dark mode, Markdown-based, built-in search. Free on GitHub Pages.

**#31 — Custom domain**
`tadaima.dev` / `tadaima.app` / etc. vs GitHub Pages URL?
✅ **GitHub Pages for now** — register a custom domain later if the project grows.

**#32 — GitHub organization**
`tadaima-app` org vs personal account?
✅ **Personal account** — simpler for a solo project. Can transfer to an org later if needed.

**#33 — Demo format for README**
GIF (auto-plays, no sound) vs video link (YouTube, requires click) vs both?
✅ **Both** — short 10-15s GIF in README + longer 2-3 min YouTube walkthrough linked below.

**#34 — Launch strategy**
Where to announce first?
✅ **r/selfhosted + r/PleX** — most aligned audiences. Save Hacker News for after initial feedback.

---

## Summary

All 37 decisions resolved. Key deviations from recommendations:

| # | Decision | Recommendation | Chosen | Difference |
|---|----------|---------------|--------|------------|
| #21 | E2E backend | Real in CI, mocks locally | Always real backend | More confidence, slightly slower local dev |
| #26 | ARM binary | Add later if demand | Include from v1.0 | ARM NAS users get first-class support from day one |
| #32 | GitHub org | Create org | Personal account | Simpler for now, can transfer later |

All other decisions followed the spec recommendations.
