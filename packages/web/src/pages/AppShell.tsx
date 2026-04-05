import { Link, Outlet, useNavigate } from "react-router";
import { useAuthStore } from "../lib/store";

export function AppShell() {
  const navigate = useNavigate();
  const { profile, clearProfileSession } = useAuthStore();

  if (!profile) {
    navigate("/profiles");
    return null;
  }

  function handleSwitchProfile() {
    clearProfileSession();
    navigate("/profiles");
  }

  return (
    <div className="flex min-h-screen bg-zinc-950 text-white">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-950">
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
            <p className="text-sm font-medium">{profile.name}</p>
            <p className="text-xs text-zinc-500">Switch profile</p>
          </div>
        </button>

        {/* Nav links */}
        <nav className="flex-1 p-3">
          <NavLink to="/" label="Search" />
          <NavLink to="/downloads" label="Downloads" />
          <NavLink to="/devices" label="Devices" />
        </nav>

        {/* Connection status placeholder */}
        <div className="border-t border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <div className="h-2 w-2 rounded-full bg-zinc-600" />
            <span>Connecting...</span>
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

function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="block rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white"
    >
      {label}
    </Link>
  );
}
