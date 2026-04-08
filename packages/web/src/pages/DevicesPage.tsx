import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { useAuthStore } from "../lib/store";

interface Device {
  id: string;
  name: string;
  platform: string;
  isOnline: boolean;
  isDefault: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  docker: "Docker",
};

export function DevicesPage() {
  const { profileToken } = useAuthStore();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiry, setPairingExpiry] = useState<Date | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    if (!profileToken) return;
    try {
      const res = await api.devices.list(profileToken);
      setDevices(res);
    } finally {
      setLoading(false);
    }
  }, [profileToken]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Poll for new devices while pairing code is active
  useEffect(() => {
    if (!pairingCode) return;
    const interval = setInterval(loadDevices, 3000);
    return () => clearInterval(interval);
  }, [pairingCode, loadDevices]);

  // Countdown timer
  useEffect(() => {
    if (!pairingExpiry) return;
    const interval = setInterval(() => {
      if (new Date() > pairingExpiry) {
        setPairingCode(null);
        setPairingExpiry(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [pairingExpiry]);

  async function handlePairRequest() {
    if (!profileToken) return;
    const res = await api.devices.pairRequest(profileToken);
    setPairingCode(res.code);
    setPairingExpiry(new Date(res.expiresAt));
  }

  async function handleRename(id: string) {
    if (!profileToken || !editName.trim()) return;
    await api.devices.update(id, { name: editName.trim() }, profileToken);
    setEditingId(null);
    loadDevices();
  }

  async function handleSetDefault(id: string) {
    if (!profileToken) return;
    await api.devices.update(id, { isDefault: true }, profileToken);
    loadDevices();
  }

  async function handleDelete(id: string) {
    if (!profileToken) return;
    await api.devices.delete(id, profileToken);
    setConfirmDeleteId(null);
    loadDevices();
  }

  function formatTimeAgo(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function formatCountdown(): string {
    if (!pairingExpiry) return "";
    const diff = Math.max(0, pairingExpiry.getTime() - Date.now());
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  if (loading) {
    return <p className="text-zinc-400">Loading devices...</p>;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Devices</h1>
        <button
          data-testid="pair-device-btn"
          onClick={handlePairRequest}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium"
        >
          Pair New Device
        </button>
      </div>

      {/* Pairing code display */}
      {pairingCode && (
        <div className="mb-6 rounded-lg bg-zinc-900 p-6 text-center">
          <p className="mb-2 text-sm text-zinc-400">Enter this code in your agent</p>
          <p data-testid="pairing-code" className="mb-2 font-mono text-4xl font-bold tracking-[0.3em]">
            {pairingCode}
          </p>
          <p className="text-sm text-zinc-500">
            Expires in {formatCountdown()}
          </p>
          <p className="mt-3 text-xs text-zinc-600">
            Run <code className="rounded bg-zinc-800 px-1.5 py-0.5">tadaima-agent setup</code> and enter this code when prompted
          </p>
        </div>
      )}

      {/* Device list */}
      {devices.length === 0 && !pairingCode ? (
        <div className="rounded-lg bg-zinc-900 p-8 text-center">
          <p className="text-zinc-400">No devices paired yet.</p>
          <p className="mt-1 text-sm text-zinc-500">
            Install the agent on your machine to get started.
          </p>
        </div>
      ) : (
        <div data-testid="device-list" className="space-y-3">
          {devices.map((device) => (
            <div
              data-testid="device-card"
              key={device.id}
              className="flex flex-col gap-3 rounded-lg bg-zinc-900 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${
                    device.isOnline ? "bg-emerald-400" : "bg-zinc-600"
                  }`}
                />
                <div>
                  {editingId === device.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleRename(device.id)}
                        className="rounded bg-zinc-800 px-2 py-1 text-sm text-white outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => handleRename(device.id)}
                        className="text-xs text-blue-400"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-zinc-500"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingId(device.id);
                        setEditName(device.name);
                      }}
                      className="text-sm font-medium hover:text-blue-400"
                    >
                      {device.name}
                    </button>
                  )}
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span>{PLATFORM_LABELS[device.platform] ?? device.platform}</span>
                    <span>·</span>
                    <span>{device.isOnline ? "Online" : `Last seen ${formatTimeAgo(device.lastSeenAt)}`}</span>
                    {device.isDefault && (
                      <>
                        <span>·</span>
                        <span className="text-amber-400">Default</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!device.isDefault && (
                  <button
                    onClick={() => handleSetDefault(device.id)}
                    className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-400 hover:text-white"
                  >
                    Set Default
                  </button>
                )}
                {confirmDeleteId === device.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">Remove?</span>
                    <button
                      onClick={() => handleDelete(device.id)}
                      className="text-xs text-red-400"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-zinc-500"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(device.id)}
                    className="text-xs text-zinc-500 hover:text-red-400"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
