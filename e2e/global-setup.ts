import { API_URL } from "./helpers/constants";

async function globalSetup() {
  // Wait for server to be ready
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) {
        console.log("Server is ready");
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Server did not start within timeout");
}

export default globalSetup;
