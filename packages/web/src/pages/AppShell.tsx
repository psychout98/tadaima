import { useEffect } from "react";
import { Link, Outlet, useNavigate, useLocation } from "react-router";
import { useAuthStore } from "../lib/store";
import { wsClient } from "../lib/ws-client";
import { Toasts } from "../components/Toasts";

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
      const type = msg.type as string;
      const payload = msg.payload as Record<string, unknown>;

      if (type === "device:status") {
        updateDeviceStatus(
          payload.deviceId as string,
          payload.isOnline as boolean,
          payload.lastSeenAt as number,
        );
      } else if (type === "download:accepted") {
        addToast("info", `Download started: ${payload.title ?? "Unknown"}`);
        setActiveDownload({
          jobId: payload.jobId as string,
          requestId: payload.requestId as string,
          title: (payload.title as string) ?? "Unknown",
          mediaType: "",
          phase: "adding",
          progress: 0,
        });
      } else if (type === "download:progress") {
        setActiveDownload({
          jobId: payload.jobId as string,
          requestId: "",
          title: "",
          mediaType: "",
          phase: payload.phase as string,
          progress: payload.progress as number,
          downloadedBytes: payload.downloadedBytes as number | undefined,
          totalBytes: payload.totalBytes as number | undefined,
          speedBps: payload.speedBps as number | undefined,
          eta: payload.eta as number | undefined,
        });
      } else if (type === "download:completed") {
        removeActiveDownload(payload.jobId as string);
        const meta = payload._meta as Record<string, unknown> | undefined;
        const title = meta?.title ?? "Download";
        addToast("success", `ただいま — ${title} has arrived`);
      } else if (type === "download:failed") {
        removeActiveDownload(payload.jobId as string);
        const meta = payload._meta as Record<string, unknown> | undefined;
        const title = meta?.title ?? "Download";
        addToast("error", `Download failed: ${title} — ${payload.error}`);
      } else if (type === "download:queued") {
        addToast(
          "info",
          `Queued: ${payload.title} — will download when ${payload.deviceName} is online`,
        );
      } else if (type === "download:rejected") {
        addToast("error", `Download rejected: ${payload.reason}`);
      }
    });

    wsClient.connect(profileToken);

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
    navigate("/profiles");
    return null;
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
