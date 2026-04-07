import { useEffect } from "react";
import { Link, Outlet, useNavigate, useLocation, Navigate } from "react-router";
import { useAuthStore } from "../lib/store";
import { wsClient } from "../lib/ws-client";
import { Toasts } from "../components/Toasts";
import { messageSchema } from "@tadaima/shared";

const STATUS_CONFIG = {
  connected: { color: "bg-emerald-400", label: "Connected" },
  connecting: { color: "bg-amber-400", label: "Connecting..." },
  disconnected: { color: "bg-zinc-600", label: "Disconnected" },
} as const;

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    profile,
    profileToken,
    clearProfileSession,
    connectionStatus,
    setConnectionStatus,
    updateDeviceStatus,
    setActiveDownload,
    removeActiveDownload,
    addToast,
  } = useAuthStore();

  // Connect WebSocket and wire event handlers
  useEffect(() => {
    if (!profileToken) return;

    const unsubStatus = wsClient.onStatusChange(setConnectionStatus);
    const unsubMessage = wsClient.onMessage((msg) => {
      let parsed;
      try {
        parsed = messageSchema.safeParse(msg);
      } catch (err) {
        console.warn("[ws] Failed to validate message:", err);
        return;
      }

      if (!parsed.success) {
        console.warn("[ws] Invalid message received:", parsed.error.format());
        return;
      }

      const message = parsed.data;

      // Extra fields (e.g. _meta, title) may be attached by the relay but
      // are not part of the validated schema.  Access them safely from the
      // raw payload when needed.
      const raw = (msg as Record<string, unknown>).payload as
        | Record<string, unknown>
        | undefined;

      if (message.type === "device:status") {
        updateDeviceStatus(
          message.payload.deviceId,
          message.payload.isOnline,
          message.payload.lastSeenAt,
        );
      } else if (message.type === "download:accepted") {
        const title =
          typeof raw?.title === "string" ? raw.title : "Unknown";
        addToast("info", `Download started: ${title}`);
        setActiveDownload({
          jobId: message.payload.jobId,
          requestId: message.payload.requestId,
          title,
          mediaType: "",
          phase: "adding",
          progress: 0,
        });
      } else if (message.type === "download:progress") {
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
      } else if (message.type === "download:completed") {
        removeActiveDownload(message.payload.jobId);
        const meta =
          raw?._meta != null &&
          typeof raw._meta === "object" &&
          !Array.isArray(raw._meta)
            ? (raw._meta as Record<string, unknown>)
            : undefined;
        const title =
          typeof meta?.title === "string" ? meta.title : "Download";
        addToast("success", `ただいま — ${title} has arrived`);
      } else if (message.type === "download:failed") {
        removeActiveDownload(message.payload.jobId);
        const meta =
          raw?._meta != null &&
          typeof raw._meta === "object" &&
          !Array.isArray(raw._meta)
            ? (raw._meta as Record<string, unknown>)
            : undefined;
        const title =
          typeof meta?.title === "string" ? meta.title : "Download";
        addToast(
          "error",
          `Download failed: ${title} — ${message.payload.error}`,
        );
      } else if (message.type === "download:queued") {
        addToast(
          "info",
          `Queued: ${message.payload.title} — will download when ${message.payload.deviceName} is online`,
        );
      } else if (message.type === "download:rejected") {
        addToast("error", `Download rejected: ${message.payload.reason}`);
      }
    });

    wsClient.connect(() => useAuthStore.getState().profileToken!);

    return () => {
      wsClient.disconnect();
      unsubStatus();
      unsubMessage();
    };
  }, [
    profileToken,
    setConnectionStatus,
    updateDeviceStatus,
    setActiveDownload,
    removeActiveDownload,
    addToast,
  ]);

  if (!profile) {
    return <Navigate to="/profiles" replace />;
  }

  function handleSwitchProfile() {
    wsClient.disconnect();
    clearProfileSession();
    navigate("/profiles");
  }

  const status = STATUS_CONFIG[connectionStatus];

  return (
    <div className="flex min-h-screen bg-zinc-950 text-white">
      <Toasts />

      {/* Sidebar */}
      <aside data-testid="sidebar" className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-950">
        {/* Profile header */}
        <button
          onClick={handleSwitchProfile}
          className="flex items-center gap-3 border-b border-zinc-800 p-4 hover:bg-zinc-900"
        >
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
              profile.avatar ?? "bg-zinc-700"
            }`}
          >
            {profile.name[0]}
          </div>
          <div className="text-left">
            <p data-testid="profile-name" className="text-sm font-medium">{profile.name}</p>
            <p className="text-xs text-zinc-500">Switch profile</p>
          </div>
        </button>

        {/* Nav links */}
        <nav className="flex-1 p-3">
          <NavLink to="/" label="Search" active={location.pathname === "/"} testId="nav-search" />
          <NavLink
            to="/downloads"
            label="Downloads"
            active={location.pathname === "/downloads"}
            testId="nav-downloads"
          />
          <NavLink
            to="/devices"
            label="Devices"
            active={location.pathname === "/devices"}
            testId="nav-devices"
          />
          <NavLink
            to="/settings"
            label="Settings"
            active={location.pathname === "/settings"}
            testId="nav-settings"
          />
        </nav>

        {/* Connection status */}
        <div className="border-t border-zinc-800 p-4">
          <div data-testid="connection-status" className="flex items-center gap-2 text-xs text-zinc-500">
            <div className={`h-2 w-2 rounded-full ${status.color}`} />
            <span>{status.label}</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({
  to,
  label,
  active,
  testId,
}: {
  to: string;
  label: string;
  active: boolean;
  testId?: string;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className={`block rounded-lg px-3 py-2 text-sm ${
        active
          ? "bg-zinc-800 font-medium text-white"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}
