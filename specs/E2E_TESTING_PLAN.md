# Tadaima — Playwright E2E Testing Plan

> Comprehensive end-to-end test coverage mapped to every feature in Phases 0–11.

---

## Table of Contents

1. [Infrastructure & Setup](#1-infrastructure--setup)
2. [Test Suites](#2-test-suites)
   - [TS-01: Setup Wizard](#ts-01-setup-wizard)
   - [TS-02: Admin Authentication](#ts-02-admin-authentication)
   - [TS-03: Profile Management (Admin)](#ts-03-profile-management-admin)
   - [TS-04: Profile Picker & Selection](#ts-04-profile-picker--selection)
   - [TS-05: Device Pairing](#ts-05-device-pairing)
   - [TS-06: Device Management](#ts-06-device-management)
   - [TS-07: WebSocket Connectivity](#ts-07-websocket-connectivity)
   - [TS-08: Search & Browse](#ts-08-search--browse)
   - [TS-09: Stream Selection](#ts-09-stream-selection)
   - [TS-10: Download Pipeline](#ts-10-download-pipeline)
   - [TS-11: Download Queue (Offline)](#ts-11-download-queue-offline)
   - [TS-12: Downloads Page & History](#ts-12-downloads-page--history)
   - [TS-13: Real-Time Progress UI](#ts-13-real-time-progress-ui)
   - [TS-14: Recently Viewed](#ts-14-recently-viewed)
   - [TS-15: Settings Page](#ts-15-settings-page)
   - [TS-16: Admin Panel — API Keys](#ts-16-admin-panel--api-keys)
   - [TS-17: Toast Notifications](#ts-17-toast-notifications)
   - [TS-18: Navigation & App Shell](#ts-18-navigation--app-shell)
   - [TS-19: Auth Guards & Token Lifecycle](#ts-19-auth-guards--token-lifecycle)
   - [TS-20: Error Handling & Edge Cases](#ts-20-error-handling--edge-cases)
3. [Helpers & Fixtures](#3-helpers--fixtures)
4. [Mock Strategy](#4-mock-strategy)
5. [CI Integration](#5-ci-integration)

---

## 1. Infrastructure & Setup

### 1.1 Playwright Configuration

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,            // Sequential — tests share DB state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html"], ["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox",  use: { ...devices["Desktop Firefox"] } },
    { name: "mobile",   use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/api/setup/status",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

### 1.2 Directory Structure

```
e2e/
├── fixtures/
│   ├── auth.fixture.ts          # Login/profile helpers
│   ├── db.fixture.ts            # DB seed/reset helpers
│   ├── ws-mock.fixture.ts       # WebSocket mock agent
│   └── api-mock.fixture.ts      # TMDB/RD response stubs
├── helpers/
│   ├── selectors.ts             # Shared data-testid selectors
│   ├── constants.ts             # Test credentials, URLs
│   └── wait-helpers.ts          # Custom waitFor utilities
├── setup-wizard.spec.ts         # TS-01
├── admin-auth.spec.ts           # TS-02
├── profile-management.spec.ts   # TS-03
├── profile-picker.spec.ts       # TS-04
├── device-pairing.spec.ts       # TS-05
├── device-management.spec.ts    # TS-06
├── websocket.spec.ts            # TS-07
├── search-browse.spec.ts        # TS-08
├── stream-selection.spec.ts     # TS-09
├── download-pipeline.spec.ts    # TS-10
├── download-queue.spec.ts       # TS-11
├── downloads-page.spec.ts       # TS-12
├── realtime-progress.spec.ts    # TS-13
├── recently-viewed.spec.ts      # TS-14
├── settings-page.spec.ts        # TS-15
├── admin-api-keys.spec.ts       # TS-16
├── toasts.spec.ts               # TS-17
├── app-shell.spec.ts            # TS-18
├── auth-guards.spec.ts          # TS-19
└── error-handling.spec.ts       # TS-20
```

### 1.3 Global Setup / Teardown

**`e2e/global-setup.ts`** — Runs once before all tests:
- Start Docker Postgres (or use test-specific `DATABASE_URL`)
- Run Drizzle migrations (`pnpm --filter @tadaima/shared db:migrate`)
- Truncate all tables to a clean state

**`e2e/global-teardown.ts`** — Runs once after all tests:
- Drop test database or truncate tables
- Stop any spawned processes

### 1.4 Environment

| Variable | Test Value |
|---|---|
| `DATABASE_URL` | `postgres://test:test@localhost:5433/tadaima_test` |
| `JWT_SECRET` | `test-secret-e2e` |
| `PORT` | `3000` |
| `NODE_ENV` | `test` |

---

## 2. Test Suites

---

### TS-01: Setup Wizard

**Spec coverage:** Phase 0, Phase 2 (setup endpoints + `SetupWizard.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 1.1 | Fresh instance redirects to setup | Navigate to `/` on clean DB | Redirected to `/setup`; wizard step 1 visible |
| 1.2 | Step 1 — Create admin account | Fill username + password (min 8 chars) + confirm password; click Next | Advances to step 2; no errors |
| 1.3 | Step 1 — Password mismatch rejected | Enter mismatched passwords; submit | Inline validation error; does not advance |
| 1.4 | Step 1 — Short password rejected | Enter 5-char password | Inline validation error shown |
| 1.5 | Step 2 — Enter TMDB API key | Paste valid TMDB key; click Next | Key validated via `POST /api/setup/complete` partial or test endpoint; advances to step 3 |
| 1.6 | Step 2 — Invalid TMDB key rejected | Enter gibberish key; submit | Error toast or inline error; stays on step 2 |
| 1.7 | Step 3 — Enter Real-Debrid API key | Paste valid RD key; click Next | Advances to step 4 (profile creation) |
| 1.8 | Step 3 — Invalid RD key rejected | Enter bad key; submit | Error message; stays on step 3 |
| 1.9 | Step 4 — Create first profile | Enter profile name + select avatar; click Finish | `POST /api/setup/complete` succeeds; redirected to `/profiles` |
| 1.10 | Setup idempotency | After setup, navigate to `/setup` | Redirected away (to `/profiles` or `/`); setup not shown |
| 1.11 | `GET /api/setup/status` pre-setup | Call API directly | `{ needsSetup: true }` |
| 1.12 | `GET /api/setup/status` post-setup | Call API after completing setup | `{ needsSetup: false }` |

---

### TS-02: Admin Authentication

**Spec coverage:** Phase 2 (auth routes + `AdminLogin.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 2.1 | Successful admin login | Enter valid admin credentials; submit | Redirected to `/admin`; JWT stored; admin UI visible |
| 2.2 | Invalid password rejected | Enter wrong password; submit | Error message shown; remains on login page |
| 2.3 | Invalid username rejected | Enter non-existent username; submit | Generic "Invalid credentials" error (no user enumeration) |
| 2.4 | Empty fields rejected | Submit with empty form | Validation errors on both fields |
| 2.5 | Token refresh works transparently | Login; wait for access token to near-expire; perform admin action | Action succeeds; new access token issued via `/api/auth/refresh` |
| 2.6 | Logout clears session | Click logout button in admin panel | Redirected to login; admin routes inaccessible; refresh token revoked |
| 2.7 | Expired refresh token forces re-login | Manually expire refresh token in DB; attempt admin action | Redirected to login page |
| 2.8 | Multiple login sessions | Login from two browser contexts | Both sessions active independently |

---

### TS-03: Profile Management (Admin)

**Spec coverage:** Phase 2 (profiles routes + `AdminPanel.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 3.1 | List profiles | Login as admin; navigate to admin panel | All profiles displayed in list |
| 3.2 | Create profile | Click "Add Profile"; enter name + avatar; save | New profile appears in list; `POST /api/profiles` returns 201 |
| 3.3 | Create profile with PIN | Add profile with 4-digit PIN | Profile created; PIN icon/indicator shown |
| 3.4 | Duplicate name rejected | Create profile with name that already exists | Error message; profile not created |
| 3.5 | Edit profile name | Click edit on existing profile; change name; save | Name updated in list; `PATCH /api/profiles/:id` returns 200 |
| 3.6 | Edit profile avatar | Change avatar selection; save | Avatar updated in UI |
| 3.7 | Add PIN to existing profile | Edit profile; add PIN; save | PIN protection enabled |
| 3.8 | Remove PIN from profile | Edit profile; clear PIN; save | PIN protection removed |
| 3.9 | Delete profile | Click delete; confirm in dialog | Profile removed from list; associated devices/history cleaned up |
| 3.10 | Delete last profile prevented | Attempt to delete the only profile | Error or disabled button; at least one profile must exist |
| 3.11 | Non-admin cannot manage profiles | As profile-only session, attempt `POST /api/profiles` | 401/403 response |

---

### TS-04: Profile Picker & Selection

**Spec coverage:** Phase 2 (`ProfilePicker.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 4.1 | Profile grid renders | Navigate to `/profiles` | All profiles displayed as cards with names + avatars |
| 4.2 | Select profile (no PIN) | Click profile without PIN | Profile session started; redirected to `/search` (or home) |
| 4.3 | Select profile (with PIN) | Click PIN-protected profile | PIN input modal appears |
| 4.4 | Correct PIN accepted | Enter correct 4-digit PIN; submit | Session started; redirected to app |
| 4.5 | Wrong PIN rejected | Enter incorrect PIN; submit | Error message; remains on PIN input |
| 4.6 | PIN input auto-submits on 4 digits | Type 4 digits | Automatically submits without clicking a button |
| 4.7 | Admin link visible | Look for admin/settings link | "Admin" or gear icon link navigates to `/admin/login` |
| 4.8 | Profile session token stored | Select profile; inspect store/cookies | Profile JWT issued via `POST /api/profiles/:id/select` |
| 4.9 | Switch profile | From within app, navigate back to profile picker; select different profile | New session started; previous profile data cleared |

---

### TS-05: Device Pairing

**Spec coverage:** Phase 3 (devices routes, agent-config route, `DevicesPage.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 5.1 | Generate pairing code | Navigate to Devices page; click "Pair New Device" | 6-character alphanumeric code displayed; countdown timer shown |
| 5.2 | Pairing code format | Inspect displayed code | Exactly 6 characters; alphanumeric; uppercase |
| 5.3 | Code expires after timeout | Wait for code expiry (1 hour real, shortened in test) | Code marked expired; UI prompts to generate new one |
| 5.4 | Claim pairing code (API) | `POST /api/devices/pair/claim` with valid code + device info | 200 response with device token; device appears in device list |
| 5.5 | Claim expired code rejected | Claim code after expiry | 400/410 error; code invalid |
| 5.6 | Claim already-used code rejected | Claim same code twice | Second claim fails with error |
| 5.7 | Device appears after pairing | Pair a device via API | Devices page shows new device with name, platform, status |
| 5.8 | Only one active code per profile | Generate code; generate another | First code invalidated; only second code is active |
| 5.9 | Agent config endpoint | `GET /api/agent/config` with device token | Returns RD API key + relay version |
| 5.10 | Agent config requires device auth | `GET /api/agent/config` without token | 401 response |

---

### TS-06: Device Management

**Spec coverage:** Phase 3 (`DevicesPage.tsx`, devices routes)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 6.1 | List devices | Navigate to Devices page with paired devices | All devices shown with name, platform, online/offline status |
| 6.2 | Rename device | Click edit on device; change name; save | Device name updated; `PATCH /api/devices/:id` succeeds |
| 6.3 | Remove/unpair device | Click remove; confirm | Device removed from list; `DELETE /api/devices/:id` succeeds |
| 6.4 | Device online indicator | Connect mock agent via WebSocket | Device card shows green "Online" status |
| 6.5 | Device offline indicator | Disconnect mock agent | Device card shows "Offline" status; `lastSeenAt` updated |
| 6.6 | Device limit enforcement | Attempt to pair 6th device (max 5) | Pairing fails with limit error |
| 6.7 | Default device selection | Set a device as default | Device marked as default; used for downloads by default |
| 6.8 | Device platform info displayed | Pair devices with different platforms | Platform (Windows/macOS/Linux) shown on each card |

---

### TS-07: WebSocket Connectivity

**Spec coverage:** Phase 4 (ws handler, pool, `ws-client.ts`, `AppShell.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 7.1 | Web client connects on profile select | Select a profile | WebSocket connection established to relay |
| 7.2 | Connection status indicator | Observe app shell after profile select | Green connection indicator visible |
| 7.3 | Reconnection on disconnect | Kill WS connection server-side | Client auto-reconnects; indicator briefly shows disconnected then reconnects |
| 7.4 | Agent connection via WS | Connect mock agent with device token | Agent registered in relay pool; device status broadcast as online |
| 7.5 | Agent heartbeat | Connect agent; wait for heartbeat interval | `agent:heartbeat` messages received by relay; connection stays alive |
| 7.6 | Stale connection reaped | Connect agent; stop sending heartbeats for >90s | Connection closed by relay; device marked offline |
| 7.7 | Message routing web→agent | Send download request from web | Message routed through relay to correct agent |
| 7.8 | Message routing agent→web | Agent sends progress update | Message routed through relay to correct web client |
| 7.9 | Multi-client broadcast | Two web tabs for same profile; agent sends event | Both tabs receive the event |
| 7.10 | Auth required for WS | Attempt WS connection without token | Connection rejected |

---

### TS-08: Search & Browse

**Spec coverage:** Phase 5 (proxy routes, `SearchPage.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 8.1 | Search page loads | Navigate to `/search` | Search bar visible; recently viewed section shown (or empty state) |
| 8.2 | Search for movie | Type "Inception" in search bar; submit/debounce | Results grid shows matching movies from TMDB |
| 8.3 | Search for TV show | Type "Breaking Bad"; submit | Results grid shows matching TV shows |
| 8.4 | Empty search results | Search for gibberish string | "No results found" message displayed |
| 8.5 | Result card displays info | Inspect a search result card | Shows poster, title, year, media type badge |
| 8.6 | Click result opens details | Click on a movie result | Media details view with overview, rating, runtime/seasons |
| 8.7 | Movie details — metadata | Open movie detail | Title, year, overview, rating, runtime, genres visible |
| 8.8 | TV show details — seasons | Open TV show detail | Season list with episode counts displayed |
| 8.9 | Poster images load | View search results | Poster images proxied via `/api/poster/:path` render correctly |
| 8.10 | Search debounce | Type quickly | Only one API call made after typing stops (not per keystroke) |
| 8.11 | Search caching | Search same term twice | Second search faster (served from cache); network shows cache hit |
| 8.12 | TMDB proxy auth | Verify search works only with profile session | Unauthenticated search requests rejected |

---

### TS-09: Stream Selection

**Spec coverage:** Phase 5–6 (`StreamPicker.tsx`, proxy routes)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 9.1 | Stream picker opens | Click "Download" on a movie | Stream picker modal/panel appears with available streams |
| 9.2 | Streams listed with metadata | View stream list | Each stream shows resolution, codec, audio, size, source |
| 9.3 | Filter by resolution | Select "1080p" filter | Only 1080p streams shown |
| 9.4 | Filter by HDR | Toggle HDR filter | Only HDR streams shown |
| 9.5 | Filter by audio | Select "Atmos" or specific audio filter | Filtered results displayed |
| 9.6 | Multiple filters combine | Select 1080p + HDR | Only streams matching both filters shown |
| 9.7 | Clear filters | Clear all filters | Full stream list restored |
| 9.8 | Stream pagination | View result set larger than page size | Pagination controls visible and functional |
| 9.9 | RD cache badge | Stream cached in Real-Debrid | Cache badge/indicator shown on cached streams |
| 9.10 | TV show — season/episode selector | Open TV show; select season + episode | Episode-specific streams loaded |
| 9.11 | Device selector | Multiple devices paired | Device dropdown allows selecting target device |
| 9.12 | Default device pre-selected | One device set as default | Default device pre-selected in dropdown |
| 9.13 | Download button triggers request | Select stream + device; click Download | `download:request` WebSocket message sent; modal closes |
| 9.14 | No streams available | Open title with no streams | "No streams available" message shown |

---

### TS-10: Download Pipeline

**Spec coverage:** Phase 6 (download handler, RD client, organizer — tested via mock agent)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 10.1 | Download request accepted | Trigger download from web | Agent receives request; sends `download:accepted`; web shows active download |
| 10.2 | Download phases progress | Monitor download lifecycle | Phases visible: Adding to RD → Waiting for cache → Downloading → Organizing → Complete |
| 10.3 | Download completion | Wait for full mock download | `download:completed` received; file path included; history entry created |
| 10.4 | Download failure | Mock agent sends `download:failed` | Error shown in UI; history records failure with error message |
| 10.5 | Download cancellation (web-initiated) | Click cancel on active download | `download:cancel` sent; agent stops; download marked cancelled |
| 10.6 | Download rejected (queue full) | Agent at max concurrent downloads; send another | `download:rejected` received; user notified |
| 10.7 | Concurrent download limit | Trigger 3 downloads with limit of 2 | 2 active, 1 queued or rejected |
| 10.8 | Movie file organization | Complete movie download | File organized to `Movies/Title (Year)/Title (Year).ext` |
| 10.9 | TV episode file organization | Complete TV download | File organized to `TV Shows/Show/Season XX/Show - sXXeYY - Episode.ext` |
| 10.10 | Retryable failure indicated | Agent sends failure with `retryable: true` | UI shows retry option |
| 10.11 | Download history recorded | Complete/fail multiple downloads | All entries visible in `GET /api/downloads` with correct status |

---

### TS-11: Download Queue (Offline)

**Spec coverage:** Phase 6 (queue.ts, download_queue table)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 11.1 | Queue download when device offline | Device offline; trigger download | Download queued; `download:queued` message sent to web; queue entry in DB |
| 11.2 | Queued download shown in UI | Queue a download while offline | Downloads page shows item in "Queued" section |
| 11.3 | Queue delivered on reconnect | Queue download; connect agent | Agent receives queued download; download starts automatically |
| 11.4 | Cancel queued download | Queue download; click cancel before delivery | `DELETE /api/downloads/queue/:id` succeeds; item removed |
| 11.5 | Queue expiry (14 days) | Create queue entry with old timestamp | Expired entries cleaned up; not delivered to agent |
| 11.6 | Multiple queued downloads | Queue 3 downloads while offline | All 3 shown in queue; all 3 delivered on reconnect |
| 11.7 | Queue status transitions | Queue → deliver → complete | Status progresses: `queued` → `delivered` → tracked in history |

---

### TS-12: Downloads Page & History

**Spec coverage:** Phase 7 (`DownloadsPage.tsx`, downloads routes)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 12.1 | Downloads page loads | Navigate to `/downloads` | Page renders with tabs/sections for active, queued, history |
| 12.2 | Active downloads section | Have an active download | Active download card with title, progress bar, speed, ETA |
| 12.3 | Queued downloads section | Have queued downloads | Queued items shown with cancel button |
| 12.4 | History — completed downloads | Complete a download | Appears in history with "completed" badge, title, date, size |
| 12.5 | History — failed downloads | Fail a download | Appears in history with "failed" badge and error message |
| 12.6 | History — cancelled downloads | Cancel a download | Appears in history with "cancelled" badge |
| 12.7 | History pagination | Have >20 history items | Pagination controls work; pages load correctly |
| 12.8 | History filtering | Filter by status (completed/failed) | Only matching items shown |
| 12.9 | Empty state | No downloads | Helpful empty state message displayed |
| 12.10 | Download card — movie metadata | View completed movie download | Title, year, poster, file size, duration shown |
| 12.11 | Download card — TV metadata | View completed TV download | Show, season, episode, episode title shown |

---

### TS-13: Real-Time Progress UI

**Spec coverage:** Phase 7 (WebSocket events, store, `DownloadsPage.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 13.1 | Progress bar updates live | Start download; agent sends progress events | Progress bar animates from 0% to 100% |
| 13.2 | Download speed displayed | During active download | Speed shown in MB/s or KB/s |
| 13.3 | ETA displayed | During active download | Estimated time remaining shown and decreasing |
| 13.4 | Phase label updates | Download progresses through phases | Phase label changes (e.g., "Adding to RD" → "Downloading" → "Organizing") |
| 13.5 | Bytes downloaded counter | During download | Shows "X MB / Y MB" or similar |
| 13.6 | Multiple simultaneous downloads | Two active downloads | Both show independent progress bars |
| 13.7 | Progress survives page navigation | Start download; navigate away; navigate back | Progress still shown correctly on return |
| 13.8 | Completion notification | Download finishes | Toast notification appears with success message |
| 13.9 | Failure notification | Download fails | Toast notification appears with error message |
| 13.10 | Device status change notification | Agent goes offline | Toast or indicator update in real time |

---

### TS-14: Recently Viewed

**Spec coverage:** Phase 5 (recently-viewed routes, `SearchPage.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 14.1 | Viewing a title adds to recently viewed | Click on a movie from search results | `POST /api/recently-viewed` called; title appears in recently viewed |
| 14.2 | Recently viewed shown on search page | View a title; return to search | Recently viewed section shows the title |
| 14.3 | Recently viewed order | View multiple titles | Most recent appears first |
| 14.4 | Recently viewed limit (20) | View 21+ titles | Only 20 most recent shown; oldest evicted |
| 14.5 | Recently viewed per profile | Switch profiles | Each profile has independent recently viewed list |
| 14.6 | Click recently viewed opens details | Click a recently viewed item | Navigates to media detail view |
| 14.7 | Duplicate viewing updates timestamp | View same title twice | Title moves to top; no duplicate entry |

---

### TS-15: Settings Page

**Spec coverage:** Phase 7 (`SettingsPage.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 15.1 | Settings page loads | Navigate to `/settings` | Settings page renders with profile options |
| 15.2 | Change profile PIN | Set new 4-digit PIN; save | PIN updated; profile now requires PIN on selection |
| 15.3 | Remove profile PIN | Clear PIN; save | PIN protection removed |
| 15.4 | PIN validation | Enter non-numeric or <4 digit PIN | Validation error shown |

---

### TS-16: Admin Panel — API Keys

**Spec coverage:** Phase 2 (`AdminPanel.tsx`, settings routes)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 16.1 | View current API keys | Login as admin; view settings | TMDB and RD keys shown (masked/partial) |
| 16.2 | Update TMDB key | Enter new TMDB key; save | Key validated and saved; `PATCH /api/admin/settings` succeeds |
| 16.3 | Update RD key | Enter new RD key; save | Key validated and saved; encrypted in DB |
| 16.4 | Test TMDB key | Click "Test" button for TMDB key | Validation result shown (success or failure) |
| 16.5 | Test RD key | Click "Test" button for RD key | Validation result shown |
| 16.6 | Invalid key rejected on save | Enter invalid key; save | Error message; key not saved |
| 16.7 | Keys encrypted at rest | Inspect `instance_settings` table | Values encrypted (not plaintext) |
| 16.8 | Non-admin cannot access settings | Attempt `GET /api/admin/settings` as profile | 401/403 response |

---

### TS-17: Toast Notifications

**Spec coverage:** Phase 7 (`Toasts.tsx`, store)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 17.1 | Success toast appears | Complete an action (e.g., save settings) | Green success toast shown |
| 17.2 | Error toast appears | Trigger an error (e.g., bad API call) | Red error toast shown |
| 17.3 | Toast auto-dismisses | Trigger a toast; wait | Toast disappears after timeout |
| 17.4 | Toast manual dismiss | Click X on toast | Toast dismissed immediately |
| 17.5 | Multiple toasts stack | Trigger multiple actions quickly | Toasts stack vertically; each independent |
| 17.6 | Download complete toast | Complete a download | "Download complete: [Title]" toast appears |
| 17.7 | Download failed toast | Fail a download | "Download failed: [Title]" toast with error |
| 17.8 | Device online/offline toast | Agent connects/disconnects | Device status change toast shown |

---

### TS-18: Navigation & App Shell

**Spec coverage:** Phase 2, 7 (`AppShell.tsx`, `App.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 18.1 | Sidebar navigation renders | Select profile; enter app | Sidebar with links: Search, Downloads, Devices, Settings |
| 18.2 | Navigate to Search | Click Search link | `/search` page loads |
| 18.3 | Navigate to Downloads | Click Downloads link | `/downloads` page loads |
| 18.4 | Navigate to Devices | Click Devices link | `/devices` page loads |
| 18.5 | Navigate to Settings | Click Settings link | `/settings` page loads |
| 18.6 | Active link highlighted | Navigate to Downloads | Downloads link visually active/highlighted |
| 18.7 | Profile name/avatar shown | View app shell | Current profile name and avatar displayed |
| 18.8 | Switch profile link | Click profile name/avatar or switch link | Navigates back to profile picker |
| 18.9 | Connection status in shell | View app shell with WS connected | Green connection indicator visible |
| 18.10 | Mobile responsive layout | View on mobile viewport (iPhone 14) | Navigation adapts (hamburger menu or bottom nav) |

---

### TS-19: Auth Guards & Token Lifecycle

**Spec coverage:** Phase 2 (middleware, auth routes, `App.tsx`)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 19.1 | Unauthenticated user redirected | Visit `/search` without session | Redirected to `/profiles` or `/setup` |
| 19.2 | Admin routes require admin auth | Visit `/admin` without admin login | Redirected to `/admin/login` |
| 19.3 | Profile routes require profile session | Visit `/downloads` without profile selected | Redirected to `/profiles` |
| 19.4 | Access token auto-refresh | Wait for token near-expiry; make request | Token refreshed transparently; request succeeds |
| 19.5 | Expired refresh token → logout | Expire refresh token; make request | User redirected to profile picker or login |
| 19.6 | Admin token separate from profile token | Login as admin; select profile | Both sessions work independently |
| 19.7 | Device token auth for agent endpoints | Call `/api/agent/config` with device token | 200 response with config |
| 19.8 | Invalid token rejected | Send request with tampered JWT | 401 response |
| 19.9 | Logout revokes refresh token | Logout; attempt refresh | Refresh fails; must re-authenticate |

---

### TS-20: Error Handling & Edge Cases

**Spec coverage:** Phase 9 (testing & hardening)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 20.1 | API server unreachable | Stop relay; attempt search from web | Error message shown; no crash |
| 20.2 | TMDB API failure | Mock TMDB 500 response | Search shows error message gracefully |
| 20.3 | RD API failure | Mock RD API error during download | Download fails with meaningful error message |
| 20.4 | WebSocket disconnect during download | Kill WS mid-download | Download continues on agent; progress resumes on reconnect |
| 20.5 | Large search result set | Search for very common term | Results paginated or truncated; no UI freeze |
| 20.6 | Special characters in search | Search for `O'Brien & Co.` | Search works; no injection or crash |
| 20.7 | Special characters in profile name | Create profile with Unicode name | Profile created and displayed correctly |
| 20.8 | Concurrent profile creation | Race condition: two admins create same name | One succeeds, one gets duplicate error |
| 20.9 | Browser back/forward navigation | Use back/forward through search → details → streams | Navigation works correctly; state preserved |
| 20.10 | Page refresh preserves session | Refresh browser on downloads page | Session restored from stored token; page reloads correctly |
| 20.11 | Multiple browser tabs | Open two tabs as same profile | Both tabs show consistent data; WS events received in both |
| 20.12 | Network slow/timeout | Throttle network to 2G | Loading spinners shown; requests eventually succeed or show timeout error |

---

## 3. Helpers & Fixtures

### 3.1 Auth Fixture (`auth.fixture.ts`)

```ts
import { test as base } from "@playwright/test";

type AuthFixtures = {
  adminPage: Page;         // Page logged in as admin
  profilePage: Page;       // Page with profile selected
  setupComplete: void;     // Ensures setup wizard done
};

export const test = base.extend<AuthFixtures>({
  setupComplete: [async ({ request }, use) => {
    // POST /api/setup/complete with test credentials
    // Only if GET /api/setup/status returns needsSetup: true
    await use();
  }, { auto: true }],

  adminPage: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // POST /api/auth/login → store token
    await use(page);
    await ctx.close();
  },

  profilePage: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // POST /api/profiles/:id/select → store token
    // Connect WebSocket
    await use(page);
    await ctx.close();
  },
});
```

### 3.2 Database Fixture (`db.fixture.ts`)

```ts
// Reset DB state between tests or test groups
export async function resetDatabase() {
  // Truncate tables in dependency order
  // Re-run setup if needed
}

export async function seedProfiles(count: number) { /* ... */ }
export async function seedDevices(profileId: string, count: number) { /* ... */ }
export async function seedDownloadHistory(profileId: string, items: HistoryItem[]) { /* ... */ }
```

### 3.3 Mock Agent Fixture (`ws-mock.fixture.ts`)

```ts
import WebSocket from "ws";

// Simulates a paired agent for E2E tests
export class MockAgent {
  constructor(relayUrl: string, deviceToken: string) { /* ... */ }

  async connect(): Promise<void> { /* ... */ }
  async acceptDownload(id: string): Promise<void> { /* ... */ }
  async sendProgress(id: string, pct: number, speed: number): Promise<void> { /* ... */ }
  async completeDownload(id: string, filePath: string): Promise<void> { /* ... */ }
  async failDownload(id: string, error: string, retryable: boolean): Promise<void> { /* ... */ }
  async sendHeartbeat(): Promise<void> { /* ... */ }
  async disconnect(): Promise<void> { /* ... */ }
}
```

### 3.4 Selectors (`selectors.ts`)

```ts
// All selectors use data-testid for stability
export const SEL = {
  // Setup
  setupWizard:      '[data-testid="setup-wizard"]',
  setupStepAdmin:   '[data-testid="setup-step-admin"]',
  setupStepTmdb:    '[data-testid="setup-step-tmdb"]',
  setupStepRd:      '[data-testid="setup-step-rd"]',
  setupStepProfile: '[data-testid="setup-step-profile"]',

  // Auth
  loginForm:        '[data-testid="admin-login-form"]',
  usernameInput:    '[data-testid="username-input"]',
  passwordInput:    '[data-testid="password-input"]',

  // Profiles
  profileGrid:      '[data-testid="profile-grid"]',
  profileCard:      '[data-testid="profile-card"]',
  pinInput:         '[data-testid="pin-input"]',

  // Search
  searchBar:        '[data-testid="search-bar"]',
  resultsGrid:      '[data-testid="results-grid"]',
  resultCard:       '[data-testid="result-card"]',
  recentlyViewed:   '[data-testid="recently-viewed"]',

  // Streams
  streamPicker:     '[data-testid="stream-picker"]',
  streamRow:        '[data-testid="stream-row"]',
  filterResolution: '[data-testid="filter-resolution"]',
  filterHdr:        '[data-testid="filter-hdr"]',
  deviceSelector:   '[data-testid="device-selector"]',
  downloadBtn:      '[data-testid="download-btn"]',

  // Downloads
  activeDownloads:  '[data-testid="active-downloads"]',
  queuedDownloads:  '[data-testid="queued-downloads"]',
  downloadHistory:  '[data-testid="download-history"]',
  progressBar:      '[data-testid="progress-bar"]',
  cancelBtn:        '[data-testid="cancel-btn"]',

  // Devices
  deviceList:       '[data-testid="device-list"]',
  deviceCard:       '[data-testid="device-card"]',
  pairBtn:          '[data-testid="pair-device-btn"]',
  pairingCode:      '[data-testid="pairing-code"]',

  // Navigation
  sidebar:          '[data-testid="sidebar"]',
  navSearch:        '[data-testid="nav-search"]',
  navDownloads:     '[data-testid="nav-downloads"]',
  navDevices:       '[data-testid="nav-devices"]',
  navSettings:      '[data-testid="nav-settings"]',
  connectionStatus: '[data-testid="connection-status"]',

  // Toasts
  toast:            '[data-testid="toast"]',
  toastClose:       '[data-testid="toast-close"]',
} as const;
```

---

## 4. Mock Strategy

### 4.1 What to Mock

| Dependency | Mock Approach | Rationale |
|---|---|---|
| **TMDB API** | Playwright `route.fulfill()` intercepting `/api/search`, `/api/media/*` | Avoid rate limits; deterministic results |
| **Real-Debrid API** | Mock agent fixture simulates RD behavior | Agent handles RD calls; E2E tests mock the agent |
| **Torrentio/Comet** | Playwright route intercept on `/api/streams/*` | Return consistent stream fixtures |
| **Agent (download executor)** | `MockAgent` class via WebSocket | Full control over download lifecycle events |
| **Poster images** | Serve from local fixtures or allow proxy | Low priority; optional mock |
| **Time** | Use Playwright `page.clock` for TTL/expiry tests | Test code expiry, token expiry without waiting |

### 4.2 What NOT to Mock

| Component | Rationale |
|---|---|
| **PostgreSQL** | Use real test database for schema/query validation |
| **Relay server** | Test real HTTP + WS routing, middleware, auth |
| **Web application** | Test real React rendering, routing, state |
| **JWT auth flow** | Test real token signing, refresh, revocation |
| **WebSocket relay** | Test real message routing between mock agent and web |

---

## 5. CI Integration

### 5.1 GitHub Actions Workflow

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on:
  push:
    branches: [main]
  pull_request:

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: tadaima_test
        ports: ["5433:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      - run: pnpm install
      - run: pnpm build

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: Run E2E tests
        run: pnpm exec playwright test --project=chromium
        env:
          DATABASE_URL: postgres://test:test@localhost:5433/tadaima_test
          JWT_SECRET: test-secret-ci
          NODE_ENV: test

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
```

### 5.2 Test Ordering

Tests should run in this order (later suites depend on earlier state):

1. **TS-01** Setup Wizard → creates admin + first profile
2. **TS-02** Admin Auth → uses admin credentials
3. **TS-03** Profile Management → creates additional profiles
4. **TS-04** Profile Picker → selects profiles
5. **TS-05** Device Pairing → pairs test devices
6. **TS-06** Device Management → manages paired devices
7. **TS-07** WebSocket → tests connectivity
8. **TS-08** Search & Browse → searches TMDB
9. **TS-09** Stream Selection → picks streams
10. **TS-10** Download Pipeline → full download flow
11. **TS-11** Download Queue → offline queue
12. **TS-12** Downloads Page → views history
13. **TS-13** Real-Time Progress → progress UI
14. **TS-14** Recently Viewed → viewing history
15. **TS-15** Settings Page → profile settings
16. **TS-16** Admin API Keys → key management
17. **TS-17** Toast Notifications → notification system
18. **TS-18** App Shell → navigation
19. **TS-19** Auth Guards → auth enforcement
20. **TS-20** Error Handling → edge cases

---

## Coverage Summary

| Suite | Test Count | Spec Phases Covered |
|---|---|---|
| TS-01 Setup Wizard | 12 | 0, 2 |
| TS-02 Admin Auth | 8 | 2 |
| TS-03 Profile Management | 11 | 2 |
| TS-04 Profile Picker | 9 | 2 |
| TS-05 Device Pairing | 10 | 3 |
| TS-06 Device Management | 8 | 3 |
| TS-07 WebSocket | 10 | 4 |
| TS-08 Search & Browse | 12 | 5 |
| TS-09 Stream Selection | 14 | 5, 6 |
| TS-10 Download Pipeline | 11 | 6 |
| TS-11 Download Queue | 7 | 6 |
| TS-12 Downloads Page | 11 | 7 |
| TS-13 Real-Time Progress | 10 | 7 |
| TS-14 Recently Viewed | 7 | 5 |
| TS-15 Settings Page | 4 | 7 |
| TS-16 Admin API Keys | 8 | 2 |
| TS-17 Toast Notifications | 8 | 7 |
| TS-18 App Shell | 10 | 2, 7 |
| TS-19 Auth Guards | 9 | 2 |
| TS-20 Error Handling | 12 | 9 |
| **TOTAL** | **191** | **0–9** |

> Phases 10 (Distribution) and 11 (Public Release) are deployment/documentation concerns tested via CI pipeline validation and manual QA, not Playwright E2E.
