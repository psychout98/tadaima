import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../lib/store";

interface Profile {
  id: string;
  name: string;
  avatar: string | null;
  hasPin: boolean;
}

export function ProfilePicker() {
  const navigate = useNavigate();
  const { adminToken, setProfileSession, addToast } = useAuthStore();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");

  useEffect(() => {
    api.profiles
      .list()
      .then(setProfiles)
      .finally(() => setLoading(false));
  }, []);

  async function handleSelect(profile: Profile) {
    if (profile.hasPin) {
      setSelectedProfile(profile);
      setPin("");
      setPinError("");
      return;
    }

    try {
      const result = await api.profiles.select(profile.id);
      setProfileSession(result.token, result.profile);
      navigate("/");
    } catch (e) {
      console.error(e);
      addToast("error", "Failed to select profile");
    }
  }

  async function handlePinSubmit() {
    if (!selectedProfile) return;
    setPinError("");
    try {
      const result = await api.profiles.select(selectedProfile.id, pin);
      setProfileSession(result.token, result.profile);
      navigate("/");
    } catch (e) {
      if (e instanceof ApiError && e.code === "INVALID_PIN") {
        setPinError("Incorrect PIN");
      } else {
        setPinError("Something went wrong");
      }
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  // PIN entry overlay
  if (selectedProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
        <div className="w-full max-w-xs space-y-4 text-center">
          <div
            className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold ${
              selectedProfile.avatar ?? "bg-zinc-700"
            }`}
          >
            {selectedProfile.name[0]}
          </div>
          <h2 className="text-xl font-bold">{selectedProfile.name}</h2>
          <p className="text-zinc-400">Enter PIN</p>
          <input
            data-testid="pin-input"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && pin.length >= 4 && handlePinSubmit()}
            className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-center text-2xl tracking-widest text-white outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          {pinError && <p data-testid="pin-error" className="text-red-400">{pinError}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => setSelectedProfile(null)}
              className="flex-1 rounded-lg bg-zinc-700 py-3 text-white"
            >
              Back
            </button>
            <button
              onClick={handlePinSubmit}
              disabled={pin.length < 4}
              className="flex-1 rounded-lg bg-blue-600 py-3 font-medium text-white disabled:opacity-50"
            >
              Enter
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white">
      <h1 className="mb-2 text-3xl font-bold">Who's watching?</h1>
      <p className="mb-8 text-zinc-400">Select your profile</p>

      <div data-testid="profile-grid" className="flex flex-wrap justify-center gap-6">
        {profiles.map((profile) => (
          <button
            data-testid="profile-card"
            key={profile.id}
            onClick={() => handleSelect(profile)}
            className="group flex flex-col items-center gap-2"
          >
            <div
              className={`flex h-24 w-24 items-center justify-center rounded-xl text-3xl font-bold transition-transform group-hover:scale-105 ${
                profile.avatar ?? "bg-zinc-700"
              }`}
            >
              {profile.name[0]}
            </div>
            <span className="text-sm text-zinc-300 group-hover:text-white">
              {profile.name}
            </span>
            {profile.hasPin && (
              <span className="text-xs text-zinc-500">PIN</span>
            )}
          </button>
        ))}
      </div>

      {adminToken && (
        <Link
          to="/admin"
          className="mt-8 text-sm text-zinc-500 hover:text-zinc-300"
        >
          Manage
        </Link>
      )}
    </div>
  );
}
