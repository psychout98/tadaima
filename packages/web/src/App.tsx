import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "./lib/api";
import { SetupWizard } from "./pages/SetupWizard";
import { ProfilePicker } from "./pages/ProfilePicker";
import { AdminLogin } from "./pages/AdminLogin";
import { AdminPanel } from "./pages/AdminPanel";
import { AppShell } from "./pages/AppShell";
import { SearchPage, DownloadsPage, DevicesPage } from "./pages/Placeholder";

const queryClient = new QueryClient();

function AppRoutes() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    api.setup
      .status()
      .then((res) => setNeedsSetup(res.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  if (needsSetup === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  return (
    <Routes>
      {needsSetup ? (
        <>
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </>
      ) : (
        <>
          <Route path="/profiles" element={<ProfilePicker />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/" element={<AppShell />}>
            <Route index element={<SearchPage />} />
            <Route path="downloads" element={<DownloadsPage />} />
            <Route path="devices" element={<DevicesPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/profiles" replace />} />
        </>
      )}
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
