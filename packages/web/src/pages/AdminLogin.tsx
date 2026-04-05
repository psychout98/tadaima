import { useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../lib/store";

export function AdminLogin() {
  const navigate = useNavigate();
  const { setAdminAuth } = useAuthStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { accessToken, refreshToken } = await api.auth.login(
        username,
        password,
      );
      setAdminAuth(accessToken, refreshToken);
      navigate("/admin");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail ?? "Invalid credentials"
          : "Login failed",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
      <form onSubmit={handleSubmit} data-testid="admin-login-form" className="w-full max-w-sm space-y-4 p-6">
        <h1 className="text-2xl font-bold">Admin Login</h1>
        <input
          data-testid="username-input"
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          data-testid="password-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={!username || !password || loading}
          className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white disabled:opacity-50"
        >
          {loading ? "Logging in..." : "Log In"}
        </button>
        <button
          type="button"
          onClick={() => navigate("/profiles")}
          className="w-full text-sm text-zinc-500 hover:text-zinc-300"
        >
          Back to profiles
        </button>
      </form>
    </div>
  );
}
