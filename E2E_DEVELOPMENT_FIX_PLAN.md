# Tadaima E2E Test Fix Plan — Development Specification

> **Current state:** 66 passed / 118 failed / 1 skipped out of 185 tests
> **Target state:** 185 passed / 0 failed
> **Generated from:** Playwright report analysis + source code + spec cross-reference

---

## Executive Summary

Analysis of the Playwright report reveals **3 root causes** that account for **all 118 failures**. These are not 118 independent bugs — they are 3 systemic issues with cascading effects. Fixing them in order will progressively unlock passing tests.

Some tests are affected by multiple root causes (e.g., `realtime-progress.spec.ts` needs both RC-1 and RC-2 fixed). The counts below reflect the *primary* blocker for each test.

| Root Cause | Tests Affected | Fix Complexity |
|---|---|---|
| RC-1: Zustand store has no `persist` middleware — auth state lost on page reload | **~81 tests** (all `profilePage`/`adminPage`-based tests) | Source code fix |
| RC-2: Pairing claim sends `deviceName` but API schema expects `name` | **~37 tests** (all tests calling `pairWorkerDevice()` or direct claim) | Test fix |
| RC-3: Individual edge cases (duplicate names, redirect waits) | **~4 tests** | Mixed (1 source + 3 test) |

---

## Root Cause 1: Zustand Store Missing Persistence (~81 tests)

### Problem

The `profilePage` test fixture (in `e2e/fixtures/auth.fixture.ts`, lines 131–175) sets up a browser page by:

1. Calling `ensureWorkerProfile()` to get a `profileToken` via API
2. Navigating to `/`
3. Writing auth state into `localStorage` under key `auth-store`
4. Reloading the page

**The assumption is that the Zustand store reads from `localStorage` on initialization.** But the store (`packages/web/src/lib/store.ts`) uses plain `create()` with no `persist` middleware. After reload, the store initializes with `profileToken: null` and `profile: null`.

When `AppShell` renders (line 139 of `AppShell.tsx`), it checks `if (!profile)` and immediately calls `navigate("/profiles")`, redirecting away from whatever page the test expected. This causes:

- **~49 "page/context closed" timeouts**: Tests try to interact with elements on a page that has already navigated away. The locator waits until the 30s timeout, then the browser context closes.
- **~32 "element not found" failures**: Tests with shorter explicit timeouts (5s) fail faster with `<element(s) not found>` because the app is on `/profiles`, not the expected page.

The `adminPage` fixture has the same problem — it writes `adminToken` / `adminRefreshToken` to `localStorage`, reloads, and expects the admin panel to work. Without persistence, the admin token is also lost.

### Spec Reference

Per **E2E_TESTING_PLAN.md §1.4** and **§3 (Helpers & Fixtures)**, the test infrastructure assumes profile session state persists across page reloads. The spec's fixture design explicitly describes writing to localStorage and reloading. The source code must support this pattern.

### Fix — Source Code Change (the spec is correct, the source code is wrong)

**File:** `packages/web/src/lib/store.ts`

Add Zustand's `persist` middleware so the store survives page reloads.

**IMPORTANT implementation notes:**

1. **TypeScript signature**: The current code is `create<AppState>((set) => ...)`. With `persist`, it must become `create<AppState>()(persist((set) => ..., config))` — note the **extra `()` after the generic**. Without this, TypeScript will throw a confusing type error. This is a documented zustand requirement for middleware with generics.

2. **`Map` fields are safe to ignore**: The store has `activeDownloads: Map<...>` and `deviceStatuses: Map<...>`. These are NOT JSON-serializable, but you do NOT need a custom serializer. The `partialize` function below excludes them — only the 4 auth fields are persisted. The `Map` fields always initialize fresh from the default state on page load.

3. **Do not change any existing state fields or actions.** Only wrap the existing `(set) => ({...})` function with `persist()` and add the config object.

**Concrete change — replace this pattern:**

```typescript
export const useAuthStore = create<AppState>((set) => ({
```

**With this pattern:**

```typescript
export const useAuthStore = create<AppState>()(
  persist(
    (set) => ({
```

**And close with the persist config after the existing store body's closing `})` :**

```typescript
    }),
    {
      name: "auth-store",
      partialize: (state) => ({
        adminToken: state.adminToken,
        adminRefreshToken: state.adminRefreshToken,
        profileToken: state.profileToken,
        profile: state.profile,
      }),
    }
  )
);
```

**Also add the import at the top of the file:**

```typescript
import { persist } from "zustand/middleware";
```

`zustand/middleware` ships with zustand — no additional package install needed.

### Verification

After this fix, run any `profilePage` test in isolation:
```bash
npx playwright test app-shell.spec.ts --project chromium
```
The sidebar, nav links, and all page elements should be visible because the store reads `profileToken` and `profile` from localStorage on reload, so `AppShell` no longer redirects to `/profiles`.

---

## Root Cause 2: Pairing API Field Name Mismatch (~37 tests)

### Problem

The `pairWorkerDevice()` helper in `e2e/helpers/constants.ts` (line 120) sends:

```typescript
body: JSON.stringify({ code, deviceName, platform: "linux" })
```

But the API schema (`packages/shared/src/api-types.ts`) defines:

```typescript
export const pairClaimRequestSchema = z.object({
  code: z.string(),
  name: z.string(),      // ← expects "name", not "deviceName"
  platform: z.string(),
});
```

The relay's device claim endpoint (`packages/relay/src/routes/devices.ts`, lines 165–168) validates the request body with Zod and returns HTTP 400 when `name` is missing. The helper sends `deviceName` instead, so every pairing attempt fails.

The same bug also exists in `e2e/device-pairing.spec.ts` where tests 5.4, 5.5, 5.6, 5.8 make direct `fetch()` calls to `/api/devices/pair/claim` using `deviceName` as the JSON key.

### Affected Tests (~37 total)

Every test that calls `pairWorkerDevice()` in its `beforeEach` or test body, plus tests that make direct claim calls:

- `download-pipeline.spec.ts` — 11 failures (all, TS-10)
- `websocket.spec.ts` — 8 failures (all, TS-07)
- `toasts.spec.ts` — 8 failures (all, TS-17)
- `realtime-progress.spec.ts` — 9 failures (all, TS-13, *overlap with RC-1 — needs both fixes*)
- `device-pairing.spec.ts` — 4 failures (5.4, 5.7, 5.8, 5.9)
- `auth-guards.spec.ts` — 1 failure (19.7)
- `download-queue.spec.ts` — 1 failure (11.3)

### Spec Reference

Per **E2E_TESTING_PLAN.md §TS-05** (Device Pairing), test 5.4 specifies: *"`POST /api/devices/pair/claim` with valid code + device info → 200 response with device token."* The API schema is authoritative — the test helper and spec files must match it.

### Fix — Test Changes (the source code is correct, the tests are wrong)

**IMPORTANT: This is a JSON key rename, NOT a variable rename.** The local variable `deviceName` stays as-is. Only the *JSON property name* in the request body changes from `deviceName` to `name`.

**Fix 1 — File:** `e2e/helpers/constants.ts`, line 120

Change:
```typescript
body: JSON.stringify({ code, deviceName, platform: "linux" }),
```

To:
```typescript
body: JSON.stringify({ code, name: deviceName, platform: "linux" }),
```

The variable `deviceName` is still used as the *value* — it's now assigned to the JSON key `name` instead of `deviceName`.

**Fix 2 — File:** `e2e/device-pairing.spec.ts`

Search for ALL `JSON.stringify` calls that send data to the `/api/devices/pair/claim` endpoint. In each one, change the `deviceName` JSON key to `name`. For example:

```typescript
// BEFORE (broken):
body: JSON.stringify({
  code,
  deviceName: uniqueDeviceName(workerIndex, "Test-Device"),
  platform: "linux",
}),

// AFTER (fixed):
body: JSON.stringify({
  code,
  name: uniqueDeviceName(workerIndex, "Test-Device"),
  platform: "linux",
}),
```

There are multiple occurrences in this file (tests 5.4, 5.5, 5.6, 5.8). Fix all of them.

### Verification

```bash
npx playwright test device-pairing.spec.ts --project chromium -g "5.4"
```
Should get HTTP 200 instead of 400.

---

## Root Cause 3: Individual Edge Cases (~4 tests)

These are issues that remain after RC-1 and RC-2 are fixed. Each is independent.

### 3A: `profile-management.spec.ts` test 3.4 — duplicate name not rejected (1 test)

**Test:** 3.4 — "duplicate name rejected"

**Error:** `expect(res.status).toBeGreaterThanOrEqual(400)` — Received: 201

**Problem:** The test creates a profile with an already-existing name and expects a 400+ error. But the backend (`packages/relay/src/routes/profiles.ts`, lines 40–71) performs no duplicate name check before inserting. It always returns 201.

**Spec Reference:** Per **E2E_TESTING_PLAN.md §TS-03**, test 3.4 specifies: *"Create profile with name that already exists → Error message; profile not created."*

**Fix — Source Code Change (the spec is correct, the source code is wrong):**

**File:** `packages/relay/src/routes/profiles.ts`, inside the `POST /` handler, after the `const { name, avatar, pin } = parsed.data;` line (line 48), add:

```typescript
// Check for duplicate name
const existing = await db
  .select({ id: profiles.id })
  .from(profiles)
  .where(eq(profiles.name, name))
  .limit(1);
if (existing.length > 0) {
  return c.json({ error: "DUPLICATE_NAME", detail: "A profile with this name already exists" }, 409);
}
```

**Import note:** Verify that `eq` is already imported from `drizzle-orm` and `profiles` from the schema at the top of this file. Both should already be present since they're used elsewhere in the same file. If not, add:
```typescript
import { eq } from "drizzle-orm";
```

### 3B: Auth guard redirect timing — CONDITIONAL (3 tests)

**Tests:** 19.1 (unauthenticated redirect), 19.3 (profile route guard), 2.6 (logout redirect)

**Problem:** These tests use `page.waitForURL()` and time out. However, **this may be a symptom of RC-1 rather than an independent issue.** After the RC-1 fix (persist middleware), the app's redirect behavior will change — the SPA will properly redirect unauthenticated users, and `waitForURL` *may* catch the client-side URL change correctly.

**Action: After completing Phase 1 (RC-1 fix), re-run these 3 tests before applying this fix:**
```bash
npx playwright test auth-guards.spec.ts --project chromium -g "19.1|19.3"
npx playwright test admin-auth.spec.ts --project chromium -g "2.6"
```

**If they still fail**, apply this fix — replace `waitForURL` with polling assertion:

In `e2e/auth-guards.spec.ts` test 19.1 and 19.3, and `e2e/admin-auth.spec.ts` test 2.6, replace:
```typescript
await page.waitForURL(/\/(profiles|setup)/);
```
With:
```typescript
await expect(page).toHaveURL(/\/(profiles|setup)/, { timeout: 10_000 });
```

**If they pass**, no change needed — skip this fix.

---

## Implementation Order

### Phase 1: Fix the store (unlocks ~81 tests)

1. **Edit** `packages/web/src/lib/store.ts`:
   - Add `import { persist } from "zustand/middleware";`
   - Wrap the existing store body with `persist()` middleware
   - Add config: `{ name: "auth-store", partialize: ... }` persisting only the 4 auth fields
   - Use `create<AppState>()(persist(...))` syntax (note: extra `()` after generic)
2. **Verify** by running `app-shell.spec.ts` — all 10 tests should pass
3. **Verify** by running `search-browse.spec.ts` — tests 8.1–8.11 should pass

### Phase 2: Fix the pairing field name (unlocks ~37 tests)

1. **Edit** `e2e/helpers/constants.ts` line 120 — change JSON key from `deviceName` to `name` (keep the variable as the value: `name: deviceName`)
2. **Edit** `e2e/device-pairing.spec.ts` — find ALL `JSON.stringify` calls to the claim endpoint and change the `deviceName` JSON key to `name`
3. **Verify** by running `device-pairing.spec.ts` — tests 5.4, 5.7, 5.8, 5.9 should pass
4. **Verify** by running `websocket.spec.ts` — all 8 tests should pass

### Phase 3: Fix duplicate profile name check (unlocks 1 test)

1. **Edit** `packages/relay/src/routes/profiles.ts` — add duplicate name query before insert in the `POST /` handler (verify `eq` and `profiles` imports exist)
2. **Verify** by running `npx playwright test profile-management.spec.ts --project chromium -g "3.4"` — should return 409 instead of 201

### Phase 4: Check redirect tests (potentially unlocks 3 tests)

1. **Re-run** tests 19.1, 19.3, and 2.6 to see if Phase 1 already fixed them
2. **If still failing:** replace `waitForURL` with `expect(page).toHaveURL()` in `auth-guards.spec.ts` and `admin-auth.spec.ts`
3. **If passing:** no changes needed — move on

### Phase 5: Full regression

```bash
npx playwright test --project chromium
```

Expected: 184 passed, 0 failed, 1 skipped (the existing skip).

---

## Tier 2 Improvements (Post-Fix Cleanup)

These are not blocking any tests but should be addressed for test reliability:

| Item | File | Issue | Fix |
|---|---|---|---|
| T2-A | Multiple spec files | `waitForTimeout()` usage is flaky | Replace with condition-based waits |
| T2-B | `realtime-progress.spec.ts`, `recently-viewed.spec.ts` | `.catch(() => false)` hides real failures | Use `expect(locator).toBeVisible()` instead |
| T2-C | `device-management.spec.ts` line 125 | `expect(typeof hasDefault).toBe("boolean")` is tautological | Change to `expect(hasDefault).toBe(true)` |
| T2-D | `playwright.config.ts` | `fullyParallel: true` with `workers: 4` may cause device limit conflicts | Consider reducing workers or improving isolation |
| T2-E | `e2e/global-setup.ts` | `POST /setup/reset` may not exist | Verify endpoint exists or remove call |

---

## File Change Summary

| File | Change Type | Description |
|---|---|---|
| `packages/web/src/lib/store.ts` | **SOURCE CODE** | Add zustand `persist` middleware wrapping existing store |
| `packages/relay/src/routes/profiles.ts` | **SOURCE CODE** | Add duplicate name check before profile insert |
| `e2e/helpers/constants.ts` | **TEST** | Change JSON key `deviceName` → `name` (keep variable as value) |
| `e2e/device-pairing.spec.ts` | **TEST** | Change JSON key `deviceName` → `name` in all claim calls |
| `e2e/auth-guards.spec.ts` | **TEST** *(conditional)* | Replace `waitForURL` with `expect().toHaveURL()` if still failing after Phase 1 |
| `e2e/admin-auth.spec.ts` | **TEST** *(conditional)* | Replace `waitForURL` with `expect().toHaveURL()` if still failing after Phase 1 |

**Total files to change: 4 guaranteed + 2 conditional**
**Estimated effort: 1–2 hours**
