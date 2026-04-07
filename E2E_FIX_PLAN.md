# E2E Test Fix Plan — 46 Failing Tests

## Root Cause Summary

All 46 failures trace back to **8 distinct root causes**. Fixes are ordered by impact (most tests fixed first) and dependency (some fixes unblock others).

---

## RC1: MockAgent sends schema-invalid WebSocket messages (15 tests)

**Tests:** 17.1–17.8, 7.8, 7.9, 13.8, 13.9, 10.4, 10.10, and contributes to 10.2

**Problem:** The `MockAgent` class in `e2e/fixtures/ws-mock.fixture.ts` sends messages that fail Zod validation at the relay. The relay's `handleAgentConnection()` in `packages/relay/src/ws/handler.ts` (line 106–108) does `messageSchema.safeParse(raw)` and silently drops invalid messages (`if (!msg.success) return`). These messages never reach the web client, so toasts never appear.

**Specific field mismatches:**

| Method | Missing/Wrong Fields | Schema Expects |
|--------|---------------------|----------------|
| `completeDownload()` | Missing `finalSize` | `{ jobId, filePath, finalSize }` |
| `failDownload()` | Missing `phase` | `{ jobId, error, phase, retryable }` |
| `connect()` → `agent:hello` | Has `hostname`, missing `activeJobs`, `diskFreeBytes` | `{ version, platform, activeJobs, diskFreeBytes }` |
| `sendHeartbeat()` | Has `uptime`/`activeDownloads`, wrong names | `{ activeJobs, diskFreeBytes, uptimeSeconds }` |

**Fix file:** `e2e/fixtures/ws-mock.fixture.ts`

**Changes:**

```typescript
// completeDownload — add finalSize
async completeDownload(jobId: string, filePath?: string): Promise<void> {
  this.send({
    id: `complete-${Date.now()}`,
    type: "download:completed",
    timestamp: Date.now(),
    payload: {
      jobId,
      filePath: filePath ?? "/downloads/test-file.mkv",
      finalSize: 1_000_000_000,          // ADD THIS
      _meta: { title: "Test Movie" },
    },
  });
}

// failDownload — add phase
async failDownload(jobId: string, error = "Test error", retryable = false): Promise<void> {
  this.send({
    id: `fail-${Date.now()}`,
    type: "download:failed",
    timestamp: Date.now(),
    payload: {
      jobId,
      error,
      phase: "downloading",               // ADD THIS
      retryable,
      _meta: { title: "Test Movie" },
    },
  });
}

// connect() → agent:hello — fix payload fields
this.send({
  id: `hello-${Date.now()}`,
  type: "agent:hello",
  timestamp: Date.now(),
  payload: {
    version: "1.0.0-test",
    platform: "linux",
    activeJobs: 0,                        // REPLACE hostname WITH THESE
    diskFreeBytes: 100_000_000_000,
  },
});

// sendHeartbeat — fix field names
async sendHeartbeat(): Promise<void> {
  this.send({
    id: `hb-${Date.now()}`,
    type: "agent:heartbeat",
    timestamp: Date.now(),
    payload: {
      activeJobs: 0,                      // WAS: activeDownloads
      diskFreeBytes: 100_000_000_000,
      uptimeSeconds: 3600,                // WAS: uptime
    },
  });
}
```

---

## RC2: Relay broadcasts Zod-stripped messages, losing `_meta` fields (15 tests)

**Tests:** Same 15 as RC1 (overlapping — both fixes needed)

**Problem:** In `packages/relay/src/ws/handler.ts` line 161:
```typescript
broadcastToClients(profileId, JSON.stringify(message));
```
`message` is the Zod-parsed output which **strips unknown fields** like `_meta` and `title`. The web client's AppShell reads `raw._meta` for toast titles, but `_meta` was stripped during relay forwarding.

Additionally, the relay's own history recording (lines 130–157) accesses `p._meta` from the parsed `message.payload`, which is also stripped.

**Fix file:** `packages/relay/src/ws/handler.ts`

**Changes:**
1. Forward the **raw** message instead of the stripped one:
```typescript
// Line 161: Change from:
broadcastToClients(profileId, JSON.stringify(message));
// To:
broadcastToClients(profileId, JSON.stringify(raw));
```

2. Use `raw` instead of `message.payload` for `_meta` access in history recording (lines 125–158):
```typescript
// Lines 130-131: Change from:
const p = message.payload as Record<string, unknown>;
if (p._meta) {
  const meta = p._meta as Record<string, unknown>;
// To:
const rawPayload = raw.payload as Record<string, unknown> | undefined;
if (rawPayload?._meta) {
  const meta = rawPayload._meta as Record<string, unknown>;
```

**Note:** Keep the Zod validation for security (reject truly malformed messages), but forward the original data to preserve extra metadata fields.

---

## RC3: AppShell progress handler overwrites download title (4 tests)

**Tests:** 13.1, 13.2, 13.3, 10.2

**Problem:** In `packages/web/src/pages/AppShell.tsx` lines 75–87, when a `download:progress` message arrives, the handler creates a **new** `ActiveDownload` object with `title: ""` and `requestId: ""`, completely overwriting the existing entry (which had the title from the earlier `download:accepted` message). The DownloadsPage then can't find the active download card by title text.

**Fix file:** `packages/web/src/pages/AppShell.tsx`

**Changes — merge progress into existing entry instead of replacing:**
```typescript
} else if (message.type === "download:progress") {
  // Merge with existing active download to preserve title/requestId
  const existing = useAuthStore.getState().activeDownloads.get(message.payload.jobId);
  setActiveDownload({
    jobId: message.payload.jobId,
    requestId: existing?.requestId ?? "",
    title: existing?.title ?? "",
    mediaType: existing?.mediaType ?? "",
    phase: message.payload.phase,
    progress: message.payload.progress,
    downloadedBytes: message.payload.downloadedBytes,
    totalBytes: message.payload.totalBytes,
    speedBps: message.payload.speedBps,
    eta: message.payload.eta,
  });
}
```

---

## RC4: Missing `data-state` attribute on download tab buttons (9 tests)

**Tests:** 12.2, 12.3, 12.4, 12.5, 12.6, 11.2, 11.7, and contributes to 12.8, 12.10

**Problem:** In `packages/web/src/pages/DownloadsPage.tsx` lines 154–171, tab buttons use `className` to indicate the active state but don't set a `data-state` attribute. Tests assert `toHaveAttribute("data-state", "active")`.

**Fix file:** `packages/web/src/pages/DownloadsPage.tsx`

**Changes — add `data-state` attribute to tab buttons:**
```typescript
<button
  key={t.key}
  onClick={() => setTab(t.key)}
  data-testid={`tab-${t.key}`}
  data-state={tab === t.key ? "active" : "inactive"}   // ADD THIS
  className={`rounded-md px-4 py-2 text-sm font-medium transition ${
    tab === t.key
      ? "bg-zinc-700 text-white"
      : "text-zinc-400 hover:text-white"
  }`}
>
```

---

## RC5: `getByText()` strict mode violations — ambiguous text matches (8 tests)

**Tests:** 18.4, 18.5, 15.1, 20.12, 8.7, 12.10, 3.3, 3.9

**Problem:** Playwright's `getByText()` uses strict mode, requiring exactly one matching element. Several tests use `getByText("Settings")`, `getByText("Devices")`, `getByText("Inception")`, etc. which match both the sidebar nav link AND the page heading (or other elements). Actual errors:

- `getByText('Devices')` → matches nav link + heading (or "Loading devices..." text)
- `getByText('Settings')` → matches nav link + heading
- `getByText('Inception')` → matches heading + 4 stream title cells
- `getByText('Downloads')` → matches nav link + heading + "No downloads yet." text (3 elements)
- `row.getByText('PIN')` → matches profile name span + PIN badge span
- `row.getByText('Delete')` → matches profile name span + Delete button

**Fix files:** Multiple test files OR source files. Tests should use more specific selectors.

**Option A — Fix the TESTS** (recommended for most cases):
```typescript
// 18.4, 18.5, 15.1, 20.12: Use getByRole('heading') instead of getByText()
await expect(profilePage.getByRole("heading", { name: "Devices" })).toBeVisible();
await expect(profilePage.getByRole("heading", { name: "Settings" })).toBeVisible();

// 8.7: Use getByRole('heading') for title
await expect(profilePage.getByRole("heading", { name: "Inception" })).toBeVisible();

// 12.10: Use heading
await expect(profilePage.getByRole("heading", { name: "Downloads" })).toBeVisible();

// 3.3: Use exact match on the PIN badge
await expect(row.getByText("PIN", { exact: true })).toBeVisible();
// OR add data-testid="pin-badge" to the PIN span in AdminPanel.tsx

// 3.9: Use getByRole('button') for the Delete button
await row.getByRole("button", { name: "Delete" }).click();
```

**Option B — Fix the SOURCE** (for 3.3 and 3.9, add `data-testid`):
In `packages/web/src/pages/AdminPanel.tsx`, add `data-testid="pin-badge"` to the PIN `<span>` and `data-testid="delete-profile-btn"` to the Delete `<button>` for each profile row.

---

## RC6: Stream row `getByText()` strict mode violations (3 tests)

**Tests:** 9.3, 9.4, 9.6

**Problem:** Stream rows contain the resolution/HDR text in BOTH the torrent name cell (`<td>Inception.2010.1080p.BluRay.x264</td>`) AND the badge (`<span>1080p</span>`). `getByText("1080p")` inside a stream row resolves to 2 elements.

**Fix file:** `e2e/stream-selection.spec.ts`

**Changes — use exact match to target only the badge:**
```typescript
// Test 9.3: Change from:
await expect(rows.nth(i).getByText("1080p")).toBeVisible();
// To:
await expect(rows.nth(i).getByText("1080p", { exact: true })).toBeVisible();

// Test 9.4: Change from:
await expect(rows.nth(i).getByText("HDR")).toBeVisible();
// To:
await expect(rows.nth(i).getByText("HDR", { exact: true })).toBeVisible();

// Test 9.6: Same pattern for both "2160p" and "HDR"
await expect(rows.nth(i).getByText("2160p", { exact: true })).toBeVisible();
await expect(rows.nth(i).getByText("HDR", { exact: true })).toBeVisible();
```

---

## RC7: `<option>` text not visible in `<select>` elements (2 tests)

**Tests:** 8.8, 9.10

**Problem:** `getByText("Season 1")` resolves to an `<option>` element inside a `<select>` dropdown. Playwright reports the element as `hidden` because `<option>` elements are not considered visible unless the dropdown is open.

**Fix — Option A (fix tests):** Use `selectOption` or check the `<select>` value:
```typescript
// 8.8 and 9.10: Instead of getByText("Season 1")
const seasonSelect = profilePage.locator('select').first();
await expect(seasonSelect).toHaveValue("1");  // Season 1 has value="1"
```

**Fix — Option B (fix source):** Add a visible label showing the selected season name outside the `<select>` in `packages/web/src/components/StreamPicker.tsx`. For example, add `data-testid="season-selector"` to the select and render the selected value as visible text.

**Recommended:** Option A is simplest and doesn't change the UI.

---

## RC8: Admin login error message mismatch (2 tests)

**Tests:** 2.2, 2.3

**Problem:** The relay's auth endpoint returns `{ detail: "Invalid username or password" }`. The test checks for `/invalid credentials/i` which does NOT match "Invalid username or password".

The AdminLogin.tsx code: `err.detail ?? "Invalid credentials"` — since `err.detail` IS defined ("Invalid username or password"), the fallback "Invalid credentials" is never used.

**Fix — Option A (fix tests):**
```typescript
// 2.2: Change from:
await expect(page.getByText(/invalid credentials/i)).toBeVisible();
// To:
await expect(page.getByText(/invalid/i)).toBeVisible();

// 2.3: Change from:
await expect(page.getByText(/invalid credentials|login failed/i)).toBeVisible();
// To:
await expect(page.getByText(/invalid|login failed/i)).toBeVisible();
```

**Fix — Option B (fix source):** Change the API error detail to match the test expectations. In `packages/relay/src/auth.ts`, change the error detail to `"Invalid credentials"` instead of `"Invalid username or password"`.

**Recommended:** Option B — the API should use a generic "Invalid credentials" message (which is also more secure — don't reveal whether the username or password was wrong).

---

## RC9: AppShell calls `navigate()` during render (2 tests)

**Tests:** 19.1, 19.3

**Problem:** In `packages/web/src/pages/AppShell.tsx` lines 139–141:
```typescript
if (!profile) {
  navigate("/profiles");
  return null;
}
```
Calling `navigate()` during render is a React anti-pattern. In React 18/19, side effects during render may not execute correctly. The redirect never happens, causing `page.waitForURL()` to time out after 30 seconds.

**Fix file:** `packages/web/src/pages/AppShell.tsx`

**Changes — use `<Navigate>` component instead:**
```typescript
import { Link, Outlet, useNavigate, useLocation, Navigate } from "react-router";

// Lines 139-142: Change from:
if (!profile) {
  navigate("/profiles");
  return null;
}
// To:
if (!profile) {
  return <Navigate to="/profiles" replace />;
}
```

---

## RC10: Logout timeout — `logoutBtn` click doesn't navigate (1 test)

**Tests:** 2.6

**Problem:** After clicking the logout button in AdminPanel, the test times out waiting for URL to change to `**/profiles`. The `handleLogout()` function in AdminPanel.tsx calls `clearAdminAuth()` and `navigate("/profiles")`.

This may be failing because `AdminPanel` doesn't have a `data-testid="logout-btn"` in the right place, or the button's `navigate()` isn't firing properly.

**Fix file:** `packages/web/src/pages/AdminPanel.tsx`

**Investigation needed:** Read the full AdminPanel.tsx to locate the logout button and verify it has `data-testid="logout-btn"`. Ensure `handleLogout` correctly calls navigate.

---

## RC11: Profile picker tests depend on profile created in earlier test (2 tests)

**Tests:** 4.4, 4.5

**Problem:** Tests 4.4 and 4.5 look for a profile card named `PinTest-w{workerIndex}` which was created in test 4.3. However, tests 4.4 and 4.5 run on **different workers** (error shows `PinTest-w23` and `PinTest-w22` vs test 4.3's worker). In parallel execution, the profile created by worker N is not visible to worker M.

**Fix file:** `e2e/profile-picker.spec.ts`

**Changes — create the PIN profile in a `beforeAll` or `beforeEach` hook, or create it inline in each test:**
```typescript
test("4.4 — correct PIN accepted", async ({ page, adminLogin, workerIndex }) => {
  // Ensure the PIN profile exists for this worker
  const { accessToken } = await adminLogin();
  const pinProfileName = uniqueDeviceName(workerIndex, "PinTest");
  await fetch(`${API_URL}/profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name: pinProfileName, pin: "1234" }),
  }).catch(() => {}); // Ignore if already exists

  await page.goto("/profiles");
  const card = page.locator(SEL.profileCard).filter({ hasText: pinProfileName });
  await card.click();
  await page.locator(SEL.pinInput).fill("1234");
  await page.getByRole("button", { name: "Enter" }).click();
  await page.waitForURL("/");
});
```

Apply the same pattern to test 4.5.

---

## RC12: Download pipeline test 10.2 — device pairing 400 error (1 test)

**Tests:** 10.2

**Problem:** Error is `"Pair request failed: 400"` — the device pairing API returns 400 during the `beforeEach` setup in `pairWorkerDevice()`. This is likely because a device with the same name already exists from a previous test run, or the profile has hit its 5-device limit.

**Fix file:** `e2e/helpers/constants.ts` (the `pairWorkerDevice` function)

**Changes — clean up existing devices before pairing, or handle 400 gracefully:**
```typescript
async function pairWorkerDevice(profileToken, workerIndex, label) {
  // Clean up existing test devices first
  const devicesRes = await fetch(`${API_URL}/devices`, {
    headers: { Authorization: `Bearer ${profileToken}` },
  });
  if (devicesRes.ok) {
    const devices = await devicesRes.json();
    const testDevices = devices.filter(d => d.name.includes(`${label}-w${workerIndex}`));
    for (const d of testDevices) {
      await fetch(`${API_URL}/devices/${d.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${profileToken}` },
      });
    }
  }
  // Then proceed with pairing...
}
```

---

## RC13: DownloadsPage empty state test (1 test)

**Tests:** 12.8

**Problem:** Test checks `hasEmpty || hasHistory` but neither is true. After other tests have run, the download history may have items but the active tab is "all" which shows all sections. However, if there's loading delay, `isVisible()` returns false for both.

**Fix:** This test should be fixed by RC4 (adding `data-state` so tabs work). But also add a wait for loading to complete:
```typescript
test("12.8 — empty state shown when no downloads", async ({ profilePage }) => {
  await profilePage.goto("/downloads");
  // Wait for loading to finish
  await expect(profilePage.getByText("Loading...")).not.toBeVisible({ timeout: 5000 }).catch(() => {});
  const hasEmpty = await profilePage.locator(SEL.downloadsEmpty).isVisible().catch(() => false);
  const hasHistory = await profilePage.locator(SEL.downloadHistory).isVisible().catch(() => false);
  expect(hasEmpty || hasHistory).toBeTruthy();
});
```

---

## Implementation Order

Execute fixes in this order to maximize early wins and minimize regressions:

### Phase 1: Source Code Fixes (4 files, unblocks 30+ tests)

1. **`packages/relay/src/ws/handler.ts`** — Forward raw messages, fix _meta access (RC2)
2. **`packages/web/src/pages/AppShell.tsx`** — Fix progress merge + use `<Navigate>` (RC3, RC9)
3. **`packages/web/src/pages/DownloadsPage.tsx`** — Add `data-state` to tabs (RC4)
4. **`packages/relay/src/auth.ts`** — Change error detail to "Invalid credentials" (RC8)

### Phase 2: Test Fixture Fixes (2 files, unblocks remaining 15+ tests)

5. **`e2e/fixtures/ws-mock.fixture.ts`** — Fix all schema-invalid payloads (RC1)
6. **`e2e/helpers/constants.ts`** — Clean up devices in `pairWorkerDevice()` (RC12)

### Phase 3: Test Selector Fixes (7 test files)

7. **`e2e/app-shell.spec.ts`** — Use `getByRole("heading")` for 18.4, 18.5 (RC5)
8. **`e2e/settings-page.spec.ts`** — Use `getByRole("heading")` for 15.1 (RC5)
9. **`e2e/error-handling.spec.ts`** — Use `getByRole("heading")` for 20.12 (RC5)
10. **`e2e/search-browse.spec.ts`** — Use `getByRole("heading")` for 8.7 (RC5)
11. **`e2e/stream-selection.spec.ts`** — Use `{ exact: true }` for 9.3/9.4/9.6, fix select assertion for 9.10 (RC6, RC7)
12. **`e2e/downloads-page.spec.ts`** — Fix 12.10 and 12.8 (RC5, RC13)
13. **`e2e/profile-management.spec.ts`** — Use `getByRole("button")` and exact text for 3.3/3.9 (RC5)

### Phase 4: Profile Picker Independence (1 test file)

14. **`e2e/profile-picker.spec.ts`** — Create PIN profile inline for 4.4/4.5 (RC11)
15. **`e2e/search-browse.spec.ts`** — Fix select value assertion for 8.8 (RC7)

### Phase 5: Admin Logout (1 file)

16. **`packages/web/src/pages/AdminPanel.tsx`** — Investigate and fix logout button for 2.6 (RC10)

---

## Verification

After all fixes, run:
```bash
pnpm dev:e2e &   # Start the test server
pnpm test:e2e     # Run all Playwright tests
```

All 185 tests should pass (138 currently passing + 46 fixed + 1 skipped).
