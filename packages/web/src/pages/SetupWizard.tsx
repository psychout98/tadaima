import { useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError } from "../lib/api";

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

export function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tmdbApiKey, setTmdbApiKey] = useState("");
  const [tmdbValid, setTmdbValid] = useState<boolean | null>(null);
  const [rdApiKey, setRdApiKey] = useState("");
  const [rdValid, setRdValid] = useState<boolean | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState(AVATAR_COLORS[0]);

  async function handleComplete() {
    setLoading(true);
    setError("");
    try {
      await api.setup.complete({
        username,
        password,
        tmdbApiKey,
        rdApiKey,
        profileName,
        profileAvatar,
      });
      navigate("/profiles");
    } catch (e) {
      setError(e instanceof ApiError ? e.detail ?? e.code : "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  const steps = [
    // Step 0: Admin account
    <div key="admin" className="space-y-4">
      <h2 className="text-2xl font-bold">Create Admin Account</h2>
      <p className="text-zinc-400">
        This account manages your Tadaima instance.
      </p>
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500"
      />
      <input
        type="password"
        placeholder="Password (min 8 characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        onClick={() => setStep(1)}
        disabled={!username || password.length < 8}
        className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white disabled:opacity-50"
      >
        Next
      </button>
    </div>,

    // Step 1: TMDB key
    <div key="tmdb" className="space-y-4">
      <h2 className="text-2xl font-bold">TMDB API Key</h2>
      <p className="text-zinc-400">
        Used for movie and TV show metadata.{" "}
        <a
          href="https://www.themoviedb.org/settings/api"
          target="_blank"
          rel="noreferrer"
          className="text-blue-400 underline"
        >
          Get a free key
        </a>
      </p>
      <input
        type="text"
        placeholder="TMDB API key"
        value={tmdbApiKey}
        onChange={(e) => {
          setTmdbApiKey(e.target.value);
          setTmdbValid(null);
        }}
        className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500"
      />
      {tmdbValid === true && (
        <p className="text-emerald-400">Valid key</p>
      )}
      {tmdbValid === false && (
        <p className="text-red-400">Invalid key</p>
      )}
      <div className="flex gap-3">
        <button
          onClick={() => setStep(0)}
          className="rounded-lg bg-zinc-700 px-6 py-3 text-white"
        >
          Back
        </button>
        <button
          onClick={() => setStep(2)}
          disabled={!tmdbApiKey}
          className="flex-1 rounded-lg bg-blue-600 py-3 font-medium text-white disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>,

    // Step 2: RD key
    <div key="rd" className="space-y-4">
      <h2 className="text-2xl font-bold">Real-Debrid API Key</h2>
      <p className="text-zinc-400">
        Used for downloading content.{" "}
        <a
          href="https://real-debrid.com/apitoken"
          target="_blank"
          rel="noreferrer"
          className="text-blue-400 underline"
        >
          Get your key
        </a>
      </p>
      <input
        type="text"
        placeholder="Real-Debrid API key"
        value={rdApiKey}
        onChange={(e) => {
          setRdApiKey(e.target.value);
          setRdValid(null);
        }}
        className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500"
      />
      {rdValid === true && (
        <p className="text-emerald-400">Valid key</p>
      )}
      {rdValid === false && (
        <p className="text-red-400">Invalid key</p>
      )}
      <div className="flex gap-3">
        <button
          onClick={() => setStep(1)}
          className="rounded-lg bg-zinc-700 px-6 py-3 text-white"
        >
          Back
        </button>
        <button
          onClick={() => setStep(3)}
          disabled={!rdApiKey}
          className="flex-1 rounded-lg bg-blue-600 py-3 font-medium text-white disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>,

    // Step 3: First profile
    <div key="profile" className="space-y-4">
      <h2 className="text-2xl font-bold">Create Your Profile</h2>
      <p className="text-zinc-400">This is your identity in Tadaima.</p>
      <input
        type="text"
        placeholder="Profile name (e.g. Noah)"
        value={profileName}
        onChange={(e) => setProfileName(e.target.value)}
        className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div>
        <p className="mb-2 text-sm text-zinc-400">Pick a color</p>
        <div className="flex gap-2">
          {AVATAR_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => setProfileAvatar(color)}
              className={`h-10 w-10 rounded-full ${color} ${
                profileAvatar === color
                  ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-950"
                  : ""
              }`}
            />
          ))}
        </div>
      </div>
      {error && <p className="text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button
          onClick={() => setStep(2)}
          className="rounded-lg bg-zinc-700 px-6 py-3 text-white"
        >
          Back
        </button>
        <button
          onClick={handleComplete}
          disabled={!profileName || loading}
          className="flex-1 rounded-lg bg-emerald-600 py-3 font-medium text-white disabled:opacity-50"
        >
          {loading ? "Setting up..." : "Complete Setup"}
        </button>
      </div>
    </div>,
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
      <div className="w-full max-w-md p-6">
        <h1 className="mb-2 text-center text-3xl font-bold">Tadaima</h1>
        <p className="mb-8 text-center text-zinc-400">
          Step {step + 1} of {steps.length}
        </p>
        <div className="mb-6 flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${
                i <= step ? "bg-blue-500" : "bg-zinc-700"
              }`}
            />
          ))}
        </div>
        {steps[step]}
      </div>
    </div>
  );
}
