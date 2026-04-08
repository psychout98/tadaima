import { useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../lib/store";
import { wsClient } from "../lib/ws-client";

export function SettingsPage() {
  const navigate = useNavigate();
  const { profile, profileToken, adminToken, clearProfileSession } =
    useAuthStore();
  const [newPin, setNewPin] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [pinLoading, setPinLoading] = useState(false);

  async function handleChangePin() {
    if (!profileToken || !profile || !adminToken) return;
    setPinLoading(true);
    setPinMsg("");
    try {
      const pin = newPin.trim() || null;
      await api.profiles.update(profile.id, { pin }, adminToken);
      setPinMsg(pin ? "PIN updated" : "PIN removed");
      setNewPin("");
    } catch (e) {
      setPinMsg(e instanceof ApiError ? e.detail ?? "Failed" : "Failed");
    } finally {
      setPinLoading(false);
    }
  }

  function handleSwitchProfile() {
    wsClient.disconnect();
    clearProfileSession();
    navigate("/profiles");
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>

      {/* Profile section */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Profile</h2>
        <div className="rounded-lg bg-zinc-900 p-4">
          <div className="mb-4 flex items-center gap-3">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${
                profile?.avatar ?? "bg-zinc-700"
              }`}
            >
              {profile?.name[0] ?? "?"}
            </div>
            <div>
              <p className="font-medium">{profile?.name ?? "Unknown"}</p>
              <p className="text-xs text-zinc-500">
                {profile?.id?.slice(0, 8)}
              </p>
            </div>
          </div>

          {adminToken && (
            <div className="border-t border-zinc-800 pt-4">
              <p className="mb-2 text-sm text-zinc-400">Change PIN</p>
              <div className="flex items-center gap-2">
                <input
                  data-testid="pin-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="New PIN (4-6 digits, empty to remove)"
                  value={newPin}
                  onChange={(e) =>
                    setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  data-testid="set-pin-btn"
                  onClick={handleChangePin}
                  disabled={pinLoading}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {newPin ? "Set PIN" : "Remove PIN"}
                </button>
              </div>
              {pinMsg && (
                <p data-testid="pin-msg" className="mt-2 text-xs text-zinc-400">{pinMsg}</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* About section */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">About</h2>
        <div className="space-y-2 rounded-lg bg-zinc-900 p-4 text-sm text-zinc-400">
          <p>
            <span className="text-zinc-300">Tadaima</span> — "I'm home." What
            your downloads say when they arrive.
          </p>
          <p>
            <a
              href="https://github.com/psychout98/tadaima"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline"
            >
              GitHub Repository
            </a>
          </p>
          <p className="text-xs text-zinc-500">MIT License</p>
        </div>
      </section>

      {/* Actions */}
      <div className="space-y-3">
        <button
          data-testid="switch-profile-btn"
          onClick={handleSwitchProfile}
          className="w-full rounded-lg bg-zinc-800 py-3 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
        >
          Switch Profile
        </button>
        <button
          data-testid="admin-panel-btn"
          onClick={() => navigate(adminToken ? "/admin" : "/admin/login")}
          className="w-full rounded-lg bg-zinc-800 py-3 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
        >
          Admin Panel
        </button>
      </div>
    </div>
  );
}
