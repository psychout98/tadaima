# Tadaima Bugfix Spec Plan

> Generated 2026-04-06 — 74 issues found across 4 packages, E2E tests, CI workflows, and infrastructure.
> Intended audience: Claude Code (or any AI coding agent). Each task is self-contained with file paths, line references, and a concrete fix description.

---

## How to use this plan

Work through the sections in priority order (P0 → P3). Each issue has:

- **ID** — unique reference (e.g. `SEC-01`)
- **File(s)** — exact path(s) to edit
- **Lines** — approximate line numbers (may shift after earlier fixes)
- **Problem** — what's wrong
- **Fix** — what to do
- **Verify** — how to confirm the fix works

---

## P0 — Critical (fix immediately)

### SEC-01: Weak default credentials in docker-compose.prod.yml
- **File:** `docker-compose.prod.yml` (lines 5, 20)
- **Problem:** Production compose file hardcodes `POSTGRES_PASSWORD=tadaima` and `DATABASE_URL=postgres://tadaima:tadaima@postgres:5432/tadaima`. Anyone who reads the repo knows the production DB password.
- **Fix:** Replace hardcoded values with environment variable substitution: `POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}` and `DATABASE_URL=${DATABASE_URL:?Set DATABASE_URL}`. Add a comment referencing `.env` or secrets manager.
- **Verify:** `docker compose -f docker-compose.prod.yml config` should fail without env vars set.

### SEC-02: Weak default JWT_SECRET in packages/relay/.env.example
- **File:** `packages/relay/.env.example` (line 3)
- **Problem:** `JWT_SECRET=change-me-in-production` is a placeholder that could accidentally ship. The relay `start-relay.sh` script auto-generates `ENCRYPTION_MASTER_KEY` and prints it to stdout in production logs.
- **Fix:** In `packages/relay/src/index.ts` or `auth.ts`, add a startup check that refuses to start if `JWT_SECRET` equals the placeholder or is shorter than 32 chars. In `scripts/start-relay.sh`, write the generated key to a file (not stdout) or require it as an env var.
- **Verify:** Starting the relay with `JWT_SECRET=change-me-in-production` should exit with an error.

### SEC-03: Path traversal in static file serving
- **Files:** `packages/relay/src/index.ts` (line 79), `packages/relay/src/routes/proxy.ts` (line 167)
- **Problem:** `join(webDistPath, c.req.path)` doesn't validate the resolved path stays within `webDistPath`. A request like `/assets/../../../etc/passwd` could escape the directory.
- **Fix:** After joining, use `path.resolve()` and verify the result starts with `webDistPath`:
  ```typescript
  const resolved = path.resolve(webDistPath, filePath);
  if (!resolved.startsWith(path.resolve(webDistPath))) return c.notFound();
  ```
- **Verify:** Write a test that requests `GET /assets/../../.env` and confirms a 404.

### SEC-04: API keys passed as URL query parameters
- **Files:** `packages/relay/src/routes/settings.ts` (line 89), `packages/relay/src/routes/proxy.ts` (line 42)
- **Problem:** TMDB API keys are passed as `?api_key=...` query parameters, visible in logs, referrer headers, and browser history.
- **Fix:** If TMDB supports it, switch to `Authorization: Bearer` header. If not (TMDB v3 doesn't), at minimum ensure server-side proxy strips the key from any error responses/logs, and document the limitation.
- **Verify:** Grep codebase for `api_key=` in URL strings; confirm keys never appear in client-visible responses.

### AGENT-01: Memory leak — infinite interval in logger.ts
- **File:** `packages/agent/src/logger.ts` (lines 37–58)
- **Problem:** `followLog()` creates a `setInterval` every 500ms that is never cleared. Each tick opens a new `createReadStream` + `readline` interface without closing prior ones. Listeners and file handles accumulate indefinitely.
- **Fix:** Store the interval ID and clear it when `followLog` is called again or on shutdown. Close the previous readline interface before creating a new one. Better yet, replace the polling approach with a single `fs.watch` + tailing stream.
- **Verify:** Run the agent for 60s, check that the number of open file descriptors stays constant (`lsof -p <pid> | wc -l`).

### RELAY-01: Race condition in device pairing (bypasses MAX_DEVICES limit)
- **File:** `packages/relay/src/routes/devices.ts` (lines 162–226)
- **Problem:** Between checking the device count (line 192) and inserting a new device (line 213), another concurrent request can also pass the check, exceeding `MAX_DEVICES_PER_PROFILE`.
- **Fix:** Wrap the count check + insert in a database transaction with a row-level lock or use `INSERT ... SELECT ... WHERE (SELECT count(*) ...) < MAX`.
- **Verify:** Write a test that sends 10 concurrent pairing requests for a profile with limit 5; confirm only 5 succeed.

### WEB-01: Unsafe type casting in WebSocket message handling
- **File:** `packages/web/src/pages/AppShell.tsx` (lines 34–83)
- **Problem:** Incoming WebSocket messages are cast with `as` to specific types without runtime validation. Missing or malformed payload fields cause silent bugs or runtime crashes (e.g. `payload.title as string` when title is undefined).
- **Fix:** Validate incoming messages against the shared `messageSchema` from `@tadaima/shared` before processing. Reject or log messages that don't match.
- **Verify:** Send a malformed WebSocket message in a test; confirm the app doesn't crash and logs a warning.

---

## P1 — High (fix this sprint)

### AGENT-02: Incorrect exponential backoff in ws-client.ts
- **File:** `packages/agent/src/ws-client.ts` (lines 153–160)
- **Problem:** Backoff delay is incremented *after* `setTimeout` is scheduled, so the first reconnection uses the old value. The timing is off by one step.
- **Fix:** Increment backoff *before* passing it to `setTimeout`:
  ```typescript
  this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  setTimeout(() => this.connect(), this.backoff);
  ```
- **Verify:** Add a unit test that mocks timers and asserts the delays are 1s, 2s, 4s, 8s...

### AGENT-03: Unsafe type casts on message payloads in download-handler.ts
- **File:** `packages/agent/src/download-handler.ts` (lines 45–70)
- **Problem:** Multiple `as` casts on `msg.id`, `msg.payload` fields with no runtime checks. Malformed messages silently create incorrect objects.
- **Fix:** Use Zod or the shared message schema to validate before casting. Return early with an error log if validation fails.
- **Verify:** Unit test with a message missing required fields; confirm it's rejected gracefully.

### AGENT-04: parseInt returns NaN without validation in daemon.ts
- **File:** `packages/agent/src/daemon.ts` (lines 29, 68, 87)
- **Problem:** `parseInt()` on PID file contents returns NaN if the file is corrupt. `process.kill(NaN, ...)` silently fails.
- **Fix:** After `parseInt`, check `Number.isNaN(pid)` and throw a descriptive error or log + delete the stale PID file.
- **Verify:** Write a PID file with `"not-a-number"`, call the daemon check, confirm it handles it gracefully.

### AGENT-05: Download completeness not verified in downloader.ts
- **File:** `packages/agent/src/downloader.ts` (lines 29, 75)
- **Problem:** Returns `downloadedBytes` without comparing to `totalBytes`. Truncated downloads succeed silently.
- **Fix:** After download loop, compare `downloadedBytes` to `totalBytes`. If they don't match (and totalBytes is known), throw an error or return a failure status.
- **Verify:** Mock a download that returns fewer bytes than Content-Length; confirm it throws.

### AGENT-06: Silent JSON parse errors in ws-client.ts
- **File:** `packages/agent/src/ws-client.ts` (lines 47–55)
- **Problem:** Empty `catch` block swallows JSON parse errors on incoming WebSocket messages.
- **Fix:** Log the error and the raw message data (truncated to prevent log flooding).
- **Verify:** Send invalid JSON over the WebSocket; confirm it's logged.

### AGENT-07: Race condition in message queue drain
- **File:** `packages/agent/src/ws-client.ts` (lines 84–91, 139–143)
- **Problem:** `drainQueue()` checks `readyState === OPEN` but the connection can close between the check and `send()`. Messages are lost silently.
- **Fix:** Wrap `send()` in a try-catch. On failure, re-queue the message and schedule a reconnect.
- **Verify:** Mock a WebSocket that closes mid-drain; confirm messages are re-queued.

### AGENT-08: TUI cursor not restored on exit
- **File:** `packages/agent/src/tui.ts` (lines 46–51)
- **Problem:** `stop()` method hides the cursor (`\x1b[?25l`) instead of showing it. Should be `\x1b[?25h`.
- **Fix:** Change line 49 from `\x1b[?25l` to `\x1b[?25h`.
- **Verify:** Run the TUI, press Ctrl+C, confirm cursor is visible.

### RELAY-02: Unhandled promise rejections in ws/pool.ts
- **File:** `packages/relay/src/ws/pool.ts` (lines 46–49, 57–60, 136–139)
- **Problem:** Database update calls in `addAgent()`, `removeAgent()`, `handleHeartbeat()` are fire-and-forget with no `.catch()`. DB errors are silently lost, leaving device status out of sync.
- **Fix:** Add `.catch(err => logger.error("pool db update failed", err))` to each, or await them properly.
- **Verify:** Mock a DB failure in `addAgent()`; confirm it's logged.

### RELAY-03: Unclosed DB connection on migration failure
- **File:** `packages/relay/src/migrate.ts` (line 43)
- **Problem:** If `migrate()` throws, `client.end()` is never called, leaking the connection.
- **Fix:** Wrap in `try-finally`:
  ```typescript
  try { await migrate(db, ...); }
  finally { await client.end(); }
  ```
- **Verify:** Force a migration error; confirm the connection is closed.

### RELAY-04: Pervasive unsafe `(c as any).get("token")` pattern
- **Files:** `packages/relay/src/routes/downloads.ts` (lines 14, 44, 67, 124), `packages/relay/src/routes/recently-viewed.ts` (lines 12, 38)
- **Problem:** Token is retrieved via `(c as any).get("token")`, bypassing type safety.
- **Fix:** Extend Hono's context type to include `token`:
  ```typescript
  type Env = { Variables: { token: string } };
  const app = new Hono<Env>();
  ```
  Then use `c.get("token")` without casting.
- **Verify:** Remove all `as any` casts; confirm TypeScript compiles cleanly.

### WEB-02: Stale WebSocket token causes infinite reconnection loop
- **File:** `packages/web/src/lib/ws-client.ts` (lines 22–119)
- **Problem:** `connect()` stores the token as `this.token`. If the token expires and is refreshed elsewhere, the WebSocket reconnects with the stale token forever.
- **Fix:** Accept a token-getter function (`() => string`) instead of a static token. Call it on each reconnection attempt.
- **Verify:** Simulate token expiry; confirm the WebSocket uses the refreshed token on reconnect.

### WEB-03: Memory leak from WebSocket listeners on re-mount
- **File:** `packages/web/src/lib/ws-client.ts` (lines 78–90), `packages/web/src/pages/AppShell.tsx` (lines 32–33)
- **Problem:** If AppShell unmounts and remounts while the WebSocket is connecting, multiple listeners accumulate and are never cleaned up.
- **Fix:** In the useEffect cleanup, call the unsubscribe functions and also call `ws.disconnect()` or guard against stale listeners.
- **Verify:** Mount/unmount AppShell 10 times; confirm listener count stays constant.

### WEB-04: Race condition — setState on unmounted StreamPicker
- **File:** `packages/web/src/components/StreamPicker.tsx` (lines 107–123)
- **Problem:** Async API calls in useEffect don't check if the component is still mounted before calling `setStreams()`, `setLoading()`.
- **Fix:** Use an `isMounted` ref or AbortController pattern:
  ```typescript
  useEffect(() => {
    let cancelled = false;
    fetchStreams().then(data => { if (!cancelled) setStreams(data); });
    return () => { cancelled = true; };
  }, [deps]);
  ```
- **Verify:** Unmount StreamPicker during a pending API call; confirm no React warning.

### WEB-05: Stale closure in DownloadsPage polling interval
- **File:** `packages/web/src/pages/DownloadsPage.tsx` (lines 104–107)
- **Problem:** `setInterval` captures `loadData` in a closure. When `profileToken` changes, the interval keeps calling the old `loadData`.
- **Fix:** Use a ref to hold the latest `loadData`, or clear/re-create the interval when deps change.
- **Verify:** Switch profiles while on DownloadsPage; confirm it loads the new profile's data.

### WEB-06: Missing error handling in API request()
- **File:** `packages/web/src/lib/api.ts` (lines 17–24)
- **Problem:** `res.json()` on line 24 (success path) has no `.catch()`. If the server returns 200 with non-JSON body, this throws an unhandled rejection.
- **Fix:** Wrap in try-catch or use the same `.catch(() => fallback)` pattern used on the error path.
- **Verify:** Mock an API that returns 200 with HTML body; confirm it doesn't crash.

---

## P2 — Medium (fix soon)

### AGENT-09: Missing path traversal validation in downloader/organizer
- **Files:** `packages/agent/src/downloader.ts`, `packages/agent/src/organizer.ts`
- **Problem:** Paths from external sources (download URLs) are joined without checking for `../` sequences that could escape the staging directory.
- **Fix:** After `path.join()`, resolve and verify the result is within the expected base directory.
- **Verify:** Test with a filename containing `../../etc/passwd`; confirm it's rejected.

### AGENT-10: No validation of user input in setup.ts
- **File:** `packages/agent/src/setup.ts` (lines 79–91)
- **Problem:** Empty strings are accepted for directory paths and saved to config.
- **Fix:** Validate that directory inputs are non-empty and are valid paths. Reject or use defaults.
- **Verify:** Enter an empty string for staging dir; confirm default is used.

### AGENT-11: Missing null check in organizer.ts
- **File:** `packages/agent/src/organizer.ts` (lines 21–22)
- **Problem:** `extname()` on `req.sourcePath` could fail if sourcePath is empty or malformed.
- **Fix:** Validate `sourcePath` is non-empty before processing. Return an error for invalid paths.
- **Verify:** Call organizer with `sourcePath: ""`; confirm graceful error.

### AGENT-12: Silent cache check failure in download-handler.ts
- **File:** `packages/agent/src/download-handler.ts` (lines 112–123)
- **Problem:** `handleCacheCheck()` catches errors and returns empty cache but never logs the error.
- **Fix:** Add `logger.warn("Cache check failed", err)` in the catch block.
- **Verify:** Force a cache error; confirm it appears in logs.

### RELAY-05: Inefficient recently-viewed cleanup loop
- **File:** `packages/relay/src/routes/recently-viewed.ts` (lines 84–89)
- **Problem:** Deletes excess items one-by-one in a loop instead of a single bulk DELETE query.
- **Fix:** Use a single `DELETE FROM ... WHERE id NOT IN (...)` or `DELETE ... WHERE rowid > limit`.
- **Verify:** Add 50 recently-viewed items with a limit of 20; confirm cleanup runs one query.

### RELAY-06: Missing error distinction in static file serving
- **File:** `packages/relay/src/index.ts` (lines 78–98)
- **Problem:** `readFileSync()` catch returns 404 for all errors, including permission errors. Misleading.
- **Fix:** Check `err.code` — return 404 for `ENOENT`, 500 for others.
- **Verify:** Make a file unreadable; confirm 500 is returned.

### RELAY-07: Empty catch blocks across multiple files
- **Files:** `packages/relay/src/index.ts:96`, `packages/relay/src/routes/proxy.ts:62,114,159,189`, `packages/relay/src/ws/handler.ts:162,264`
- **Problem:** Silent error swallowing makes debugging impossible.
- **Fix:** Add `logger.error()` or `console.error()` in each catch block with context about what failed.
- **Verify:** Grep for empty catch blocks; confirm none remain.

### WEB-07: Download message structure doesn't match shared schema
- **File:** `packages/web/src/components/StreamPicker.tsx` (lines 364–384)
- **Problem:** Payload includes `episodeTitle: undefined` (should be omitted) and `targetDeviceId` which isn't in the shared schema.
- **Fix:** Align message construction with `downloadRequestPayloadSchema`. Use `...(episodeTitle && { episodeTitle })` to conditionally include fields.
- **Verify:** TypeScript compile with strict mode; confirm no type errors.

### WEB-08: No error handling in AdminPanel async operations
- **File:** `packages/web/src/pages/AdminPanel.tsx` (lines 52–90)
- **Problem:** `loadData()`, `handleAddProfile`, `handleDeleteProfile`, `handleSaveSettings` have no error handling. Failed API calls leave UI in inconsistent state.
- **Fix:** Add try-catch with toast notifications for errors, and loading states.
- **Verify:** Mock a failed API call; confirm a toast is shown and UI remains consistent.

### WEB-09: Missing useCallback dependency in SearchPage
- **File:** `packages/web/src/pages/SearchPage.tsx` (lines 33–45)
- **Problem:** `loadRecent` depends on `profileToken` but isn't re-invoked when the token changes.
- **Fix:** Add `profileToken` to the useEffect dependency array that calls `loadRecent`.
- **Verify:** Switch profiles on SearchPage; confirm recently-viewed updates.

### INFRA-01: Missing security headers
- **Files:** `packages/relay/src/index.ts`, `packages/relay/src/middleware.ts`
- **Problem:** No CSP, X-Frame-Options, HSTS, or other security headers configured.
- **Fix:** Add a security headers middleware (or use a library like `helmet` adapted for Hono) that sets: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`.
- **Verify:** Curl the app and check response headers.

### INFRA-02: Auto-generated ENCRYPTION_MASTER_KEY printed to stdout
- **File:** `scripts/start-relay.sh` (lines 5–9)
- **Problem:** If `ENCRYPTION_MASTER_KEY` is not set, the script generates one and prints it to stdout, which appears in Docker logs.
- **Fix:** Write to a file (`/run/secrets/encryption_key`) or require it as an env var and refuse to start without it.
- **Verify:** Start relay without the key; confirm it exits with an error rather than printing a key.

---

## P3 — Low (backlog / cleanup)

### AGENT-13: Dead code — getActiveJobs() in tui.ts
- **File:** `packages/agent/src/tui.ts` (lines 106–116)
- **Problem:** `getActiveJobs()` always returns `[]` with a TODO comment. Dead code.
- **Fix:** Implement it or remove it and the rendering code that depends on it.
- **Verify:** Grep for `getActiveJobs`; confirm it's either implemented or gone.

### AGENT-14: Unused monkey-patch wrapper in index.ts
- **File:** `packages/agent/src/index.ts` (lines 53–56)
- **Problem:** `origConnect` wrapper is defined but never modifies behavior. Dead code.
- **Fix:** Remove it or implement the intended behavior.
- **Verify:** Confirm no references to `origConnect` remain.

### AGENT-15: `as never` type bypasses in index.ts
- **File:** `packages/agent/src/index.ts` (lines 108, 116)
- **Problem:** `as never` casts bypass type checking for config get/set, hiding real type errors.
- **Fix:** Properly type the config store or use a generic accessor.
- **Verify:** Remove `as never`; fix any resulting type errors.

### RELAY-08: Missing explicit crypto import
- **File:** `packages/relay/src/routes/devices.ts` (line 208)
- **Problem:** Uses `crypto.randomUUID()` from the global, which requires Node 15+. Not explicitly imported.
- **Fix:** Add `import { randomUUID } from "node:crypto"` at the top.
- **Verify:** TypeScript compiles cleanly; works on target Node version.

### RELAY-09: parseInt without fallback validation
- **File:** `packages/relay/src/routes/downloads.ts` (line 69)
- **Problem:** `parseInt(c.req.query("limit") ?? "50")` could produce NaN from empty string.
- **Fix:** `const limit = Math.min(parseInt(c.req.query("limit") || "50", 10) || 50, 100);`
- **Verify:** Request `/downloads?limit=abc`; confirm default 50 is used.

### WEB-10: Toast ID collision potential
- **File:** `packages/web/src/lib/store.ts` (line 120)
- **Problem:** Toast IDs use `Date.now()` which can collide if two toasts fire in the same millisecond.
- **Fix:** Use a counter or `crypto.randomUUID()`.
- **Verify:** Add two toasts simultaneously; confirm both appear.

### WEB-11: No user feedback on ProfilePicker errors
- **File:** `packages/web/src/pages/ProfilePicker.tsx` (lines 41–43)
- **Problem:** Errors are `console.error()`'d but the user sees nothing.
- **Fix:** Show a toast on error.
- **Verify:** Mock a failed profile select; confirm toast appears.

### INFRA-03: Hardcoded dev credentials in docker-compose.yml
- **File:** `docker-compose.yml` (line 8)
- **Problem:** `POSTGRES_PASSWORD: tadaima` is weak. Fine for local dev but could leak into prod workflows.
- **Fix:** Use env var substitution with a sensible default: `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-tadaima}`.
- **Verify:** `docker compose config` shows the variable.

### INFRA-04: Adminer exposed without auth in docker-compose.yml
- **File:** `docker-compose.yml` (lines 13–17)
- **Problem:** Database admin UI on port 8080 with no access restrictions.
- **Fix:** Add a comment that this is dev-only. Optionally bind to `127.0.0.1:8080` to prevent LAN access.
- **Verify:** Confirm `ports: ["127.0.0.1:8080:8080"]` in compose.

### INFRA-05: Playwright workers set to 1
- **File:** `playwright.config.ts` (line 8)
- **Problem:** `workers: 1` means sequential test execution, slow CI feedback.
- **Fix:** Set `workers: process.env.CI ? 2 : undefined` to parallelize in CI while defaulting to auto locally.
- **Verify:** Run e2e in CI; confirm parallel execution.

---

## E2E Tests — Flakiness & Correctness

### E2E-01: Missing `--frozen-lockfile` in e2e.yml (CRITICAL)
- **File:** `.github/workflows/e2e.yml` (line 34)
- **Problem:** Uses `pnpm install` without `--frozen-lockfile`, while `ci.yml` and `release.yml` both use it. E2E tests can silently run against different dependency versions than CI.
- **Fix:** Change to `pnpm install --frozen-lockfile`.
- **Verify:** Modify pnpm-lock.yaml slightly; confirm e2e workflow fails.

### E2E-02: Missing pnpm version pin in e2e.yml (HIGH)
- **File:** `.github/workflows/e2e.yml` (lines 28–32)
- **Problem:** `pnpm/action-setup@v4` has no `version` parameter. `ci.yml` and `release.yml` both pin `9.15.0`. The e2e workflow may use a different pnpm version.
- **Fix:** Add `with: version: 9.15.0` matching other workflows.
- **Verify:** Confirm `pnpm --version` output in e2e logs matches `9.15.0`.

### E2E-03: Tautological assertion — always passes (HIGH)
- **File:** `e2e/device-management.spec.ts` (line 125)
- **Problem:** Test "6.8 — default device indicator in UI" asserts `expect(typeof hasDefault).toBe("boolean")` which is always true. Doesn't test actual functionality.
- **Fix:** Assert `expect(hasDefault).toBe(true)` or check that the "Default" badge is visible on the correct device.
- **Verify:** Break the default-device feature; confirm this test now fails.

### E2E-04: Silent error swallowing with `.catch(() => false)` (HIGH)
- **Files:** `e2e/realtime-progress.spec.ts` (line 60), `e2e/recently-viewed.spec.ts` (line 65)
- **Problem:** Tests use `.catch(() => false)` on element visibility checks. If the element never appears, the test passes anyway — a false positive.
- **Fix:** Remove the `.catch()` and let the assertion fail properly. If the element is optional, use `expect.soft()` or a conditional assertion with a clear skip reason.
- **Verify:** Comment out the toast/element rendering; confirm the test now fails.

### E2E-05: `waitForTimeout()` instead of condition-based waits (HIGH)
- **Files:** `e2e/downloads-page.spec.ts` (lines 14, 20, 26, 34, 38), `e2e/download-queue.spec.ts` (line 34), `e2e/recently-viewed.spec.ts` (line 82)
- **Problem:** Arbitrary `waitForTimeout(500–1000)` calls instead of waiting for actual DOM conditions. These are the #1 source of flaky tests.
- **Fix:** Replace every `waitForTimeout()` with a `waitForSelector()`, `waitForResponse()`, or `expect(locator).toBeVisible()` targeting the actual UI state.
- **Verify:** Set `workers: 2` temporarily; run tests 3 times; confirm no flakes.

### E2E-06: Shared `test.beforeAll()` state causes test pollution (HIGH)
- **Files:** `e2e/download-pipeline.spec.ts` (line 10), `e2e/realtime-progress.spec.ts` (line 9), `e2e/toasts.spec.ts` (line 9), `e2e/websocket.spec.ts` (line 9)
- **Problem:** Multiple spec files use `test.beforeAll()` to set shared `deviceToken`/`profileToken`. If any test corrupts this state (e.g. disconnects the WebSocket), all subsequent tests in the file fail. This also prevents parallel execution.
- **Fix:** Move setup into fixtures or `test.beforeEach()` so each test gets isolated tokens and connections.
- **Verify:** Run each file's tests in reverse order; confirm they still pass.

### E2E-07: Setup wizard test is not idempotent (HIGH)
- **File:** `e2e/setup-wizard.spec.ts` (lines 7–12)
- **Problem:** Test assumes the app needs setup (`needsSetup: true`), which is only true on first run. Subsequent runs fail silently or skip.
- **Fix:** Add a beforeAll that resets the setup state (e.g. truncates the settings table) or mock the setup-needed API response.
- **Verify:** Run the test twice consecutively; confirm both runs pass.

### E2E-08: Fragile loading indicator check in wait-helpers.ts (MEDIUM)
- **File:** `e2e/helpers/wait-helpers.ts` (lines 25–28)
- **Problem:** `waitForLoaded()` checks `document.body.textContent?.includes("Loading...")` — brittle, breaks if the loading text changes.
- **Fix:** Add a `data-testid="loading-indicator"` to the loading component and wait for it to disappear: `await page.waitForSelector('[data-testid="loading-indicator"]', { state: 'detached' })`.
- **Verify:** Change the loading text; confirm tests still pass.

### E2E-09: No actual cleanup in global-teardown.ts (MEDIUM)
- **File:** `e2e/global-teardown.ts`
- **Problem:** Teardown only logs a message. No database reset, no file cleanup, no WebSocket cleanup. Test data accumulates across runs.
- **Fix:** Add database truncation (or use a test-specific schema) and clean up any temporary files.
- **Verify:** Run full suite twice; confirm the second run has a clean starting state.

### E2E-10: Fragile selectors — placeholder text and CSS classes (MEDIUM)
- **Files:** `e2e/setup-wizard.spec.ts` (lines 55, 75, 104, 107), `e2e/app-shell.spec.ts` (line 45), `e2e/stream-selection.spec.ts` (lines 84, 142)
- **Problem:** Tests select elements by placeholder text (`input[placeholder*="Profile name"]`) and assert CSS classes (`bg-zinc-800|font-medium`). These break when UI text or styling changes.
- **Fix:** Add `data-testid` attributes to key interactive elements in the web app. Update selectors to use `page.getByTestId()`.
- **Verify:** Change a placeholder string; confirm the e2e test still passes via testid.

### E2E-11: Test doesn't verify download request was received (MEDIUM)
- **File:** `e2e/download-pipeline.spec.ts` (lines 61–65)
- **Problem:** Test "10.1 — agent receives download request" triggers a custom event but has no assertion that the agent actually received or queued it.
- **Fix:** Add an assertion that waits for a confirmation message (WebSocket ack or a UI status change).
- **Verify:** Break the download handler; confirm this test fails.

### E2E-12: Fixtures don't clean up created test data (MEDIUM)
- **File:** `e2e/fixtures/auth.fixture.ts`
- **Problem:** Fixtures create profiles and devices but never delete them. Test data accumulates across runs, causing count-dependent tests to fail.
- **Fix:** Add fixture teardown that deletes any profiles/devices created during the test.
- **Verify:** Run suite, check DB row counts, run again, confirm counts are the same.

### E2E-13: Missing `networkidle` wait after admin login (MEDIUM)
- **File:** `e2e/fixtures/auth.fixture.ts` (line 93)
- **Problem:** `adminPage` fixture creates a context and logs in but doesn't wait for `networkidle` after reload. Page may not be fully ready.
- **Fix:** Add `await page.waitForLoadState("networkidle")` after the reload step.
- **Verify:** Run admin tests on a slow CI runner; confirm no flakes.

### E2E-14: WebSocket leak on test failure (MEDIUM)
- **File:** `e2e/websocket.spec.ts` (lines 195–209)
- **Problem:** WebSocket is created in-test but if the test fails, cleanup relies on timeout rather than guaranteed teardown.
- **Fix:** Wrap in `try-finally` or use a fixture that auto-closes the WebSocket.
- **Verify:** Force a test failure; confirm WebSocket is closed in the Playwright trace.

---

## CI/CD Workflows

### CI-01: Missing release tag validation (HIGH)
- **File:** `.github/workflows/release.yml` (lines 1–6)
- **Problem:** Triggers on any `v*` tag with no validation that it's a proper semver tag. Typos like `v1.0.z` or `v01.0.0` will trigger Docker builds and GitHub releases with bad tags.
- **Fix:** Add a validation step after checkout:
  ```yaml
  - name: Validate release tag
    run: |
      TAG=${{ github.ref_name }}
      if ! [[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Invalid tag format: $TAG. Expected vX.Y.Z" && exit 1
      fi
  ```
- **Verify:** Push a tag `vtest`; confirm the workflow fails at validation.

### CI-02: No concurrency control on release workflow (MEDIUM)
- **File:** `.github/workflows/release.yml` (lines 1–11)
- **Problem:** Simultaneously pushed tags trigger parallel release workflows that can race on Docker registry updates and GitHub releases.
- **Fix:** Add `concurrency: { group: release, cancel-in-progress: false }`.
- **Verify:** Push two tags quickly; confirm one waits for the other.

### CI-03: Changelog sort uses string ordering, not semver (MEDIUM)
- **File:** `.github/workflows/release.yml` (lines 93–103)
- **Problem:** `git tag --sort=-v:refname` sorts lexicographically, not by semver. `v1.10.0` sorts before `v1.9.0`.
- **Fix:** Use `--sort=-version:refname` (Git 2.18+) and remove the `head -50` truncation.
- **Verify:** Create tags v1.9.0 and v1.10.0; confirm changelog shows the correct diff.

### CI-04: No test result annotations in e2e workflow (MEDIUM)
- **File:** `.github/workflows/e2e.yml` (lines 48–53)
- **Problem:** Playwright report is uploaded as an artifact but test results aren't published as GitHub check annotations. Developers must download the artifact to see failures.
- **Fix:** Add `dorny/test-reporter@v1` or Playwright's built-in JUnit reporter + GitHub annotation step.
- **Verify:** Fail a test; confirm the failure appears inline in the PR checks.

### CI-05: No coverage uploads in ci.yml (MEDIUM)
- **File:** `.github/workflows/ci.yml`
- **Problem:** Tests run but coverage is never captured or reported. No way to track coverage trends or enforce thresholds.
- **Fix:** Add `-- --coverage` to the test command and upload via `codecov/codecov-action@v4` or similar.
- **Verify:** Check that coverage report appears on the PR.

### CI-06: Missing job timeouts (LOW)
- **Files:** `.github/workflows/ci.yml`, `.github/workflows/e2e.yml`
- **Problem:** No `timeout-minutes` specified. Stuck jobs run for up to 6 hours (GitHub default).
- **Fix:** Add `timeout-minutes: 15` to ci jobs and `timeout-minutes: 20` to e2e jobs.
- **Verify:** Confirm timeout appears in workflow run summary.

### CI-07: Missing explicit permissions in ci.yml and e2e.yml (LOW)
- **Files:** `.github/workflows/ci.yml`, `.github/workflows/e2e.yml`
- **Problem:** No `permissions` block. Only `release.yml` specifies permissions. Security best practice is to use least-privilege.
- **Fix:** Add `permissions: { contents: read }` to both workflows.
- **Verify:** Confirm workflows still pass with restricted permissions.

### CI-08: E2E database health check gap (LOW)
- **File:** `.github/workflows/e2e.yml` (lines 19, 43)
- **Problem:** PostgreSQL service container starts on port 5433 but there's no explicit wait-for-ready step before tests run. The service health check may not be sufficient under load.
- **Fix:** Add an explicit readiness check:
  ```yaml
  - name: Wait for PostgreSQL
    run: timeout 30 bash -c 'until pg_isready -h localhost -p 5433 -U test; do sleep 1; done'
  ```
- **Verify:** Run e2e workflow; confirm DB is confirmed ready in logs before tests start.

---

## Updated Summary

| Priority | Count | Focus |
|----------|-------|-------|
| P0 Critical | 8 | Security, memory leak, race condition, type safety, CI determinism |
| P1 High | 21 | Error handling, reconnection bugs, type safety, resource leaks, flaky tests, CI safety |
| P2 Medium | 19 | Validation, headers, schema alignment, test robustness, CI observability |
| P3 Low | 13 | Dead code, dev config, UX polish, CI hardening |
| **Total** | **61** | |

### Suggested execution order

1. **Security sweep (P0):** SEC-01 through SEC-04 — protect production data
2. **CI determinism (P0):** E2E-01 — ensures tests are reproducible
3. **Stability fixes (P0):** AGENT-01, RELAY-01, WEB-01 — prevent crashes/data corruption
4. **Resilience (P1):** Work through agent → relay → web in order
5. **Test reliability (P1):** E2E-03 through E2E-07 — fix false positives and flaky tests
6. **CI safety (P1):** CI-01 — prevent bad releases
7. **Quality (P2–P3):** Batch remaining items by package
