export const TEST_ADMIN = {
  username: "testadmin",
  password: "testpass123",
};

export const TEST_TMDB_KEY = "test-tmdb-key-e2e";
export const TEST_RD_KEY = "test-rd-key-e2e";

export const TEST_PROFILE = {
  name: "TestUser",
  avatar: "bg-blue-500",
};

export const TEST_PROFILE_WITH_PIN = {
  name: "PinUser",
  avatar: "bg-red-500",
  pin: "1234",
};

export const BASE_URL = "http://localhost:3000";
export const API_URL = `${BASE_URL}/api`;
export const WS_URL = "ws://localhost:3000";

// ── Parallel-safe helpers ─────────────────────────────────────

const AVATARS = ["bg-blue-500", "bg-green-500", "bg-purple-500", "bg-orange-500", "bg-teal-500"];

/** Return a profile name unique to this Playwright worker */
export function workerProfileName(workerIndex: number): string {
  return `TestUser-w${workerIndex}`;
}

/** Return an avatar for this worker */
export function workerAvatar(workerIndex: number): string {
  return AVATARS[workerIndex % AVATARS.length];
}

/** Return a device name unique to this worker + test context */
export function uniqueDeviceName(workerIndex: number, label: string): string {
  return `${label}-w${workerIndex}`;
}

/**
 * Ensure a worker-scoped profile exists and return its select-token.
 * Creates the profile the first time, reuses it on subsequent calls.
 */
export async function ensureWorkerProfile(
  workerIndex: number,
): Promise<{ profileId: string; profileToken: string; adminToken: string }> {
  // Login as admin
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: TEST_ADMIN.username,
      password: TEST_ADMIN.password,
    }),
  });
  const { accessToken: adminToken } = await loginRes.json();

  const name = workerProfileName(workerIndex);
  const avatar = workerAvatar(workerIndex);

  // Check if profile already exists
  const listRes = await fetch(`${API_URL}/profiles`);
  const profiles: Array<{ id: string; name: string }> = await listRes.json();
  let profile = profiles.find((p) => p.name === name);

  if (!profile) {
    const createRes = await fetch(`${API_URL}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name, avatar }),
    });
    if (createRes.ok) {
      profile = await createRes.json();
    } else {
      // May have been created by a race — refetch
      const retry = await fetch(`${API_URL}/profiles`);
      const all: Array<{ id: string; name: string }> = await retry.json();
      profile = all.find((p) => p.name === name);
    }
  }

  if (!profile) throw new Error(`Failed to ensure worker profile "${name}"`);

  // Select the profile
  const selectRes = await fetch(`${API_URL}/profiles/${profile.id}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const { token: profileToken } = await selectRes.json();

  return { profileId: profile.id, profileToken, adminToken };
}

/**
 * Pair a device for the current worker and return its token.
 */
export async function pairWorkerDevice(
  profileToken: string,
  workerIndex: number,
  label: string,
): Promise<{ deviceToken: string; deviceName: string }> {
  const deviceName = uniqueDeviceName(workerIndex, label);
  const codeRes = await fetch(`${API_URL}/devices/pair/request`, {
    method: "POST",
    headers: { Authorization: `Bearer ${profileToken}` },
  });
  if (!codeRes.ok) throw new Error("Pair request failed: " + codeRes.status);
  const { code } = await codeRes.json();

  const claimRes = await fetch(`${API_URL}/devices/pair/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: deviceName, platform: "linux" }),
  });
  if (!claimRes.ok) throw new Error("Pair claim failed: " + claimRes.status);
  const { deviceToken } = await claimRes.json();

  return { deviceToken, deviceName };
}
