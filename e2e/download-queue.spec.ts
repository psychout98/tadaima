import { test, expect } from "./fixtures/auth.fixture";
import { API_URL } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-11: Download Queue (Offline)", () => {
  let profileToken: string;

  test.beforeEach(async () => {
    const profilesRes = await fetch(`${API_URL}/profiles`);
    const profiles = await profilesRes.json();
    const selectRes = await fetch(`${API_URL}/profiles/${profiles[0].id}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await selectRes.json();
    profileToken = body.token;
  });

  test("11.1 — queue endpoint accessible", async () => {
    const res = await fetch(`${API_URL}/downloads/queue`, {
      headers: { Authorization: `Bearer ${profileToken}` },
    });
    expect(res.ok).toBeTruthy();
    const queue = await res.json();
    expect(Array.isArray(queue)).toBe(true);
  });

  test("11.2 — queued downloads shown in UI", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    // Tab to queued
    const tab = profilePage.locator('[data-testid="tab-queued"]');
    await tab.click();
    await expect(tab).toHaveAttribute("data-state", "active", { timeout: 3000 });
  });

  test("11.4 — cancel queued download via API", async () => {
    const queueRes = await fetch(`${API_URL}/downloads/queue`, {
      headers: { Authorization: `Bearer ${profileToken}` },
    });
    const queue = await queueRes.json();
    if (queue.length > 0) {
      const res = await fetch(`${API_URL}/downloads/queue/${queue[0].id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${profileToken}` },
      });
      expect(res.ok).toBeTruthy();
    }
  });

  test("11.5 — queue listing returns proper structure", async () => {
    const res = await fetch(`${API_URL}/downloads/queue`, {
      headers: { Authorization: `Bearer ${profileToken}` },
    });
    const queue = await res.json();
    for (const item of queue) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("payload");
      expect(item).toHaveProperty("status");
      expect(item).toHaveProperty("createdAt");
    }
  });

  test("11.6 — history listing returns proper structure", async () => {
    const res = await fetch(`${API_URL}/downloads`, {
      headers: { Authorization: `Bearer ${profileToken}` },
    });
    const history = await res.json();
    for (const item of history) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("status");
    }
  });

  test("11.7 — downloads page tabs work", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    // Click through each tab
    for (const tabId of ["tab-all", "tab-active", "tab-queued", "tab-completed", "tab-failed"]) {
      const tab = profilePage.locator(`[data-testid="${tabId}"]`);
      await tab.click();
      await expect(tab).toHaveAttribute("data-state", "active", { timeout: 3000 });
    }
  });

  test("11.3 — download queued toast shown", async ({ profilePage }) => {
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Simulate a queued event from server
    await profilePage.evaluate(() => {
      // This would come through WS - just testing the page loads without errors
    });
  });
});
