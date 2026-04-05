# Phase 7: Real-Time UI — Detailed Spec

> **Goal**: The web app displays live download progress, a queued downloads section, download history, toast notifications, and polished settings—bringing the full loop from "click download" to "see it complete" entirely within the browser. Users can watch downloads progress in real time, manage queued downloads when devices are offline, and access their download history with filtering and retry functionality.

---

## 1. Overview

Phase 7 delivers five interconnected systems:

1. **Downloads Page** — Real-time display of active downloads with live progress, queued downloads, and historical entries
2. **Relay Download History Service** — HTTP API for storing and retrieving download records
3. **Toast Notification System** — Context-aware notifications for download lifecycle events
4. **Settings Page** — Profile management, PIN changes, and instance information
5. **Zustand Store Updates** — State management for all download-related data

---

## 2. Zustand Store Structure

### 2.1 Store Definition

Create `packages/web/src/store/downloadsStore.ts`:

```typescript
import { create } from "zustand";
import type { DownloadProgress, DownloadCompleted, DownloadFailed, DownloadQueued, DownloadAccepted } from "@tadaima/shared";

export type ActiveDownload = {
  jobId: string;
  requestId: string;
  title: string;
  mediaType: "movie" | "tv";
  deviceName: string;
  phase: "adding" | "waiting" | "unrestricting" | "downloading" | "organizing";
  progress: number; // 0-100
  downloadedBytes?: number;
  totalBytes?: number;
  speedBps?: number; // bytes per second
  eta?: number; // seconds remaining
  startedAt: number; // unix ms
};

export type QueuedDownload = {
  queueId: string;
  requestId: string;
  title: string;
  mediaType: "movie" | "tv";
  deviceName: string;
  queuedAt: number; // unix ms
  season?: number;
  episode?: number;
  episodeTitle?: string;
};

export type HistoryDownload = {
  id: string;
  title: string;
  mediaType: "movie" | "tv";
  deviceName: string;
  size: number; // bytes
  status: "completed" | "failed" | "cancelled";
  completedAt: number; // unix ms
  error?: string;
  retryable?: boolean;
  magnet?: string; // magnet link for retry
  torrentName?: string; // torrent name for retry
  expectedSize?: number; // expected file size for retry (bytes)
  season?: number;
  episode?: number;
};

export interface DownloadsState {
  // Active downloads
  activeDownloads: Record<string, ActiveDownload>;
  addActiveDownload: (download: ActiveDownload) => void;
  updateActiveDownload: (jobId: string, updates: Partial<ActiveDownload>) => void;
  removeActiveDownload: (jobId: string) => void;

  // Queued downloads
  queuedDownloads: Record<string, QueuedDownload>;
  addQueuedDownload: (download: QueuedDownload) => void;
  removeQueuedDownload: (queueId: string) => void;

  // History
  downloadHistory: HistoryDownload[];
  addHistoryEntry: (entry: HistoryDownload) => void;
  removeHistoryEntry: (id: string) => void;
  setHistory: (history: HistoryDownload[]) => void;

  // Helpers
  getActiveCount: () => number;
  getQueuedCount: () => number;
  getCompletedCount: () => number;
  getFailedCount: () => number;
}

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  activeDownloads: {},
  addActiveDownload: (download) =>
    set((state) => ({
      activeDownloads: {
        ...state.activeDownloads,
        [download.jobId]: download,
      },
    })),
  updateActiveDownload: (jobId, updates) =>
    set((state) => ({
      activeDownloads: {
        ...state.activeDownloads,
        [jobId]: {
          ...state.activeDownloads[jobId],
          ...updates,
        },
      },
    })),
  removeActiveDownload: (jobId) =>
    set((state) => {
      const { [jobId]: _, ...rest } = state.activeDownloads;
      return { activeDownloads: rest };
    }),

  queuedDownloads: {},
  addQueuedDownload: (download) =>
    set((state) => ({
      queuedDownloads: {
        ...state.queuedDownloads,
        [download.queueId]: download,
      },
    })),
  removeQueuedDownload: (queueId) =>
    set((state) => {
      const { [queueId]: _, ...rest } = state.queuedDownloads;
      return { queuedDownloads: rest };
    }),

  downloadHistory: [],
  addHistoryEntry: (entry) =>
    set((state) => ({
      downloadHistory: [entry, ...state.downloadHistory],
    })),
  removeHistoryEntry: (id) =>
    set((state) => ({
      downloadHistory: state.downloadHistory.filter((e) => e.id !== id),
    })),
  setHistory: (history) => set({ downloadHistory: history }),

  getActiveCount: () => Object.keys(get().activeDownloads).length,
  getQueuedCount: () => Object.keys(get().queuedDownloads).length,
  getCompletedCount: () =>
    get().downloadHistory.filter((e) => e.status === "completed").length,
  getFailedCount: () =>
    get().downloadHistory.filter((e) => e.status === "failed").length,
}));
```

### 2.2 WebSocket → Store Integration

Create `packages/web/src/lib/wsIntegration.ts`:

```typescript
import { useDownloadsStore } from "../store/downloadsStore";
import type {
  DownloadProgress,
  DownloadCompleted,
  DownloadFailed,
  DownloadQueued,
  DownloadAccepted,
} from "@tadaima/shared";

type WsMessage =
  | { type: "download:accepted"; payload: any }
  | { type: "download:progress"; payload: DownloadProgress["payload"] }
  | { type: "download:completed"; payload: DownloadCompleted["payload"] }
  | { type: "download:failed"; payload: DownloadFailed["payload"] }
  | { type: "download:queued"; payload: DownloadQueued["payload"] };

export function handleDownloadMessage(message: WsMessage) {
  const store = useDownloadsStore.getState();

  switch (message.type) {
    case "download:accepted": {
      const { jobId, requestId } = message.payload;
      // Create placeholder active download (details come from progress events)
      store.addActiveDownload({
        jobId,
        requestId,
        title: "", // Will be filled by first progress event
        mediaType: "movie",
        deviceName: "",
        phase: "adding",
        progress: 0,
        startedAt: Date.now(),
      });
      break;
    }

    case "download:progress": {
      const { jobId, phase, progress, downloadedBytes, totalBytes, speedBps, eta } = message.payload;
      store.updateActiveDownload(jobId, {
        phase,
        progress,
        downloadedBytes,
        totalBytes,
        speedBps,
        eta,
      });
      break;
    }

    case "download:completed": {
      const { jobId, filePath, finalSize } = message.payload;
      const active = store.activeDownloads[jobId];
      if (active) {
        store.removeActiveDownload(jobId);
        store.addHistoryEntry({
          id: jobId,
          title: active.title,
          mediaType: active.mediaType,
          deviceName: active.deviceName,
          size: finalSize,
          status: "completed",
          completedAt: Date.now(),
        });
      }
      break;
    }

    case "download:failed": {
      const { jobId, error, phase, retryable } = message.payload;
      const active = store.activeDownloads[jobId];
      if (active) {
        store.removeActiveDownload(jobId);
        store.addHistoryEntry({
          id: jobId,
          title: active.title,
          mediaType: active.mediaType,
          deviceName: active.deviceName,
          size: 0,
          status: "failed",
          completedAt: Date.now(),
          error,
          retryable,
        });
      }
      break;
    }

    case "download:queued": {
      const { queueId, requestId, title, deviceName } = message.payload;
      store.addQueuedDownload({
        queueId,
        requestId,
        title,
        deviceName,
        mediaType: "movie", // Will be enriched from context
        queuedAt: Date.now(),
      });
      break;
    }
  }
}
```

---

## 3. Downloads Page

### 3.1 Page Component

Create `packages/web/src/pages/DownloadsPage.tsx`:

```typescript
import React, { useState, useEffect } from "react";
import { useDownloadsStore } from "../store/downloadsStore";
import { ActiveDownloadCard } from "../components/downloads/ActiveDownloadCard";
import { QueuedDownloadCard } from "../components/downloads/QueuedDownloadCard";
import { HistoryDownloadCard } from "../components/downloads/HistoryDownloadCard";

type FilterTab = "all" | "active" | "queued" | "completed" | "failed";

export function DownloadsPage() {
  const [selectedTab, setSelectedTab] = useState<FilterTab>("all");
  const {
    activeDownloads,
    queuedDownloads,
    downloadHistory,
    getActiveCount,
    getQueuedCount,
    getCompletedCount,
    getFailedCount,
  } = useDownloadsStore();

  // Load history from API on mount
  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    try {
      const res = await fetch("/api/downloads?limit=50&offset=0");
      if (!res.ok) return;
      const data = await res.json();
      useDownloadsStore.getState().setHistory(data.entries);
    } catch (err) {
      console.error("Failed to load download history:", err);
    }
  }

  const activeList = Object.values(activeDownloads);
  const queuedList = Object.values(queuedDownloads);
  const completedList = downloadHistory.filter((e) => e.status === "completed");
  const failedList = downloadHistory.filter((e) => e.status === "failed");

  const filteredActive =
    selectedTab === "all" || selectedTab === "active" ? activeList : [];
  const filteredQueued =
    selectedTab === "all" || selectedTab === "queued" ? queuedList : [];
  const filteredCompleted =
    selectedTab === "all" || selectedTab === "completed" ? completedList : [];
  const filteredFailed = selectedTab === "all" || selectedTab === "failed" ? failedList : [];

  const hasDownloads =
    filteredActive.length > 0 ||
    filteredQueued.length > 0 ||
    filteredCompleted.length > 0 ||
    filteredFailed.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-10">
      <h1 className="text-2xl font-bold mb-6">Downloads</h1>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-6 bg-[#1a1a1a] rounded-lg p-1 w-fit">
        <FilterTab
          label="All"
          isActive={selectedTab === "all"}
          count={getActiveCount() + getQueuedCount() + getCompletedCount() + getFailedCount()}
          onClick={() => setSelectedTab("all")}
        />
        <FilterTab
          label="Active"
          isActive={selectedTab === "active"}
          count={getActiveCount()}
          onClick={() => setSelectedTab("active")}
        />
        <FilterTab
          label="Queued"
          isActive={selectedTab === "queued"}
          count={getQueuedCount()}
          onClick={() => setSelectedTab("queued")}
        />
        <FilterTab
          label="Completed"
          isActive={selectedTab === "completed"}
          count={getCompletedCount()}
          onClick={() => setSelectedTab("completed")}
        />
        <FilterTab
          label="Failed"
          isActive={selectedTab === "failed"}
          count={getFailedCount()}
          onClick={() => setSelectedTab("failed")}
        />
      </div>

      {/* Empty State */}
      {!hasDownloads && (
        <div className="text-center py-12">
          <p className="text-[#888] text-sm">
            No downloads yet. Search for something to get started.
          </p>
        </div>
      )}

      {/* Active Downloads */}
      {filteredActive.length > 0 && (
        <>
          <h2 className="text-xs font-semibold text-[#888] uppercase tracking-wide mb-3 mt-6">
            Active
          </h2>
          {filteredActive.map((dl) => (
            <ActiveDownloadCard key={dl.jobId} download={dl} />
          ))}
        </>
      )}

      {/* Queued Downloads */}
      {filteredQueued.length > 0 && (
        <>
          <h2 className="text-xs font-semibold text-[#888] uppercase tracking-wide mb-3 mt-6">
            Queued
          </h2>
          {filteredQueued.map((dl) => (
            <QueuedDownloadCard key={dl.queueId} download={dl} />
          ))}
        </>
      )}

      {/* History */}
      {(filteredCompleted.length > 0 || filteredFailed.length > 0) && (
        <>
          <h2 className="text-xs font-semibold text-[#888] uppercase tracking-wide mb-3 mt-6">
            History
          </h2>
          {filteredCompleted.map((dl) => (
            <HistoryDownloadCard key={dl.id} entry={dl} />
          ))}
          {filteredFailed.map((dl) => (
            <HistoryDownloadCard key={dl.id} entry={dl} />
          ))}
        </>
      )}
    </div>
  );
}

function FilterTab({
  label,
  isActive,
  count,
  onClick,
}: {
  label: string;
  isActive: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
        isActive
          ? "bg-[#242424] text-[#e0e0e0]"
          : "bg-transparent text-[#888] hover:text-[#ccc]"
      }`}
    >
      {label}{" "}
      <span
        className={`text-xs ml-1 px-2 py-0.5 rounded ${
          isActive ? "bg-[#6366f130] text-[#a5b4fc]" : "bg-[#333] text-[#999]"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
```

### 3.2 Active Download Card

Create `packages/web/src/components/downloads/ActiveDownloadCard.tsx`:

```typescript
import React, { useState } from "react";
import type { ActiveDownload } from "../../store/downloadsStore";
import { formatBytes, formatSpeed, formatEta } from "../../lib/format";

const PHASE_ORDER = ["adding", "waiting", "unrestricting", "downloading", "organizing"] as const;
const PHASE_LABELS: Record<typeof PHASE_ORDER[number], string> = {
  adding: "Adding to RD",
  waiting: "Waiting",
  unrestricting: "Unrestricting",
  downloading: "Downloading",
  organizing: "Organizing",
};

export function ActiveDownloadCard({ download }: { download: ActiveDownload }) {
  const [isHovering, setIsHovering] = useState(false);

  const currentPhaseIndex = PHASE_ORDER.indexOf(download.phase);

  async function handleCancel() {
    // Send download:cancel via WebSocket
    // This will be handled by the WebSocket client connection
    const ws = (window as any).__tadaimaWs;
    if (ws) {
      ws.send(
        JSON.stringify({
          type: "download:cancel",
          payload: { jobId: download.jobId },
        })
      );
    }
  }

  return (
    <div
      className="bg-[#1a1a1a] border border-[#333] rounded-lg p-4 mb-3 transition-all"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{download.title}</span>
          <span className="badge badge-movie">
            {download.mediaType === "movie" ? "Movie" : "TV"}
          </span>
          <span className="badge badge-device">{download.deviceName}</span>
        </div>
        {isHovering && (
          <button
            onClick={handleCancel}
            className="px-3 py-1 text-xs border border-[#333] rounded-md text-[#888] hover:border-red-500 hover:text-red-500 transition-all"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Phase Stepper */}
      <div className="flex items-center gap-1 mb-2 text-xs">
        {PHASE_ORDER.map((phase, idx) => (
          <React.Fragment key={phase}>
            <span
              className={`px-2 py-1 rounded transition-all ${
                idx < currentPhaseIndex
                  ? "text-[#22c55e]"
                  : idx === currentPhaseIndex
                    ? "text-[#eab308] font-semibold"
                    : "text-[#555]"
              }`}
            >
              {PHASE_LABELS[phase]}
            </span>
            {idx < PHASE_ORDER.length - 1 && <span className="text-[#333]">›</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Progress Bar */}
      <div className="mb-2">
        <div className="w-full h-1.5 bg-[#242424] rounded overflow-hidden">
          <div
            className="h-full bg-[#6366f1] rounded transition-all duration-300"
            style={{ width: `${download.progress}%` }}
          />
        </div>
      </div>

      {/* Progress Text & Stats */}
      <div className="flex items-center justify-between text-xs text-[#aaa]">
        <span className="font-semibold text-[#e0e0e0]">{download.progress}%</span>
        <div className="flex gap-3">
          {download.speedBps && (
            <span>{formatSpeed(download.speedBps)}</span>
          )}
          {download.eta && (
            <span>ETA {formatEta(download.eta)}</span>
          )}
        </div>
      </div>

      {/* Size info if available */}
      {download.totalBytes && (
        <div className="text-xs text-[#777] mt-1">
          {formatBytes(download.downloadedBytes || 0)} / {formatBytes(download.totalBytes)}
        </div>
      )}
    </div>
  );
}
```

### 3.3 Queued Download Card

Create `packages/web/src/components/downloads/QueuedDownloadCard.tsx`:

```typescript
import React, { useState } from "react";
import type { QueuedDownload } from "../../store/downloadsStore";
import { formatTimeAgo, hoursAgo } from "../../lib/format";
import { useToastStore } from "../../store/toastStore";

export function QueuedDownloadCard({ download }: { download: QueuedDownload }) {
  const [isHovering, setIsHovering] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const queuedHours = hoursAgo(download.queuedAt);
  const isStale = queuedHours > 7 * 24; // More than 7 days

  async function handleCancel() {
    try {
      const res = await fetch(`/api/downloads/${download.queueId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        addToast({
          type: "error",
          message: "Failed to cancel queued download",
          duration: 5000,
        });
        return;
      }
      // UI update handled by store
      addToast({
        type: "info",
        message: `Cancelled: ${download.title}`,
        duration: 3000,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: "Failed to cancel queued download",
        duration: 5000,
      });
    }
  }

  return (
    <div
      className="bg-[#1a1a1a] border border-[#333] rounded-lg p-4 mb-3 transition-all"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{download.title}</span>
          <span className="badge badge-device">{download.deviceName}</span>
        </div>
        {isHovering && (
          <button
            onClick={handleCancel}
            className="px-3 py-1 text-xs border border-[#333] rounded-md text-[#888] hover:border-red-500 hover:text-red-500 transition-all"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="text-xs text-[#888]">
        Queued {formatTimeAgo(download.queuedAt)}
      </div>

      {isStale && (
        <div className="text-xs text-[#fbbf24] mt-2 flex items-center gap-1">
          <span>⚠️</span>
          <span>Queued for {queuedHours / 24 | 0}d — content may need re-caching</span>
        </div>
      )}
    </div>
  );
}
```

### 3.4 History Download Card

Create `packages/web/src/components/downloads/HistoryDownloadCard.tsx`:

```typescript
import React, { useState } from "react";
import type { HistoryDownload } from "../../store/downloadsStore";
import { formatBytes, formatTimeAgo } from "../../lib/format";
import { useToastStore } from "../../store/toastStore";
import { useDownloadsStore } from "../../store/downloadsStore";

export function HistoryDownloadCard({ entry }: { entry: HistoryDownload }) {
  const [isHovering, setIsHovering] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const removeHistoryEntry = useDownloadsStore((s) => s.removeHistoryEntry);

  const statusColor = {
    completed: "bg-[#22c55e30] text-[#86efac]",
    failed: "bg-[#ef444430] text-[#fca5a5]",
    cancelled: "bg-[#eab30830] text-[#fde68a]",
  }[entry.status];

  const statusLabel = {
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  }[entry.status];

  async function handleRetry() {
    // Re-trigger the download using stored metadata (magnet, torrentName, expectedSize)
    const ws = (window as any).__tadaimaWs;
    if (ws && entry.retryable && entry.magnet && entry.torrentName) {
      ws.send(
        JSON.stringify({
          type: "download:request",
          payload: {
            // Use stored metadata from history for seamless retry without re-searching
            title: entry.title,
            mediaType: entry.mediaType,
            magnet: entry.magnet,
            torrentName: entry.torrentName,
            expectedSize: entry.expectedSize,
            season: entry.season,
            episode: entry.episode,
          },
        })
      );
      addToast({
        type: "info",
        message: `Retrying: ${entry.title}`,
        duration: 3000,
      });
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/downloads/${entry.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        addToast({
          type: "error",
          message: "Failed to delete history entry",
          duration: 5000,
        });
        return;
      }
      removeHistoryEntry(entry.id);
      addToast({
        type: "info",
        message: "Deleted from history",
        duration: 3000,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: "Failed to delete history entry",
        duration: 5000,
      });
    }
  }

  return (
    <div
      className="bg-[#1a1a1a] border border-[#333] rounded-lg p-4 mb-3 transition-all"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{entry.title}</span>
          <span className={`badge ${statusColor}`}>{statusLabel}</span>
          <span className="badge badge-device">{entry.deviceName}</span>
        </div>
        {isHovering && (
          <div className="flex gap-2">
            {entry.status === "failed" && entry.retryable && (
              <button
                onClick={handleRetry}
                className="px-3 py-1 text-xs border border-[#333] rounded-md text-[#a5b4fc] hover:bg-[#6366f120] transition-all"
              >
                Retry
              </button>
            )}
            <button
              onClick={handleDelete}
              className="px-3 py-1 text-xs border border-[#333] rounded-md text-[#888] hover:border-red-500 hover:text-red-500 transition-all"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-[#888]">
        <span>{formatBytes(entry.size)}</span>
        <span>{formatTimeAgo(entry.completedAt)}</span>
      </div>

      {entry.status === "failed" && entry.error && (
        <div className="text-xs text-[#fca5a5] mt-2">{entry.error}</div>
      )}
    </div>
  );
}
```

---

## 4. Toast Notification System

### 4.1 Toast Store

Create `packages/web/src/store/toastStore.ts`:

```typescript
import { create } from "zustand";
import { ulid } from "ulidx";

export type Toast = {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  duration: number; // milliseconds
  dismissible: boolean;
};

export interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = ulid();
    set((state) => ({
      toasts: [{ ...toast, id, dismissible: true }, ...state.toasts],
    }));

    // Auto-dismiss after duration
    if (toast.duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, toast.duration);
    }
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
```

### 4.2 Toast Container

Create `packages/web/src/components/ToastContainer.tsx`:

```typescript
import React from "react";
import { useToastStore } from "../store/toastStore";
import { Toast } from "./Toast";

export function ToastContainer() {
  const { toasts } = useToastStore();

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
```

### 4.3 Toast Component

Create `packages/web/src/components/Toast.tsx`:

```typescript
import React, { useEffect } from "react";
import type { Toast } from "../store/toastStore";
import { useToastStore } from "../store/toastStore";

const COLORS = {
  success: "bg-[#22c55e20] border-[#22c55e] text-[#86efac]",
  error: "bg-[#ef444420] border-[#ef4444] text-[#fca5a5]",
  info: "bg-[#3b82f620] border-[#3b82f6] text-[#93c5fd]",
};

const ICONS = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

export function Toast({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div
      className={`border rounded-lg px-4 py-3 flex items-center gap-3 pointer-events-auto shadow-lg animate-in fade-in slide-in-from-bottom-2 ${COLORS[toast.type]}`}
    >
      <span className="font-bold">{ICONS[toast.type]}</span>
      <span className="text-sm flex-1">{toast.message}</span>
      {toast.dismissible && (
        <button
          onClick={() => removeToast(toast.id)}
          className="text-lg opacity-70 hover:opacity-100 transition-opacity"
        >
          ×
        </button>
      )}
    </div>
  );
}
```

### 4.4 WebSocket → Toast Integration

Add to `packages/web/src/lib/wsIntegration.ts`:

```typescript
// Update handleDownloadMessage to trigger toasts:

case "download:accepted": {
  const { jobId, requestId } = message.payload;
  const store = useDownloadsStore.getState();
  store.addActiveDownload({
    jobId,
    requestId,
    title: "", // Will be filled by first progress event
    mediaType: "movie",
    deviceName: "",
    phase: "adding",
    progress: 0,
    startedAt: Date.now(),
  });

  // Toast notification
  useToastStore.getState().addToast({
    type: "info",
    message: "Download started",
    duration: 5000,
  });
  break;
}

case "download:completed": {
  const { jobId, filePath, finalSize } = message.payload;
  const store = useDownloadsStore.getState();
  const active = store.activeDownloads[jobId];
  if (active) {
    store.removeActiveDownload(jobId);
    store.addHistoryEntry({
      id: jobId,
      title: active.title,
      mediaType: active.mediaType,
      deviceName: active.deviceName,
      size: finalSize,
      status: "completed",
      completedAt: Date.now(),
    });

    // Toast: ただいま
    useToastStore.getState().addToast({
      type: "success",
      message: `ただいま — ${active.title} has arrived`,
      duration: 5000,
    });
  }
  break;
}

case "download:failed": {
  const { jobId, error, phase, retryable } = message.payload;
  const store = useDownloadsStore.getState();
  const active = store.activeDownloads[jobId];
  if (active) {
    store.removeActiveDownload(jobId);
    store.addHistoryEntry({
      id: jobId,
      title: active.title,
      mediaType: active.mediaType,
      deviceName: active.deviceName,
      size: 0,
      status: "failed",
      completedAt: Date.now(),
      error,
      retryable,
    });

    // Toast: error
    useToastStore.getState().addToast({
      type: "error",
      message: `Download failed: ${active.title} — ${error}`,
      duration: 5000,
    });
  }
  break;
}

case "download:queued": {
  const { queueId, requestId, title, deviceName } = message.payload;
  const store = useDownloadsStore.getState();
  store.addQueuedDownload({
    queueId,
    requestId,
    title,
    deviceName,
    mediaType: "movie",
    queuedAt: Date.now(),
  });

  // Toast
  useToastStore.getState().addToast({
    type: "info",
    message: `Queued: ${title} — will download when ${deviceName} is online`,
    duration: 5000,
  });
  break;
}
```

---

## 5. Settings Page

### 5.1 Settings Page Component

Create `packages/web/src/pages/SettingsPage.tsx`:

```typescript
import React, { useState, useEffect } from "react";
import { useToastStore } from "../store/toastStore";

export function SettingsPage() {
  const [profileName, setProfileName] = useState("");
  const [pinValue, setPinValue] = useState("");
  const [hasPin, setHasPin] = useState(false);
  const [relayVersion, setRelayVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to load profile");
      const data = await res.json();
      setProfileName(data.name);
      setHasPin(!!data.hasPin);

      const versionRes = await fetch("/api/version");
      if (versionRes.ok) {
        const versionData = await versionRes.json();
        setRelayVersion(versionData.version);
      }

      setLoading(false);
    } catch (err) {
      console.error(err);
      addToast({
        type: "error",
        message: "Failed to load settings",
        duration: 5000,
      });
      setLoading(false);
    }
  }

  async function handlePinChange() {
    if (!pinValue || pinValue.length < 4) {
      addToast({
        type: "error",
        message: "PIN must be at least 4 characters",
        duration: 5000,
      });
      return;
    }

    try {
      const res = await fetch("/api/profile/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPin: pinValue }),
      });
      if (!res.ok) throw new Error("Failed to update PIN");

      setPinValue("");
      setHasPin(true);
      addToast({
        type: "success",
        message: "PIN updated successfully",
        duration: 5000,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: "Failed to update PIN",
        duration: 5000,
      });
    }
  }

  async function handleRemovePin() {
    try {
      const res = await fetch("/api/profile/pin", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove PIN");

      setHasPin(false);
      addToast({
        type: "success",
        message: "PIN removed",
        duration: 5000,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: "Failed to remove PIN",
        duration: 5000,
      });
    }
  }

  async function handleSwitchProfile() {
    // Navigate back to profile picker
    window.location.href = "/";
  }

  if (loading) {
    return (
      <div className="flex-1 p-10 flex items-center justify-center">
        <p className="text-[#888]">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-10">
      <h1 className="text-2xl font-bold mb-8">Settings</h1>

      {/* Profile Section */}
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-6 mb-6">
        <h2 className="text-sm font-semibold text-[#e0e0e0] mb-4">Profile</h2>
        <div className="mb-4">
          <label className="text-xs text-[#888] block mb-2">Profile Name</label>
          <div className="text-base font-medium text-[#e0e0e0]">{profileName}</div>
        </div>

        {/* PIN Section */}
        <div className="border-t border-[#333] pt-4">
          <label className="text-xs text-[#888] block mb-3">
            {hasPin ? "Change PIN" : "Set PIN"}
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="password"
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value)}
              placeholder="Enter new PIN (4+ digits)"
              className="flex-1 px-3 py-2 bg-[#242424] border border-[#333] rounded text-sm text-[#e0e0e0] placeholder-[#666] focus:outline-none focus:border-[#6366f1]"
            />
            <button
              onClick={handlePinChange}
              className="px-4 py-2 bg-[#6366f1] text-white text-sm rounded hover:bg-[#4f46e5] transition-all"
            >
              Update
            </button>
          </div>
          {hasPin && (
            <button
              onClick={handleRemovePin}
              className="text-xs text-[#888] hover:text-red-500 transition-all"
            >
              Remove PIN
            </button>
          )}
        </div>
      </div>

      {/* About Section */}
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-6 mb-6">
        <h2 className="text-sm font-semibold text-[#e0e0e0] mb-4">About</h2>
        <div className="text-xs text-[#888] space-y-3">
          <div>
            <p className="text-[#888]">Relay Server</p>
            <p className="text-[#e0e0e0] font-medium">v{relayVersion}</p>
          </div>
          <div>
            <a
              href="https://github.com/tadaima-app/tadaima"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#6366f1] hover:text-[#a5b4fc] transition-all"
            >
              GitHub Repository →
            </a>
          </div>
          <div className="text-[#777] text-xs">
            MIT License — Free and open source
          </div>
        </div>
      </div>

      {/* Switch Profile */}
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-6">
        <button
          onClick={handleSwitchProfile}
          className="w-full px-4 py-2 bg-[#242424] border border-[#333] text-[#e0e0e0] rounded hover:bg-[#333] transition-all text-sm"
        >
          Switch Profile
        </button>
      </div>
    </div>
  );
}
```

---

## 6. Relay Download History Service

### 6.1 Database Schema

Add to `packages/shared/src/schema.ts` (Drizzle schema from Phase 1):

```typescript
export const downloadHistoryTable = pgTable("download_history", {
  id: text("id").primaryKey(),
  profileId: text("profile_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name").notNull(),
  title: text("title").notNull(),
  mediaType: text("media_type", { enum: ["movie", "tv"] }).notNull(),
  season: integer("season"),
  episode: integer("episode"),
  tmdbId: integer("tmdb_id"),
  imdbId: text("imdb_id"),
  size: bigint("size", { mode: "number" }).notNull().default(0), // bytes
  status: text("status", { enum: ["completed", "failed", "cancelled"] })
    .notNull(),
  error: text("error"),
  retryable: boolean("retryable").default(false),
  magnet: text("magnet"), // magnet link for retry
  torrentName: text("torrent_name"), // torrent name for retry
  expectedSize: bigint("expected_size", { mode: "number" }), // expected file size for retry
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

### 6.2 HTTP Endpoints

Add to `packages/relay/src/routes/downloads.ts`:

```typescript
import { Hono } from "hono";
import { db } from "../db";
import { downloadHistoryTable } from "@tadaima/shared";
import { eq, desc, and } from "drizzle-orm";
import { verifyProfileToken } from "../middleware/auth";

const app = new Hono();

// GET /api/downloads — paginated history
app.get("/", verifyProfileToken, async (c) => {
  const profileId = c.get("profileId");
  const limit = parseInt(c.query("limit") || "50");
  const offset = parseInt(c.query("offset") || "0");
  const status = c.query("status"); // optional: completed | failed | cancelled

  let query = eq(downloadHistoryTable.profileId, profileId);
  if (status) {
    query = and(
      eq(downloadHistoryTable.profileId, profileId),
      eq(downloadHistoryTable.status, status as any)
    );
  }

  const entries = await db
    .select()
    .from(downloadHistoryTable)
    .where(query)
    .orderBy(desc(downloadHistoryTable.completedAt))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql`COUNT(*)` })
    .from(downloadHistoryTable)
    .where(query);

  return c.json({
    entries,
    total: countResult[0].count as number,
    limit,
    offset,
  });
});

// GET /api/downloads/:id — single entry
app.get("/:id", verifyProfileToken, async (c) => {
  const profileId = c.get("profileId");
  const id = c.param("id");

  const entry = await db
    .select()
    .from(downloadHistoryTable)
    .where(
      and(
        eq(downloadHistoryTable.id, id),
        eq(downloadHistoryTable.profileId, profileId)
      )
    )
    .limit(1);

  if (!entry.length) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(entry[0]);
});

// DELETE /api/downloads/:id — remove entry
app.delete("/:id", verifyProfileToken, async (c) => {
  const profileId = c.get("profileId");
  const id = c.param("id");

  const result = await db
    .delete(downloadHistoryTable)
    .where(
      and(
        eq(downloadHistoryTable.id, id),
        eq(downloadHistoryTable.profileId, profileId)
      )
    );

  return c.json({ success: true });
});

export default app;
```

### 6.3 Service Layer

Add to `packages/relay/src/services/downloadHistoryService.ts`:

```typescript
import { db } from "../db";
import { downloadHistoryTable } from "@tadaima/shared";

interface CreateHistoryEntry {
  profileId: string;
  deviceId: string;
  deviceName: string;
  title: string;
  mediaType: "movie" | "tv";
  season?: number;
  episode?: number;
  tmdbId?: number;
  imdbId?: string;
  size: number;
  status: "completed" | "failed" | "cancelled";
  error?: string;
  retryable?: boolean;
}

export async function createHistoryEntry(entry: CreateHistoryEntry) {
  return db.insert(downloadHistoryTable).values({
    id: ulid(),
    ...entry,
    completedAt: new Date(),
  });
}

export async function getProfileHistory(
  profileId: string,
  limit: number = 50,
  offset: number = 0
) {
  return db
    .select()
    .from(downloadHistoryTable)
    .where(eq(downloadHistoryTable.profileId, profileId))
    .orderBy(desc(downloadHistoryTable.completedAt))
    .limit(limit)
    .offset(offset);
}
```

---

## 7. WebSocket Event → UI Mapping

This table describes which WebSocket events trigger which UI updates and toast notifications:

| WebSocket Event | Zustand Store Update | Toast Notification | UI Effect |
|---|---|---|---|
| `download:accepted` | Add to `activeDownloads` | info: "Download started: {title}" | Active section appears with 0% |
| `download:progress` | Update `activeDownloads[jobId]` | None | Progress bar updates, speed/ETA shown |
| `download:completed` | Move from active → history | success: "ただいま — {title} has arrived" | Card animates to history section |
| `download:failed` | Move from active → history (failed) | error: "Download failed: {title} — {error}" | Card moves to history with red badge |
| `download:queued` | Add to `queuedDownloads` | info: "Queued: {title} — will download when {device} is online" | Queued section appears |
| `download:cancelled` | Remove from active, add to history | None | Card moves to history with yellow badge |
| `agent:heartbeat` | Update connection status | None | Sidebar status dot changes color |

---

## 8. Connection Status Indicator

### 8.1 Connection Status in Sidebar

Update `packages/web/src/components/Sidebar.tsx`:

```typescript
import { useConnectionStore } from "../store/connectionStore";

export function Sidebar() {
  const connectionStatus = useConnectionStore((s) => s.status);

  const statusColor = {
    connected: "bg-[#22c55e]",
    connecting: "bg-[#eab308]",
    disconnected: "bg-[#ef4444]",
  }[connectionStatus];

  return (
    <div className="sidebar">
      {/* ... existing content ... */}
      <div className="sidebar-footer">
        <div className={`w-2 h-2 rounded-full ${statusColor} animate-pulse`} />
        <span className="text-[#888] text-xs">
          {connectionStatus === "connected"
            ? "Connected"
            : connectionStatus === "connecting"
              ? "Connecting..."
              : "Offline"}
        </span>
      </div>
    </div>
  );
}
```

### 8.2 Connection Store

Create `packages/web/src/store/connectionStore.ts`:

```typescript
import { create } from "zustand";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

export interface ConnectionState {
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "disconnected",
  setStatus: (status) => set({ status }),
}));
```

---

## 9. Dark Theme Color Tokens

### 9.1 Tailwind Configuration

Add to `packages/web/tailwind.config.js`:

```javascript
export default {
  theme: {
    extend: {
      colors: {
        "tadaima-bg": "#0f0f0f",
        "tadaima-card": "#1a1a1a",
        "tadaima-border": "#333",
        "tadaima-hover": "#242424",
        "tadaima-text": "#e0e0e0",
        "tadaima-text-muted": "#888",
        "tadaima-accent": "#6366f1",
        "tadaima-accent-light": "#a5b4fc",
        "tadaima-success": "#22c55e",
        "tadaima-error": "#ef4444",
        "tadaima-warning": "#eab308",
      },
    },
  },
};
```

---

## 10. Sidebar Navigation Update

Update navigation to include Downloads and Settings:

```typescript
export const NAV_ITEMS = [
  { icon: "🔍", label: "Search", route: "/search", id: "search" },
  { icon: "📱", label: "Devices", route: "/devices", id: "devices" },
  { icon: "⬇️", label: "Downloads", route: "/downloads", id: "downloads" },
  { icon: "⚙️", label: "Settings", route: "/settings", id: "settings" },
];
```

---

## 11. API Integration & Fetch Utilities

### 11.1 Download API Client

Create `packages/web/src/api/downloadClient.ts`:

```typescript
export async function getDownloads(limit: number = 50, offset: number = 0) {
  const res = await fetch(`/api/downloads?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("Failed to fetch downloads");
  return res.json();
}

export async function getDownload(id: string) {
  const res = await fetch(`/api/downloads/${id}`);
  if (!res.ok) throw new Error("Failed to fetch download");
  return res.json();
}

export async function deleteDownload(id: string) {
  const res = await fetch(`/api/downloads/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete download");
  return res.json();
}

export async function retryDownload(jobId: string) {
  const res = await fetch(`/api/downloads/${jobId}/retry`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to retry download");
  return res.json();
}
```

---

## 12. Formatting Utilities

Create `packages/web/src/lib/format.ts`:

```typescript
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + "/s";
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}

export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function hoursAgo(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60));
}
```

---

## 13. Test Approach

### 13.1 Component Tests

Test locations: `packages/web/src/components/__tests__/`

Key test cases:
- **ActiveDownloadCard**: progress updates, phase transitions, cancel button, formatting of speed/ETA
- **QueuedDownloadCard**: stale warning display (>7 days), cancel functionality
- **HistoryDownloadCard**: status badge colors, retry button visibility (failed only), delete button
- **DownloadsPage**: filter tabs work, empty state, section headers

Example (Vitest + @testing-library/react):

```typescript
describe("ActiveDownloadCard", () => {
  it("shows progress bar and updates when progress changes", () => {
    const download = {
      jobId: "job-1",
      title: "Interstellar",
      progress: 45,
      speedBps: 2000000,
      eta: 300,
      // ... other fields
    };
    const { rerender } = render(<ActiveDownloadCard download={download} />);
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByText(/3.8 MB\/s/)).toBeInTheDocument();

    rerender(<ActiveDownloadCard download={{ ...download, progress: 75 }} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });
});
```

### 13.2 Store Tests

Test zustand store mutations, selectors, and integration with WebSocket messages.

### 13.3 E2E Tests (Playwright)

```typescript
test("download progress flows from active → history on completion", async ({
  page,
}) => {
  await page.goto("http://localhost:5173/downloads");

  // Verify active download card appears
  await expect(page.locator("text=Interstellar")).toBeVisible();
  await expect(page.locator("text=45%")).toBeVisible();

  // Simulate WebSocket completion event
  await page.evaluate(() => {
    const event = new MessageEvent("message", {
      data: JSON.stringify({
        type: "download:completed",
        payload: { jobId: "job-1", filePath: "/path", finalSize: 50000000 },
      }),
    });
    (window as any).__tadaimaWs?.dispatchEvent(event);
  });

  // Card should move to History
  await expect(page.locator("text=Completed")).toBeVisible();
  await expect(page.locator("text=ただいま")).toBeVisible();
});
```

---

## 14. Common Pitfalls

1. **Progress doesn't update** — WebSocket message handler not updating the store correctly. Verify `updateActiveDownload` is called with correct `jobId`.

2. **History doesn't load** — API call on mount not being made or auth token not included. Verify fetch headers include auth token from session.

3. **Toasts disappear too fast** — duration set too low. Default is 5000ms (5 seconds).

4. **Queued items don't show stale warning** — compare `Date.now() - queuedAt` to `7 * 24 * 60 * 60 * 1000` (7 days in milliseconds).

5. **Delete button doesn't work** — API endpoint not authenticated or delete handler in store not removing the item. Verify `removeHistoryEntry` is called after successful delete.

6. **Phase stepper shows wrong phases** — `PHASE_ORDER` array doesn't match server-side enum. Keep both in sync.

7. **Cancel button sends to wrong destination** — WebSocket client not properly initialized. Verify `window.__tadaimaWs` exists and is a valid WebSocket connection before calling `send()`.

8. **Connection status dot not updating** — WebSocket connection status events not being routed to `useConnectionStore`. Add handlers for `ws:connected`, `ws:disconnected` in the WebSocket client initialization.

---

## 15. Execution Order & Verification Checklist

### Phase 7 Execution Sequence

1. **Create Zustand stores** (downloadsStore.ts, toastStore.ts, connectionStore.ts) — 30 min
2. **Build Toast system** (ToastContainer, Toast component) — 20 min
3. **Implement DownloadsPage layout** (filter tabs, sections) — 30 min
4. **Build download cards** (Active, Queued, History) — 45 min
5. **Create SettingsPage** (profile, PIN, about) — 30 min
6. **Relay: Download history service** (schema, endpoints, service) — 45 min
7. **WebSocket → Store integration** (handleDownloadMessage) — 30 min
8. **WebSocket → Toast integration** — 20 min
9. **API client** (fetch utilities) — 20 min
10. **Sidebar updates** (connection dot, nav items) — 15 min
11. **Formatting utilities** (bytes, speed, time) — 15 min
12. **Write component tests** — 60 min
13. **Write E2E tests** (Playwright) — 60 min
14. **Integration testing** (manual) — 60 min

**Total estimated time**: 12-14 hours of focused development

### Verification Checklist

| # | Item | How to Verify | Status |
|---|------|---------------|--------|
| 1 | DownloadsPage renders | Navigate to /downloads → page loads | ☐ |
| 2 | Filter tabs work | Click each tab → cards filter correctly | ☐ |
| 3 | ActiveDownloadCard shows progress | Trigger download → progress bar fills | ☐ |
| 4 | Progress updates in real-time | Watch WebSocket events → progress updates without reload | ☐ |
| 5 | Phase stepper shows correct order | Monitor phases: Adding → Waiting → Unrestricting → Downloading → Organizing | ☐ |
| 6 | Speed/ETA displayed | Download active → speed and ETA shown and updating | ☐ |
| 7 | Cancel button works | Click cancel → download:cancel sent via WebSocket | ☐ |
| 8 | Queued downloads appear | Stop agent → trigger download → queued section shows card | ☐ |
| 9 | Stale warning shows | Queue download for >7 days → warning badge appears | ☐ |
| 10 | Queued → Active transition | Start agent → queued item moves to active with animation | ☐ |
| 11 | History loads on mount | Open downloads page → history entries appear (GET /api/downloads) | ☐ |
| 12 | Completed badge shows | Download finishes → "Completed" badge with green color | ☐ |
| 13 | Failed badge with error | Download fails → "Failed" badge with error message | ☐ |
| 14 | Retry button works | Click retry on failed → download:request sent | ☐ |
| 15 | Delete removes history | Click delete → entry removed from history (DELETE /api/downloads/:id) | ☐ |
| 16 | Toast: accepted | Start download → info toast "Download started: {title}" | ☐ |
| 17 | Toast: completed | Download finishes → success toast "ただいま — {title} has arrived" | ☐ |
| 18 | Toast: failed | Download fails → error toast "Download failed: {title} — {error}" | ☐ |
| 19 | Toast: queued | Agent offline, download requested → info toast "Queued: {title} — will download when..." | ☐ |
| 20 | Toast auto-dismiss | Toast appears → 5 seconds later → auto-dismisses | ☐ |
| 21 | Toast close button | Click X → toast dismisses immediately | ☐ |
| 22 | SettingsPage loads | Navigate to /settings → profile name displayed | ☐ |
| 23 | PIN change works | Enter PIN → click Update → success toast, PIN updated | ☐ |
| 24 | PIN remove works | Click "Remove PIN" → PIN removed | ☐ |
| 25 | About shows version | Settings page → relay version displayed | ☐ |
| 26 | Switch Profile works | Click "Switch Profile" → redirects to / (profile picker) | ☐ |
| 27 | Connection dot green | Agent connected → sidebar shows green dot | ☐ |
| 28 | Connection dot yellow | Connecting → sidebar shows yellow dot | ☐ |
| 29 | Connection dot red | Disconnected → sidebar shows red dot | ☐ |
| 30 | Dark theme consistency | All pages dark background (#0f0f0f), cards (#1a1a1a), accent indigo | ☐ |
| 31 | Relay history endpoints work | GET /api/downloads → paginated list, GET /api/downloads/:id → single, DELETE → remove | ☐ |
| 32 | API pagination | GET /api/downloads?limit=10&offset=0 → returns 10 entries | ☐ |
| 33 | History filters by status | GET /api/downloads?status=failed → only failed entries | ☐ |
| 34 | Component tests pass | `pnpm test` in packages/web → all tests pass | ☐ |
| 35 | E2E tests pass | Playwright tests for main flows | ☐ |
| 36 | No console errors | Browser devtools console → no errors or unhandled rejections | ☐ |
| 37 | Responsive design | Mobile and desktop layouts work (filter tabs, cards stack) | ☐ |

---

## 16. Decision Points

> **✅ RESOLVED**: Store full request metadata in the download history table (Option A). Add `magnet`, `torrentName`, and `expectedSize` columns to `download_history`. This enables seamless retry from the Retry button without requiring the user to re-search.

---

## 17. Files to Create/Modify

**New files:**
- `packages/web/src/store/downloadsStore.ts`
- `packages/web/src/store/toastStore.ts`
- `packages/web/src/store/connectionStore.ts`
- `packages/web/src/pages/DownloadsPage.tsx`
- `packages/web/src/pages/SettingsPage.tsx`
- `packages/web/src/components/downloads/ActiveDownloadCard.tsx`
- `packages/web/src/components/downloads/QueuedDownloadCard.tsx`
- `packages/web/src/components/downloads/HistoryDownloadCard.tsx`
- `packages/web/src/components/ToastContainer.tsx`
- `packages/web/src/components/Toast.tsx`
- `packages/web/src/lib/wsIntegration.ts` (update existing)
- `packages/web/src/lib/format.ts`
- `packages/web/src/api/downloadClient.ts`
- `packages/relay/src/routes/downloads.ts`
- `packages/relay/src/services/downloadHistoryService.ts`
- `packages/web/src/components/__tests__/ActiveDownloadCard.test.tsx`
- `packages/web/src/components/__tests__/DownloadsPage.test.tsx`
- `packages/web/src/store/__tests__/downloadsStore.test.ts`

**Modified files:**
- `packages/web/src/App.tsx` (add routes for Downloads, Settings; add ToastContainer)
- `packages/web/src/components/Sidebar.tsx` (add connection dot, add nav items)
- `packages/shared/src/schema.ts` (add downloadHistoryTable)
- `packages/relay/src/index.ts` (register /api/downloads routes)

---

## Summary

Phase 7 delivers a complete real-time downloads experience:

- **Active downloads** with live progress bars, phase indicators, speed, and ETA
- **Queued downloads** for offline devices with stale warnings
- **Download history** with completion/failure status and retry capability
- **Toast notifications** for all lifecycle events (started, completed with "ただいま", failed, queued)
- **Settings page** for profile PIN management
- **Connection status indicator** showing relay connectivity
- **Dark theme** throughout, matching design mockups

The system is built on a clean separation of concerns: zustand stores for state, WebSocket integration for real-time updates, HTTP API for history persistence, and React components for presentation. Tests cover component behavior, store mutations, and end-to-end flows.

