# Tadaima — Post-MVP Development Plan (Phase 1)

*Last updated: April 8, 2026*

This document is a step-by-step development plan for Claude Code. Each issue lists the exact files, line numbers, and changes required. Issues are ordered by dependency — complete them in sequence.

**After every issue:** run `pnpm typecheck && pnpm test` to verify no regressions.

---

## Issue #1: Retry Button on Downloads Page Does Nothing

**Problem:** The retry button in `DownloadsPage.tsx` (line 259) has no `onClick` handler. The `download_history` table stores `magnet` and `expectedSize` for retry, but the API endpoint doesn't return them.

### Step 1: Add `magnet` and `expectedSize` to the downloads API response

**File:** `packages/relay/src/routes/downloads.ts`

In the `GET /api/downloads` endpoint response mapper, the `rows.map(...)` block returns fields from each history row but omits `magnet` and `expectedSize`. Add them to the response object:

```ts
magnet: r.magnet,
expectedSize: r.expectedSize,
```

### Step 2: Update the API client type to include the new fields

**File:** `packages/web/src/lib/api.ts`

Find the `downloads.list()` method (around line 291). Its generic type parameter defines the response shape. Add `magnet: string` and `expectedSize: number` to the response type.

### Step 3: Update the `HistoryItem` interface

**File:** `packages/web/src/pages/DownloadsPage.tsx`

Find the `HistoryItem` interface (around line 24). Change `magnet` from optional to required (`magnet: string`) and add `expectedSize: number`. Also ensure `season`, `episode`, `tmdbId`, `imdbId`, `year`, `mediaType`, and `torrentName` are all present (they're returned by the API but some may be marked optional in the interface).

### Step 4: Add the retry click handler

**File:** `packages/web/src/pages/DownloadsPage.tsx`

Add a function near the existing `handleCancel` function (around line 109):

```ts
function handleRetry(item: HistoryItem) {
  wsClient.send({
    id: `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "download:request",
    timestamp: Date.now(),
    payload: {
      tmdbId: item.tmdbId,
      imdbId: item.imdbId,
      title: item.title,
      year: item.year,
      mediaType: item.mediaType,
      ...(item.season != null && { season: item.season }),
      ...(item.episode != null && { episode: item.episode }),
      magnet: item.magnet,
      torrentName: item.torrentName,
      expectedSize: item.expectedSize,
    },
  });
  addToast("info", `Retrying: ${item.title}`);
}
```

### Step 5: Wire the button to the handler

**File:** `packages/web/src/pages/DownloadsPage.tsx`

Find the retry button JSX (around line 259). It currently looks like:

```tsx
<button className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white">
  Retry
</button>
```

Add the `onClick` handler. The parent scope should have access to the history item (`h`):

```tsx
<button
  className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white"
  onClick={() => handleRetry(h)}
>
  Retry
</button>
```

### Verification

- `pnpm typecheck` passes.
- The retry button should now send a well-formed `download:request` via WebSocket. No relay or agent changes needed — a retry is just a new download request with the same magnet.

---

## Issue #2: Download Title Shows "Unknown" During Active Downloads

**Problem:** The agent's `sendProgress()` only sends `{ jobId, phase, progress }` — no title. The web stores the title from `download:accepted`, but that message's schema (`downloadAcceptedPayloadSchema`) only defines `{ jobId, requestId }` — so the agent never sends title there either. The web falls back to `"Unknown"`.

### Step 1: Add `title` to the `downloadProgress` schema

**File:** `packages/shared/src/messages.ts`

Find `downloadProgressPayloadSchema` (around line 63). Add `title` as an optional string field:

```ts
export const downloadProgressPayloadSchema = z.object({
  jobId: z.string(),
  phase: z.string(),
  progress: z.number().min(0).max(100),
  title: z.string().optional(),
  mediaType: z.enum(["movie", "tv"]).optional(),
  downloadedBytes: z.number().optional(),
  totalBytes: z.number().optional(),
  speedBps: z.number().optional(),
  eta: z.number().optional(),
});
```

### Step 2: Add `title` to the `downloadAccepted` schema

**File:** `packages/shared/src/messages.ts`

Find `downloadAcceptedPayloadSchema` (around line 53). Add `title` as an optional string:

```ts
export const downloadAcceptedPayloadSchema = z.object({
  jobId: z.string(),
  requestId: z.string(),
  title: z.string().optional(),
  mediaType: z.enum(["movie", "tv"]).optional(),
});
```

### Step 3: Include `title` in the agent's `download:accepted` message

**File:** `packages/agent/src/download-handler.ts`

Find where `download:accepted` is sent in `handleRequest()` (around line 100):

```ts
this.sendMessage("download:accepted", { jobId, requestId });
```

Change to:

```ts
this.sendMessage("download:accepted", {
  jobId,
  requestId,
  title: meta.title,
  mediaType: meta.mediaType,
});
```

### Step 4: Include `title` in the agent's progress messages

**File:** `packages/agent/src/download-handler.ts`

Find the `sendProgress()` method (around line 249):

```ts
private sendProgress(jobId: string, phase: string, progress: number): void {
  this.sendMessage("download:progress", { jobId, phase, progress });
}
```

The method doesn't have access to `meta`. Refactor it to accept a job object or add a `title` parameter. The simplest approach — add `title` and `mediaType` parameters:

```ts
private sendProgress(
  jobId: string,
  phase: string,
  progress: number,
  meta?: { title: string; mediaType: string },
): void {
  this.sendMessage("download:progress", {
    jobId,
    phase,
    progress,
    ...(meta && { title: meta.title, mediaType: meta.mediaType }),
  });
}
```

### Step 5: Pass `meta` to all `sendProgress()` call sites

**File:** `packages/agent/src/download-handler.ts`

Search for all calls to `this.sendProgress(` in `executeDownload()`. Each one looks like:

```ts
this.sendProgress(job.jobId, "adding", 0);
```

Update every call to pass `job.meta`:

```ts
this.sendProgress(job.jobId, "adding", 0, job.meta);
```

There are also inline `this.sendMessage("download:progress", {...})` calls inside the download loop (around lines 200–208) that send `downloadedBytes`, `totalBytes`, `speedBps`, `eta`. Add `title: job.meta.title` and `mediaType: job.meta.mediaType` to those payloads as well.

### Step 6: Update the web client to read `title` from progress messages

**File:** `packages/web/src/pages/AppShell.tsx`

Find the `download:accepted` handler (around line 63). It currently does:

```ts
const title = typeof raw?.title === "string" ? raw.title : "Unknown";
```

Change to read from the validated payload (since we added `title` to the schema):

```ts
const title = message.payload.title ?? "Unknown";
const mediaType = message.payload.mediaType ?? "";
```

Find the `download:progress` handler (around line 75). It currently preserves `title` from the existing store entry:

```ts
title: existing?.title ?? "",
```

Change to prefer the title from the incoming message, falling back to the stored value:

```ts
title: message.payload.title ?? existing?.title ?? "Unknown",
mediaType: message.payload.mediaType ?? existing?.mediaType ?? "",
```

### Verification

- `pnpm typecheck` passes (shared schema changes propagate to all packages).
- Active downloads should now display the correct title from the first progress message onward.

---

## Issue #3: Admin Panel Unreachable (Add Profile Button Hidden)

**Problem:** The "Add Profile" button exists in `AdminPanel.tsx` and works. The problem is navigation: the "Manage" link on `ProfilePicker.tsx` (line 147) and the "Admin Panel" button on `SettingsPage.tsx` (line 125) are both conditionally rendered only when `adminToken` exists. This creates a catch-22 — you need to be logged in to see the link, but need the link to log in.

### Step 1: Always show the "Manage" link on ProfilePicker

**File:** `packages/web/src/pages/ProfilePicker.tsx`

Find the conditional rendering of the "Manage" link (around line 147). It's wrapped in `{adminToken && (...)}`. Change it so the link is always visible. When clicked without an `adminToken`, it should navigate to `/admin/login` instead of `/admin`:

```tsx
<Link to={adminToken ? "/admin" : "/admin/login"} className="...">
  Manage
</Link>
```

Remove the `{adminToken && ...}` conditional wrapper so the link is always rendered.

### Step 2: Always show the "Admin Panel" button on SettingsPage

**File:** `packages/web/src/pages/SettingsPage.tsx`

Find the conditional "Admin Panel" button (around line 125). Same fix — remove the `{adminToken && ...}` conditional. Navigate to `/admin/login` if no token:

```tsx
<button onClick={() => navigate(adminToken ? "/admin" : "/admin/login")} className="...">
  Admin Panel
</button>
```

### Verification

- Navigate to the profile picker — "Manage" should always be visible.
- Click "Manage" without being logged in as admin — should redirect to admin login.
- After logging in, the admin panel should show with the "Add Profile" button visible.

---

## Issue #4: TV Series Downloads — Switch to Full-Season Mode

**Problem:** The agent uses `selectFiles("all")` for every torrent, downloads all files, but only stores the last file's path. The web sends per-episode requests with a season/episode selector that doesn't work properly. Phase 1 simplifies: remove episode selection, download entire seasons, track all file paths.

### Step 1: Remove the episode selector from StreamPicker

**File:** `packages/web/src/components/StreamPicker.tsx`

Find the episode-related state variables (around line 68–70). There should be `selectedEpisode` and its setter. Remove the `selectedEpisode` state. Keep `selectedSeason`.

Find the episode dropdown JSX (around lines 236–255). Remove the entire episode dropdown block. Keep only the season dropdown (lines 222–235).

Find the streams fetch call (around line 120–126) where `api.streams()` is called with `selectedSeason` and `selectedEpisode`. Remove the `selectedEpisode` parameter. The streams API should be called with just `mediaType`, `imdbId`, and `selectedSeason`.

Check if `api.streams()` in `packages/web/src/lib/api.ts` requires `episode`. If so, make the `episode` parameter optional.

Find the download button payload (around lines 378–389). Remove the line `...(selectedEpisode != null && { episode: selectedEpisode })`. The payload should include `season` but not `episode`.

### Step 2: Fix the agent to track all file paths

**File:** `packages/agent/src/download-handler.ts`

Find the organizing loop in `executeDownload()` (around lines 222–234):

```ts
let finalPath = "";
for (const filePath of downloadedFiles) {
  finalPath = await organizeFile({...});
}
```

Change to collect all paths:

```ts
const organizedPaths: string[] = [];
for (const filePath of downloadedFiles) {
  const organized = await organizeFile({
    title: meta.title,
    year: meta.year,
    tmdbId: meta.tmdbId,
    mediaType: meta.mediaType,
    season: meta.season,
    sourcePath: filePath,
  });
  organizedPaths.push(organized);
}
```

### Step 3: Update organizer to parse episode info from filenames

**File:** `packages/agent/src/organizer.ts`

The organizer currently receives `season`, `episode`, and `episodeTitle` from the caller and doesn't parse filenames. For full-season mode, the caller won't provide per-file episode info. The organizer needs to extract season/episode numbers from the filename.

Find the TV file handling block (around lines 46–61). Before calling `buildEpisodePath()`, add filename parsing logic:

```ts
// Parse SxxExx pattern from filename if episode not provided
const basename = path.basename(sourcePath);
let episodeNum = request.episode;
let epTitle = request.episodeTitle;
if (episodeNum == null) {
  const match = basename.match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
  if (match) {
    episodeNum = parseInt(match[2], 10);
  }
}
if (!epTitle && episodeNum != null) {
  epTitle = `Episode ${episodeNum}`;
}
```

Use `episodeNum` and `epTitle` in the `buildEpisodePath()` call instead of `request.episode` and `request.episodeTitle`.

### Step 4: Update the completion message for multi-file downloads

**File:** `packages/agent/src/download-handler.ts`

Find where `download:completed` is sent (around lines 241–246). It currently sends `filePath: finalPath`. Change to send all paths:

```ts
this.sendMessage("download:completed", {
  jobId: job.jobId,
  filePaths: organizedPaths,
  filePath: organizedPaths[organizedPaths.length - 1] ?? "",
  finalSize: totalSize,
  _meta: meta,
});
```

Keep `filePath` (singular) for backward compatibility, add `filePaths` (array) as the new canonical field.

### Step 5: Update the `downloadCompleted` schema

**File:** `packages/shared/src/messages.ts`

Find `downloadCompletedPayloadSchema`. Add `filePaths` as an optional array:

```ts
export const downloadCompletedPayloadSchema = z.object({
  jobId: z.string(),
  filePath: z.string(),
  filePaths: z.array(z.string()).optional(),
  finalSize: z.number(),
});
```

### Step 6: Preserve season info in queued download broadcasts

**File:** `packages/relay/src/ws/queue.ts`

Find the `broadcastToClients` call inside `queueDownload()` (around lines 41–54). The `download:queued` payload currently only includes `title` and `deviceName`. Add `mediaType` and `season`:

```ts
payload: {
  queueId: entry.id,
  requestId,
  title,
  deviceName: device?.name ?? "Unknown",
  mediaType: (rawMessage.payload as Record<string, unknown>)?.mediaType ?? "movie",
  season: (rawMessage.payload as Record<string, unknown>)?.season,
},
```

Also update `downloadQueuedPayloadSchema` in `packages/shared/src/messages.ts` to include these optional fields.

### Verification

- `pnpm typecheck` passes.
- The StreamPicker should show a season dropdown but no episode dropdown for TV shows.
- The agent should download all files from a torrent and organize each one with correct episode info parsed from filenames.

---

## Issue #5: Web App Styling Broken on Mobile

**Problem:** Layout overflow on phones and tablets. No responsive sidebar handling.

### Step 1: Make the sidebar responsive

**File:** `packages/web/src/pages/AppShell.tsx`

Find the sidebar element (around line 156). It likely has a fixed width class like `w-56`. Add responsive behavior:

- On mobile (`< md`): hide the sidebar by default, show it via a hamburger toggle.
- Add state: `const [sidebarOpen, setSidebarOpen] = useState(false);`
- Add a hamburger button that's only visible on mobile: `<button className="md:hidden" onClick={() => setSidebarOpen(!sidebarOpen)}>`.
- On the sidebar element, add classes: `fixed inset-y-0 left-0 z-40 w-56 transform transition-transform md:relative md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`.
- Add a backdrop overlay when sidebar is open on mobile.

### Step 2: Audit overflow on key pages

**Files:** All page components in `packages/web/src/pages/`

Check each page for:
- Fixed widths that don't account for small screens (e.g., `w-[600px]` without a `max-w-full`).
- Tables that overflow — add `overflow-x-auto` wrappers.
- Flex layouts that don't wrap — add `flex-wrap` where needed.
- Padding/margins that are too large on mobile — use responsive variants like `p-4 md:p-8`.

### Step 3: Verify the search results grid

**File:** `packages/web/src/pages/SearchPage.tsx`

The grid (around line 154) already uses `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`, which is responsive. Verify the stream picker modal/dropdown fits on mobile screens.

### Verification

- Resize browser to phone width (375px) and tablet width (768px). No horizontal scrolling should occur on any page.
- Sidebar should collapse into a hamburger menu on mobile.

---

## Issue #6: Agent Heartbeat Reports RAM Instead of Disk Space

**Problem:** `ws-client.ts` imports `freemem` from `node:os` and sends it as `diskFreeBytes`. Should be actual disk free space.

### Step 1: Replace `freemem()` with disk space check

**File:** `packages/agent/src/ws-client.ts`

At the top of the file (line 2), `freemem` is imported:

```ts
import { platform, freemem } from "node:os";
```

Remove `freemem` from this import. Add a new import and helper function using Node's `fs.statfs` (available since Node 18.15):

```ts
import { statfs } from "node:fs/promises";
```

Add a helper function:

```ts
async function getDiskFreeBytes(dirPath: string): Promise<number> {
  try {
    const stats = await statfs(dirPath);
    return stats.bavail * stats.bsize;
  } catch {
    return 0;
  }
}
```

The function needs the configured media directory path. The `WsClient` class needs access to the agent's config to know which directory to check. Find the `WsClient` constructor and add a `mediaDir: string` parameter (or pass it from wherever the config is loaded).

### Step 2: Update `sendHello()` and `sendHeartbeat()` to use disk space

**File:** `packages/agent/src/ws-client.ts`

Both methods (around lines 105–117 and 119–130) currently have:

```ts
diskFreeBytes: freemem(),
```

Since `getDiskFreeBytes()` is async, these methods need to become async (or pre-fetch the value). The simplest approach: make both methods async and await the disk check:

```ts
diskFreeBytes: await getDiskFreeBytes(this.mediaDir),
```

Update the callers of `sendHello()` and `sendHeartbeat()` to handle the async change (add `await` or `.catch()`). The heartbeat is likely called from a `setInterval`, so wrap it:

```ts
setInterval(() => { this.sendHeartbeat().catch(() => {}); }, interval);
```

### Step 3: Pass the media directory to WsClient

Find where `WsClient` is instantiated (likely in the agent's main entry point or `index.ts`). Pass the configured movies directory (or TV directory — either works, they're typically on the same volume):

```ts
const wsClient = new WsClient({
  ...existingOptions,
  mediaDir: config.directories.movies || config.directories.tv,
});
```

### Verification

- `pnpm typecheck` passes.
- The heartbeat should now report actual free disk space in bytes, not RAM.

---

## Issue #7: Download Queue Delivers Payloads Without Validation

**Problem:** `deliverQueuedDownloads()` in `queue.ts` (line 94) sends `entry.payload` directly to agents via `agent.ws.send(JSON.stringify(entry.payload))` without validating against the message schema.

### Step 1: Validate queued payloads before delivery

**File:** `packages/relay/src/ws/queue.ts`

Import the message schema at the top of the file:

```ts
import { messageSchema } from "@tadaima/shared/messages";
```

Find the delivery loop in `deliverQueuedDownloads()` (around lines 85–98). Before the `agent.ws.send()` call, add validation:

```ts
const parsed = messageSchema.safeParse(entry.payload);
if (!parsed.success) {
  // Mark as failed instead of delivering
  await db
    .update(downloadQueue)
    .set({ status: "failed" })
    .where(eq(downloadQueue.id, entry.id));

  broadcastToClients(
    profileId,
    JSON.stringify({
      id: createMessageId(),
      type: "error",
      timestamp: Date.now(),
      payload: {
        message: `Queued download expired or is invalid: ${entry.payload?.payload?.title ?? "Unknown"}`,
      },
    }),
  );
  continue;
}

agent.ws.send(JSON.stringify(parsed.data));
```

Use `parsed.data` (the validated + stripped message) instead of the raw `entry.payload`.

### Step 2: Add "failed" to queue status handling

Check if the existing queue status logic handles `"failed"` status. The `downloadQueue` table has a `status` TEXT column. Verify that the web UI's queue display doesn't break when it encounters a `"failed"` status — it may need to filter these out or display them with an error indicator.

### Verification

- `pnpm typecheck` passes.
- Queued downloads with valid payloads should deliver normally.
- Queued downloads with invalid payloads should be marked as failed and the user should see an error message.

---

## Issue #8: Admin Panel Has Generic Error Handling

**Problem:** `AdminPanel.tsx` `loadData()` (around line 56) wraps `Promise.all()` in a single catch block. If profiles or settings fails, the user gets "Failed to load data" with no detail.

### Step 1: Use `Promise.allSettled()` with specific error messages

**File:** `packages/web/src/pages/AdminPanel.tsx`

Find the `loadData()` function (around line 56):

```ts
async function loadData() {
  try {
    const [p, s] = await Promise.all([
      api.profiles.list(),
      api.settings.get(adminToken!),
    ]);
    setProfiles(p);
    setSettings(s);
  } catch {
    addToast("error", "Failed to load data");
  }
}
```

Replace with:

```ts
async function loadData() {
  const [profilesResult, settingsResult] = await Promise.allSettled([
    api.profiles.list(),
    api.settings.get(adminToken!),
  ]);

  if (profilesResult.status === "fulfilled") {
    setProfiles(profilesResult.value);
  } else {
    addToast("error", "Failed to load profiles");
  }

  if (settingsResult.status === "fulfilled") {
    setSettings(settingsResult.value);
  } else {
    addToast("error", "Failed to load settings");
  }
}
```

### Verification

- `pnpm typecheck` passes.
- If the profiles endpoint fails, settings should still load (and vice versa).
- Each failure shows a specific toast message.
