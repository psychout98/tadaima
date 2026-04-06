# E2E Test Fix Plan

> All e2e tests currently fail both locally and in CI. This plan identifies every root cause and provides a fix specification for each. Issues are ordered by cascade impact — fix them top-to-bottom, since later tests can't pass until earlier blockers are resolved.

---

## How to use this plan

Work through the tiers in order. **Tier 1** issues block *all* tests. **Tier 2** issues block entire spec files. **Tier 3** issues cause individual test failures. Each item is self-contained with file paths, the problem, and a concrete fix.

---

## Tier 1 — Blockers that fail ALL tests

These must be fixed first. If any of these are broken, every single test fails.

### T1-01: `globalSetup` redundancy + missing env vars for webServer

**Files:** `playwright.config.ts`, `e2e/global-setup.ts`, `packages/relay/src/db.ts`

**Problem:** The `webServer.command` is `pnpm dev:e2e`, which expands to:
```
turbo build --filter=@tadaima/web && turbo dev --filter=@tadaima/relay
```

This starts the relay via `tsx watch --require dotenv/config src/index.ts`. The relay's `db.ts` module (line 6) throws **at import time** if `DATABASE_URL` is unset:
```typescript
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}
```

**Locally**, the `--require dotenv/config` flag loads `packages/relay/.env`, which currently has `DATABASE_URL` pointing to a Railway production instance — NOT a local test database. Developers must also have a running Postgres instance. If `.env` is missing or Postgres is unreachable, the relay crashes immediately and Playwright times out after 60 seconds.

**In CI**, the e2e workflow sets env vars on the test step. Playwright's `webServer` spawns `pnpm dev:e2e` as a child process which inherits these vars, so `DATABASE_URL` is set. This path works IF the env is correct.

Meanwhile, `globalSetup` polls `API_URL/health` in a retry loop for 30 seconds. This is redundant — Playwright's `webServer.url` already does the same check. The globalSetup should instead reset the DB for a clean test run.

**Fix:**
1. In `playwright.config.ts`, explicitly pass env vars to the webServer so it doesn't depend on `.env` file contents:
   ```typescript
   webServer: {
     command: "pnpm dev:e2e",
     url: "http://localhost:3000/api/health",
     reuseExistingServer: !process.env.CI,
     timeout: 60_000,
     env: {
       ...process.env,
       NODE_ENV: process.env.NODE_ENV ?? "test",
       PORT: "3000",
     },
   },
   ```
2. Simplify `globalSetup` — remove the 30-retry health check loop (Playwright already handles this). Replace with a DB reset for a clean run:
   ```typescript
   async function globalSetup() {
     // Server is already running (Playwright webServer guarantees this).
     // Reset test state for a clean run.
     const res = await fetch(`${API_URL}/setup/reset`, { method: "POST" });
     if (!res.ok) {
       console.warn("Setup reset failed (may be first run):", res.status);
     }
   }
   ```
3. Create a `.env.test` file (gitignored) or add setup instructions to README so developers know to run Postgres locally and set the correct `DATABASE_URL` for tests.

**Verify:** Run `pnpm test:e2e` locally with Postgres running and correct env. Confirm globalSetup completes in < 2 seconds, not 30.

---

### T1-02: `ENCRYPTION_MASTER_KEY` missing — setup fixture crashes silently

**Files:** `packages/relay/src/crypto.ts` (lines 7–16), `packages/relay/.env`, `packages/relay/.env.example`, `.github/workflows/e2e.yml`

**Problem:** The relay's `crypto.ts` has a `getKey()` function that reads `process.env.ENCRYPTION_MASTER_KEY` and throws if unset. Unlike `DATABASE_URL` (which crashes at module load), this is **lazy** — it only throws when `encrypt()` or `decrypt()` is actually called.

The call chain is: `setupComplete` fixture → `POST /api/setup/complete` → `encrypt(rdApiKey)` (setup.ts line 49) → `getKey()` throws → 500 error → fixture fails → **every test using `profilePage` or `adminPage` fails**.

Neither `packages/relay/.env` nor `.env.example` include `ENCRYPTION_MASTER_KEY`. The `start-relay.sh` script now refuses to start without it (per recent bugfix), but `dev:e2e` uses `tsx watch` which bypasses that script entirely. The CI workflow's env block also omits it.

**Fix:** In `packages/relay/src/crypto.ts`, add a fallback for test/dev environments:
```typescript
const key = process.env.ENCRYPTION_MASTER_KEY
  ?? (process.env.NODE_ENV !== "production"
    ? "0".repeat(64) // deterministic test key
    : undefined);

if (!key) {
  throw new Error("ENCRYPTION_MASTER_KEY is required in production");
}
```

Also add `ENCRYPTION_MASTER_KEY` to the e2e workflow env vars in `.github/workflows/e2e.yml`:
```yaml
env:
  DATABASE_URL: postgres://test:test@localhost:5433/tadaima_test
  JWT_SECRET: test-secret-ci
  ENCRYPTION_MASTER_KEY: "0000000000000000000000000000000000000000000000000000000000000000"
  NODE_ENV: test
  PORT: 3000
```

**Verify:** Start the relay in test mode without `ENCRYPTION_MASTER_KEY` set; confirm it starts and `/api/setup/complete` works.

---

### T1-03: `setup-wizard.spec.ts` tests are order-dependent and conflict with the `setupComplete` auto-fixture

**Files:** `e2e/setup-wizard.spec.ts`, `e2e/fixtures/auth.fixture.ts`

**Problem:** There are two conflicting setup mechanisms:

1. **`setup-wizard.spec.ts`** imports from `@playwright/test` (not auth.fixture), calls `/setup/reset` in `beforeAll`, then runs through the wizard UI step by step. Test 1.9 actually completes setup. Tests 1.10–1.12 verify post-setup behavior.

2. **Every other spec file** imports from `auth.fixture`, which has a `setupComplete` fixture marked `auto: true`. This fixture calls `/api/setup/complete` via API to ensure setup is done before each test.

The conflict: If `setup-wizard.spec.ts` runs first (which it does — test IDs start with 1.x), it resets the DB, then only completes setup at test 1.9. But if Playwright runs tests from multiple spec files in the same worker, the `setupComplete` auto-fixture from another file could trigger and complete setup *before* test 1.1 runs, making the wizard tests fail because `needsSetup` is already `false`.

With `fullyParallel: false` and `workers: 1`, tests within a file run sequentially, but **test files themselves may still be assigned to workers in any order** depending on projects.

Additionally, the `beforeAll` in `setup-wizard.spec.ts` runs once for the entire describe block. Tests 1.1–1.8 each navigate to `/setup` and fill out partial forms, but they each start fresh (no state carried between tests). Test 1.9 is the only one that completes setup. If test 1.9 fails for any reason, tests 1.10–1.12 will also fail because setup was never completed.

**Fix:**
1. Add `test.describe.configure({ mode: "serial" })` inside the setup-wizard describe block to guarantee sequential execution.
2. Move the setup reset into `test.beforeEach` instead of `test.beforeAll`, but only for tests 1.1–1.9 (the ones that need a fresh state). For tests 1.10–1.12, don't reset.

   Better approach: split into two describe blocks:
   ```typescript
   test.describe("TS-01a: Setup Wizard (pre-setup)", () => {
     test.describe.configure({ mode: "serial" });
     test.beforeEach(async () => {
       await fetch(`${API_URL}/setup/reset`, { method: "POST" });
     });
     // tests 1.1–1.8 (each starts fresh)
   });

   test.describe("TS-01b: Setup Wizard (complete flow)", () => {
     test.describe.configure({ mode: "serial" });
     test.beforeAll(async () => {
       await fetch(`${API_URL}/setup/reset`, { method: "POST" });
     });
     // test 1.9 (completes setup)
     // tests 1.10–1.12 (verify post-setup, must run after 1.9)
   });
   ```

3. In `playwright.config.ts`, consider adding a `testMatch` order or using project dependencies to ensure setup-wizard runs before other specs:
   ```typescript
   projects: [
     {
       name: "setup",
       testMatch: /setup-wizard\.spec\.ts/,
       use: { ...devices["Desktop Chrome"] },
     },
     {
       name: "chromium",
       testMatch: /^(?!.*setup-wizard).*\.spec\.ts$/,
       dependencies: ["setup"],
       use: { ...devices["Desktop Chrome"] },
     },
     // firefox, mobile projects depend on "setup" too
   ],
   ```

**Verify:** Run the full suite twice in a row; confirm setup-wizard tests pass both times.

---

### T1-04: Three browser projects (chromium, firefox, mobile) multiply failures

**File:** `playwright.config.ts`

**Problem:** The config defines three projects: `chromium`, `firefox`, and `mobile` (iPhone 14). But:
1. The CI workflow only installs Chromium browsers (`playwright install --with-deps chromium`)
2. Firefox and WebKit aren't installed, so those projects fail immediately
3. Locally, if browsers aren't installed, same issue

This triples the test count and masks the real failures with "browser not found" errors.

**Fix:** For now, keep only chromium in the default config. Add firefox/mobile as opt-in:
```typescript
projects: [
  {
    name: "setup",
    testMatch: /setup-wizard\.spec\.ts/,
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "chromium",
    testMatch: /^(?!.*setup-wizard).*\.spec\.ts$/,
    dependencies: ["setup"],
    use: { ...devices["Desktop Chrome"] },
  },
  // Uncomment to test cross-browser:
  // { name: "firefox", dependencies: ["setup"], use: { ...devices["Desktop Firefox"] } },
  // { name: "mobile", dependencies: ["setup"], use: { ...devices["iPhone 14"] } },
],
```

**Verify:** `pnpm test:e2e` runs only chromium tests; no "browser not found" errors.

---

## Tier 2 — Issues that break entire spec files

Once Tier 1 is fixed, these issues will cause groups of tests to fail.

### T2-01: `auth-guards.spec.ts` imports from `@playwright/test` — no `setupComplete` fixture

**File:** `e2e/auth-guards.spec.ts` (line 1)

**Problem:** This file imports `test` from `@playwright/test` instead of `./fixtures/auth.fixture`. This means the `setupComplete` auto-fixture never runs for these tests. If setup hasn't been completed by a prior test file, the `/profiles` and `/auth/login` endpoints will fail because there's no admin user.

Tests 19.4, 19.5, 19.6, 19.8, 19.9 use the `request` fixture to call API endpoints that require an existing admin account.

**Fix:** Change the import:
```typescript
import { test, expect } from "./fixtures/auth.fixture";
```

Or, if the intent is to test *without* auto-setup, explicitly call setup in a beforeAll:
```typescript
test.beforeAll(async () => {
  // Ensure setup is complete
  const statusRes = await fetch(`${API_URL}/setup/status`);
  const { needsSetup } = await statusRes.json();
  if (needsSetup) {
    await fetch(`${API_URL}/setup/complete`, { ... });
  }
});
```

**Verify:** Run `auth-guards.spec.ts` in isolation; confirm all tests pass.

---

### T2-02: `app-shell.spec.ts` test 18.6 expects `aria-current="page"` — not rendered by the app

**File:** `e2e/app-shell.spec.ts` (line 45), `packages/web/src/pages/AppShell.tsx` (lines 228–238)

**Problem:** Test 18.6 asserts:
```typescript
await expect(navLink).toHaveAttribute("aria-current", "page");
```

But the `NavLink` component in `AppShell.tsx` uses a plain `<Link>` from react-router with a manual `className` toggle for active state. It never sets `aria-current="page"`. React Router's `<NavLink>` component sets this attribute automatically, but the code uses `<Link>`.

This test will always fail.

**Fix (option A — fix the component):** Change `NavLink` in AppShell.tsx to use react-router's `<NavLink>` component which sets `aria-current="page"` automatically:
```typescript
import { NavLink as RRNavLink, Outlet, useNavigate } from "react-router";
// Then in NavLink component:
<RRNavLink to={to} data-testid={testId} ... />
```

**Fix (option B — fix the test):** Assert on the CSS class instead:
```typescript
await expect(navLink).toHaveClass(/font-medium/);
```

**Verify:** Navigate to /downloads; confirm the nav link has the expected attribute/class.

---

### T2-03: `beforeEach` in 6 spec files uses bare `fetch()` that fails if setup isn't complete

**Files:** `e2e/download-pipeline.spec.ts`, `e2e/download-queue.spec.ts`, `e2e/realtime-progress.spec.ts`, `e2e/recently-viewed.spec.ts`, `e2e/toasts.spec.ts`, `e2e/websocket.spec.ts`

**Problem:** These files have `test.beforeEach` blocks that call `fetch(\`${API_URL}/profiles\`)` to get profiles. This works because they import from `auth.fixture` (which has `setupComplete: auto`), but the auto fixture runs *per test*, while `beforeEach` also runs per test. The execution order is: fixtures first, then beforeEach. So `setupComplete` should have already run.

However, the `beforeEach` blocks don't check for errors. If the `/profiles` call fails (e.g. empty array, or setup not yet complete due to a race), `profiles[0].id` throws with "Cannot read properties of undefined".

**Fix:** Add error checking in all `beforeEach` blocks:
```typescript
test.beforeEach(async () => {
  const profilesRes = await fetch(`${API_URL}/profiles`);
  const profiles = await profilesRes.json();
  if (!profiles.length) throw new Error("No profiles found — setup may not have completed");
  // ... rest of setup
});
```

Also add response status checks for the pairing calls:
```typescript
const codeRes = await fetch(...);
if (!codeRes.ok) throw new Error(`Pair request failed: ${codeRes.status}`);
```

**Verify:** Intentionally break setup; confirm the error message is clear, not "Cannot read properties of undefined".

---

---

## Tier 3 — Individual test failures

These are tests that fail on their own merits after the infrastructure is working.

### T3-02: Tests that use `waitForTimeout()` are flaky

**Files:** Multiple spec files

**Problem:** Several tests use `page.waitForTimeout(500)` or `page.waitForTimeout(1000)` instead of waiting for actual DOM conditions. These will randomly fail on slow CI runners.

**Fix:** Replace each `waitForTimeout` with a proper wait:
- `waitForTimeout(500)` after navigation → `page.waitForLoadState("networkidle")`
- `waitForTimeout(1000)` after API call → `await expect(locator).toBeVisible()`
- `waitForTimeout(500)` after click → `await page.waitForResponse(url_pattern)`

**Verify:** Run tests 10 times in CI; confirm zero flakes.

---

### T3-03: `.catch(() => false)` hides real failures

**Files:** `e2e/realtime-progress.spec.ts`, `e2e/recently-viewed.spec.ts`

**Problem:** Element visibility checks wrapped in `.catch(() => false)` always pass. The test becomes a no-op.

**Fix:** Remove the `.catch()` and use Playwright's built-in timeout:
```typescript
// Instead of:
const visible = await locator.isVisible().catch(() => false);
// Use:
await expect(locator).toBeVisible({ timeout: 5_000 });
```

**Verify:** Comment out the toast rendering; confirm the test fails.

---

### T3-04: Tautological assertion in device-management.spec.ts

**File:** `e2e/device-management.spec.ts` (line 125)

**Problem:** `expect(typeof hasDefault).toBe("boolean")` always passes since `typeof` always returns a string like `"boolean"`.

**Fix:** Assert the actual value: `expect(hasDefault).toBe(true)`.

**Verify:** Break the default device feature; confirm this test fails.

---

### T3-05: Device cleanup in `profilePage` fixture deletes ALL devices

**File:** `e2e/fixtures/auth.fixture.ts` (lines 168–184)

**Problem:** The `profilePage` fixture cleanup deletes *all* devices for the profile, not just the ones it created. If another test in the same worker created a device, it gets deleted — causing that test to fail when it tries to use its device.

**Fix:** Track which devices existed before the test and only delete new ones:
```typescript
// Before use:
const beforeDevices = await fetch(`${API_URL}/devices`, { headers: { ... } }).then(r => r.json());
const beforeIds = new Set(beforeDevices.map(d => d.id));

await use(page);

// Cleanup: only delete devices that didn't exist before
const afterDevices = await fetch(`${API_URL}/devices`, { headers: { ... } }).then(r => r.json());
for (const d of afterDevices) {
  if (!beforeIds.has(d.id)) {
    await fetch(`${API_URL}/devices/${d.id}`, { method: "DELETE", ... });
  }
}
```

**Verify:** Run two spec files that both create devices; confirm no cross-contamination.

---

---

## Quick Reference: Fix Order

```
TIER 1 (blocks everything — fix these first):
  T1-01  →  Fix webServer env + simplify globalSetup
  T1-02  →  Add ENCRYPTION_MASTER_KEY fallback for test/dev + CI
  T1-03  →  Fix setup-wizard ordering + project dependencies
  T1-04  →  Remove firefox/mobile projects (or install browsers)

TIER 2 (blocks spec files):
  T2-01  →  Fix auth-guards.spec.ts import
  T2-02  →  Fix aria-current assertion or NavLink component
  T2-03  →  Add error checking in beforeEach blocks

TIER 3 (individual tests):
  T3-02  →  Replace waitForTimeout with condition waits
  T3-03  →  Remove .catch(() => false) on assertions
  T3-04  →  Fix tautological assertion
  T3-05  →  Fix device cleanup to only delete test-created devices
```

## Verified non-issues (no action needed)

- **Placeholder text** in `setup-wizard.spec.ts`: All `getByPlaceholder()` strings match `SetupWizard.tsx` exactly (`"TMDB API key"`, `"Real-Debrid API key"`, `/Profile name/`).
- **`ws` package availability**: Already in root `devDependencies` and hoisted to `node_modules/ws/`. The dynamic `import("ws")` in `websocket.spec.ts` works fine.
- **`data-testid` coverage**: All selectors in `e2e/helpers/selectors.ts` have matching `data-testid` attributes in the web components. No mismatches found.

## Expected outcome

After fixing Tier 1, the majority of tests should go from "all fail" to "most pass". Tier 2 fixes will unblock the remaining spec files. Tier 3 fixes address individual flaky or broken tests. The total effort is roughly: Tier 1 (2–3 hours), Tier 2 (1–2 hours), Tier 3 (1 hour).
