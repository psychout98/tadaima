import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { useAuthStore, type ActiveDownload } from "../lib/store";
import { wsClient } from "../lib/ws-client";

type Tab = "all" | "active" | "queued" | "completed" | "failed";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "queued", label: "Queued" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
];

const PHASE_LABELS: Record<string, string> = {
  adding: "Adding to RD",
  waiting: "Waiting for RD",
  unrestricting: "Unrestricting",
  downloading: "Downloading",
  organizing: "Organizing",
};

interface HistoryItem {
  id: string;
  title: string;
  mediaType: string;
  sizeBytes: number | null;
  status: string;
  error: string | null;
  retryable: boolean | null;
  startedAt: string;
  completedAt: string | null;
  magnet?: string;
  torrentName?: string;
  tmdbId?: number;
  imdbId?: string;
  year?: number;
}

interface QueuedItem {
  id: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatSpeed(bps: number | undefined): string {
  if (!bps) return "";
  const mbps = bps / (1024 * 1024);
  return `${mbps.toFixed(1)} MB/s`;
}

function formatEta(seconds: number | undefined): string {
  if (!seconds) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DownloadsPage() {
  const { profileToken, activeDownloads } = useAuthStore();
  const [tab, setTab] = useState<Tab>("all");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [queued, setQueued] = useState<QueuedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!profileToken) return;
    try {
      const [h, q] = await Promise.all([
        api.downloads.list(profileToken),
        api.downloads.queue(profileToken),
      ]);
      setHistory(h);
      setQueued(q);
    } finally {
      setLoading(false);
    }
  }, [profileToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh history when active downloads complete
  useEffect(() => {
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  function handleCancel(jobId: string) {
    wsClient.send({
      id: `cancel-${Date.now()}`,
      type: "download:cancel",
      timestamp: Date.now(),
      payload: { jobId },
    });
  }

  async function handleCancelQueued(id: string) {
    if (!profileToken) return;
    await api.downloads.cancelQueued(id, profileToken);
    loadData();
  }

  async function handleDeleteHistory(id: string) {
    if (!profileToken) return;
    await api.downloads.deleteHistory(id, profileToken);
    loadData();
  }

  const activeList = Array.from(activeDownloads.values());

  const showActive = tab === "all" || tab === "active";
  const showQueued = tab === "all" || tab === "queued";
  const showHistory = tab === "all" || tab === "completed" || tab === "failed";

  const filteredHistory = tab === "completed"
    ? history.filter((h) => h.status === "completed")
    : tab === "failed"
      ? history.filter((h) => h.status === "failed")
      : history;

  if (loading) return <p className="text-zinc-400">Loading...</p>;

  const isEmpty =
    activeList.length === 0 && queued.length === 0 && history.length === 0;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Downloads</h1>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 rounded-lg bg-zinc-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            data-testid={`tab-${t.key}`}
            data-state={tab === t.key ? "active" : "inactive"}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            {t.label}
            {t.key === "active" && activeList.length > 0 && (
              <span className="ml-1.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px]">
                {activeList.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {isEmpty && (
        <div data-testid="downloads-empty" className="rounded-lg bg-zinc-900 p-8 text-center">
          <p className="text-zinc-400">No downloads yet.</p>
          <p className="mt-1 text-sm text-zinc-500">
            Search for something to get started.
          </p>
        </div>
      )}

      {/* Active downloads */}
      {showActive && activeList.length > 0 && (
        <section data-testid="active-downloads" className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Active</h2>
          <div className="space-y-3">
            {activeList.map((dl) => (
              <ActiveCard key={dl.jobId} download={dl} onCancel={handleCancel} />
            ))}
          </div>
        </section>
      )}

      {/* Queued downloads */}
      {showQueued && queued.length > 0 && (
        <section data-testid="queued-downloads" className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Queued</h2>
          <div className="space-y-2">
            {queued.map((q) => {
              const payload = (q.payload as { payload?: { title?: string } })?.payload ?? q.payload;
              const title = (payload as { title?: string }).title ?? "Unknown";
              const daysOld = (Date.now() - new Date(q.createdAt).getTime()) / (1000 * 60 * 60 * 24);
              return (
                <div
                  key={q.id}
                  className="flex items-center justify-between rounded-lg bg-zinc-900 p-4"
                >
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-zinc-500">
                      Queued {timeAgo(q.createdAt)}
                    </p>
                    {daysOld > 7 && (
                      <p className="text-xs text-amber-400">
                        Content may need to be re-cached on RD
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleCancelQueued(q.id)}
                    className="text-xs text-zinc-500 hover:text-red-400"
                  >
                    Cancel
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* History */}
      {showHistory && filteredHistory.length > 0 && (
        <section data-testid="download-history">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">History</h2>
          <div className="space-y-2">
            {filteredHistory.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-lg bg-zinc-900 p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{h.title}</p>
                    <StatusBadge status={h.status} />
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{formatSize(h.sizeBytes)}</span>
                    <span>{timeAgo(h.completedAt ?? h.startedAt)}</span>
                  </div>
                  {h.error && (
                    <p className="mt-1 text-xs text-red-400">{h.error}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {h.status === "failed" && h.retryable && (
                    <button className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white">
                      Retry
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteHistory(h.id)}
                    className="text-xs text-zinc-500 hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ActiveCard({
  download,
  onCancel,
}: {
  download: ActiveDownload;
  onCancel: (jobId: string) => void;
}) {
  return (
    <div data-testid="active-download-card" className="rounded-lg bg-zinc-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{download.title}</p>
          <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {PHASE_LABELS[download.phase] ?? download.phase}
          </span>
        </div>
        <button
          data-testid="cancel-btn"
          onClick={() => onCancel(download.jobId)}
          className="text-xs text-zinc-500 hover:text-red-400"
        >
          Cancel
        </button>
      </div>

      {/* Progress bar */}
      <div className="mb-2 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          data-testid="progress-bar"
          className="h-full rounded-full bg-blue-500 transition-all duration-500"
          style={{ width: `${Math.min(download.progress, 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{Math.round(download.progress)}%</span>
        <div className="flex items-center gap-3">
          {download.speedBps != null && download.speedBps > 0 && (
            <span>{formatSpeed(download.speedBps)}</span>
          )}
          {download.eta != null && download.eta > 0 && (
            <span>ETA {formatEta(download.eta)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-emerald-500/20 text-emerald-300",
    failed: "bg-red-500/20 text-red-300",
    cancelled: "bg-amber-500/20 text-amber-300",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles[status] ?? "bg-zinc-700 text-zinc-300"}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
