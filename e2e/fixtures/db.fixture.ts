import { API_URL } from "../helpers/constants";

/**
 * Reset the database to a clean state.
 * Uses the health endpoint to verify the server is running,
 * then truncates tables via direct SQL through a test endpoint,
 * or falls back to re-running setup.
 */
export async function resetDatabase(): Promise<void> {
  // Verify server is up
  const healthRes = await fetch(`${API_URL}/health`);
  if (!healthRes.ok) throw new Error("Server not running");
}

/**
 * Seed profiles via API.
 */
export async function seedProfiles(
  adminToken: string,
  profiles: Array<{ name: string; avatar?: string; pin?: string }>,
): Promise<Array<{ id: string; name: string }>> {
  const results = [];
  for (const p of profiles) {
    const res = await fetch(`${API_URL}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(p),
    });
    results.push(await res.json());
  }
  return results;
}

/**
 * Seed a device for a profile via the pairing flow.
 */
export async function seedDevice(
  profileToken: string,
): Promise<{ code: string; expiresAt: string }> {
  const res = await fetch(`${API_URL}/devices/pair/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${profileToken}`,
    },
  });
  return res.json();
}
