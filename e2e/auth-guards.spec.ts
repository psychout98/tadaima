import { test, expect } from "./fixtures/auth.fixture";
import { API_URL, TEST_ADMIN, ensureWorkerProfile, pairWorkerDevice } from "./helpers/constants";

test.describe("TS-19: Auth Guards & Token Lifecycle", () => {
  test("19.1 — unauthenticated user redirected from /", async ({ page }) => {
    await page.goto("/");
    // Should redirect to /profiles or /setup
    await page.waitForURL(/\/(profiles|setup)/);
  });

  test("19.2 — admin routes require admin auth", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForURL("**/admin/login");
  });

  test("19.3 — profile routes require profile session", async ({ page }) => {
    // Clear any stored auth
    await page.goto("/profiles");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/downloads");
    // Should redirect to profiles
    await page.waitForURL(/\/(profiles|setup)/);
  });

  test("19.4 — access token auto-refresh via API", async ({ request }) => {
    const loginRes = await request.post(`${API_URL}/auth/login`, {
      data: { username: TEST_ADMIN.username, password: TEST_ADMIN.password },
    });
    const { refreshToken } = await loginRes.json();
    const refreshRes = await request.post(`${API_URL}/auth/refresh`, {
      data: { refreshToken },
    });
    expect(refreshRes.ok()).toBeTruthy();
    const { accessToken } = await refreshRes.json();
    expect(accessToken).toBeTruthy();
  });

  test("19.5 — expired refresh token rejects", async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/refresh`, {
      data: { refreshToken: "invalid-expired-token" },
    });
    expect(res.ok()).toBeFalsy();
  });

  test("19.7 — device token for agent endpoints", async ({}, testInfo) => {
    const { profileToken } = await ensureWorkerProfile(testInfo.workerIndex);
    const { deviceToken } = await pairWorkerDevice(profileToken, testInfo.workerIndex, "AuthGuard-Dev");

    // Use device token
    const configRes = await fetch(`${API_URL}/agent/config`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    expect(configRes.ok).toBeTruthy();
  });

  test("19.8 — invalid token rejected", async ({ request }) => {
    const res = await request.get(`${API_URL}/admin/settings`, {
      headers: { Authorization: "Bearer invalid.jwt.token" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("19.9 — logout revokes refresh token", async ({ request }) => {
    // Login
    const loginRes = await request.post(`${API_URL}/auth/login`, {
      data: { username: TEST_ADMIN.username, password: TEST_ADMIN.password },
    });
    const { refreshToken } = await loginRes.json();

    // Logout
    await request.post(`${API_URL}/auth/logout`, {
      data: { refreshToken },
    });

    // Try to refresh with same token
    const refreshRes = await request.post(`${API_URL}/auth/refresh`, {
      data: { refreshToken },
    });
    expect(refreshRes.ok()).toBeFalsy();
  });

  test("19.6 — admin and profile tokens are independent", async ({ request }, testInfo) => {
    const loginRes = await request.post(`${API_URL}/auth/login`, {
      data: { username: TEST_ADMIN.username, password: TEST_ADMIN.password },
    });
    const { accessToken: adminToken } = await loginRes.json();

    const { profileToken } = await ensureWorkerProfile(testInfo.workerIndex);

    // Both should be valid
    expect(adminToken).toBeTruthy();
    expect(profileToken).toBeTruthy();
    expect(adminToken).not.toBe(profileToken);
  });
});
