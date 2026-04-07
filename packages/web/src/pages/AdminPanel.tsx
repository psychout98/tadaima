import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { useAuthStore } from "../lib/store";

interface Profile {
  id: string;
  name: string;
  avatar: string | null;
  hasPin: boolean;
}

const AVATAR_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-cyan-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-pink-500",
];

export function AdminPanel() {
  const navigate = useNavigate();
  const { adminToken, clearAdminAuth, addToast } = useAuthStore();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [settings, setSettings] = useState<{
    rdApiKey: string | null;
    tmdbApiKey: string | null;
  }>({ rdApiKey: null, tmdbApiKey: null });

  // Add profile form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAvatar, setNewAvatar] = useState(AVATAR_COLORS[0]);
  const [newPin, setNewPin] = useState("");

  // Settings edit
  const [editRd, setEditRd] = useState("");
  const [editTmdb, setEditTmdb] = useState("");
  const [settingsMsg, setSettingsMsg] = useState("");

  useEffect(() => {
    if (!adminToken) {
      if (!loggingOut.current) {
        navigate("/admin/login");
      }
      return;
    }
    loadData();
  }, [adminToken, navigate]);

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

  async function handleAddProfile() {
    if (!newName || !adminToken) return;
    try {
      await api.profiles.create(
        { name: newName, avatar: newAvatar, pin: newPin || undefined },
        adminToken,
      );
      setNewName("");
      setNewPin("");
      setShowAdd(false);
      loadData();
    } catch {
      addToast("error", "Failed to add profile");
    }
  }

  async function handleDeleteProfile(id: string) {
    if (!adminToken) return;
    try {
      await api.profiles.delete(id, adminToken);
      loadData();
    } catch {
      addToast("error", "Failed to delete profile");
    }
  }

  async function handleSaveSettings() {
    if (!adminToken) return;
    const data: { rdApiKey?: string; tmdbApiKey?: string } = {};
    if (editRd) data.rdApiKey = editRd;
    if (editTmdb) data.tmdbApiKey = editTmdb;
    if (Object.keys(data).length === 0) return;
    try {
      await api.settings.update(data, adminToken);
      setEditRd("");
      setEditTmdb("");
      setSettingsMsg("Settings saved");
      loadData();
      setTimeout(() => setSettingsMsg(""), 3000);
    } catch {
      addToast("error", "Failed to save settings");
    }
  }

  const loggingOut = useRef(false);

  function handleLogout() {
    loggingOut.current = true;
    clearAdminAuth();
    navigate("/profiles");
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <div className="flex gap-3">
            <button
              onClick={() => navigate("/profiles")}
              className="text-sm text-zinc-400 hover:text-white"
            >
              Profiles
            </button>
            <button
              data-testid="logout-btn"
              onClick={handleLogout}
              className="text-sm text-zinc-400 hover:text-white"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Profiles Section */}
        <section className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Profiles</h2>
            <button
              data-testid="add-profile-btn"
              onClick={() => setShowAdd(!showAdd)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium"
            >
              Add Profile
            </button>
          </div>

          {showAdd && (
            <div data-testid="add-profile-form" className="mb-4 space-y-3 rounded-lg bg-zinc-900 p-4">
              <input
                data-testid="new-profile-name"
                type="text"
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg bg-zinc-800 px-4 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewAvatar(color)}
                    className={`h-8 w-8 rounded-full ${color} ${
                      newAvatar === color ? "ring-2 ring-white" : ""
                    }`}
                  />
                ))}
              </div>
              <input
                data-testid="new-profile-pin"
                type="text"
                placeholder="PIN (optional, 4-6 digits)"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full rounded-lg bg-zinc-800 px-4 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                data-testid="create-profile-btn"
                onClick={handleAddProfile}
                disabled={!newName}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Create
              </button>
            </div>
          )}

          <div data-testid="profile-list" className="space-y-2">
            {profiles.map((p) => (
              <div
                data-testid="profile-row"
                key={p.id}
                className="flex items-center justify-between rounded-lg bg-zinc-900 p-4"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
                      p.avatar ?? "bg-zinc-700"
                    }`}
                  >
                    {p.name[0]}
                  </div>
                  <span>{p.name}</span>
                  {p.hasPin && (
                    <span className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
                      PIN
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteProfile(p.id)}
                  className="text-sm text-red-400 hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Settings Section */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">Instance Settings</h2>
          <div className="space-y-4 rounded-lg bg-zinc-900 p-4">
            <div>
              <label className="mb-1 block text-sm text-zinc-400">
                Real-Debrid API Key
              </label>
              <p className="mb-1 text-xs text-zinc-500">
                Current: {settings.rdApiKey ?? "Not set"}
              </p>
              <input
                data-testid="rd-api-key-input"
                type="text"
                placeholder="Enter new key to update"
                value={editRd}
                onChange={(e) => setEditRd(e.target.value)}
                className="w-full rounded-lg bg-zinc-800 px-4 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-400">
                TMDB API Key
              </label>
              <p className="mb-1 text-xs text-zinc-500">
                Current: {settings.tmdbApiKey ?? "Not set"}
              </p>
              <input
                data-testid="tmdb-api-key-input"
                type="text"
                placeholder="Enter new key to update"
                value={editTmdb}
                onChange={(e) => setEditTmdb(e.target.value)}
                className="w-full rounded-lg bg-zinc-800 px-4 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {settingsMsg && (
              <p data-testid="settings-msg" className="text-emerald-400">{settingsMsg}</p>
            )}
            <button
              data-testid="save-settings-btn"
              onClick={handleSaveSettings}
              disabled={!editRd && !editTmdb}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Save Settings
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
