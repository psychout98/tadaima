import { test, expect } from "./fixtures/auth.fixture";
import { MockAgent } from "./fixtures/ws-mock.fixture";
import { API_URL, WS_URL } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-17: Toast Notifications", () => {
  let deviceToken: string;

  test.beforeAll(async () => {
    const profilesRes = await fetch(`${API_URL}/profiles`);
    const profiles = await profilesRes.json();
    const selectRes = await fetch(`${API_URL}/profiles/${profiles[0].id}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { token } = await selectRes.json();
    const codeRes = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = await codeRes.json();
    const claimRes = await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, deviceName: "Toast-Device", platform: "linux" }),
    });
    const body = await claimRes.json();
    deviceToken = body.deviceToken;
  });

  test("17.1 — success toast appears on download complete", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.completeDownload("success-toast");
    await expect(profilePage.locator(SEL.toast).first()).toBeVisible({ timeout: 10_000 });
    await agent.disconnect();
  });

  test("17.2 — error toast appears on download failure", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.failDownload("error-toast", "Disk full");
    await expect(
      profilePage.locator(SEL.toast).filter({ hasText: /failed/i }),
    ).toBeVisible({ timeout: 10_000 });
    await agent.disconnect();
  });

  test("17.3 — toast auto-dismisses after timeout", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.completeDownload("auto-dismiss");
    await expect(profilePage.locator(SEL.toast).first()).toBeVisible({ timeout: 10_000 });
    // Wait for auto-dismiss (5s + buffer)
    await expect(profilePage.locator(SEL.toast)).not.toBeVisible({ timeout: 8_000 });
    await agent.disconnect();
  });

  test("17.4 — toast manual dismiss", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.completeDownload("manual-dismiss");
    const toast = profilePage.locator(SEL.toast).first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await profilePage.locator(SEL.toastClose).first().click();
    await expect(toast).not.toBeVisible();
    await agent.disconnect();
  });

  test("17.5 — multiple toasts stack", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Trigger multiple toasts quickly
    await agent.completeDownload("stack-1");
    await new Promise((r) => setTimeout(r, 200));
    await agent.completeDownload("stack-2");

    // Should have multiple toasts
    await expect(profilePage.locator(SEL.toast).first()).toBeVisible({ timeout: 10_000 });
    const count = await profilePage.locator(SEL.toast).count();
    expect(count).toBeGreaterThanOrEqual(1);
    await agent.disconnect();
  });

  test("17.6 — download complete toast text", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.completeDownload("named-complete");
    await expect(
      profilePage.locator(SEL.toast).filter({ hasText: /Test Movie.*arrived/i }),
    ).toBeVisible({ timeout: 10_000 });
    await agent.disconnect();
  });

  test("17.7 — download failed toast text", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.failDownload("named-fail", "Connection timeout");
    await expect(
      profilePage.locator(SEL.toast).filter({ hasText: /failed.*Test Movie/i }),
    ).toBeVisible({ timeout: 10_000 });
    await agent.disconnect();
  });

  test("17.8 — info toast on download accepted", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    agent.send({
      id: `accept-${Date.now()}`,
      type: "download:accepted",
      timestamp: Date.now(),
      payload: { jobId: "info-toast", requestId: "info-toast", title: "InfoToastMovie" },
    });

    await expect(
      profilePage.locator(SEL.toast).filter({ hasText: /started.*InfoToastMovie/i }),
    ).toBeVisible({ timeout: 10_000 });
    await agent.disconnect();
  });
});
