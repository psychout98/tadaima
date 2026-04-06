import { API_URL } from "./helpers/constants";

async function globalSetup() {
  // Server is already running (Playwright webServer guarantees this).
  // Reset test state for a clean run.
  try {
    const res = await fetch(`${API_URL}/setup/reset`, { method: "POST" });
    if (!res.ok) {
      console.warn("Setup reset failed (may be first run):", res.status);
    }
  } catch {
    console.warn("Setup reset request failed (server may not support it yet)");
  }
}

export default globalSetup;
