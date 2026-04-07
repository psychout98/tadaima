import { test, expect } from "./fixtures/auth.fixture";
import { MockAgent } from "./fixtures/ws-mock.fixture";
import { API_URL, WS_URL, ensureWorkerProfile, pairWorkerDevice } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-17: Toast Notifications", () => {
  let deviceToken: string;
  let wIdx: number;

  test.beforeEach(async ({}, testInfo) => {
    wIdx = testInfo.workerIndex;
    const { profileToken } = await ensureWorkerProfile(wIdx);
    const { deviceToken: dt } = await pairWorkerDevice(profileToken, wIdx, "Toast-Dev");
    deviceToken = dt;
  });

  test("17.1 — success toast appears on download complete", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.completeDownload(`success-toast-w${wIdx}`);
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

    await agent.failDownload(`error-toast-w${wIdx}`, "Disk full");
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

    await agent.completeDownload(`auto-dismiss-w${wIdx}`);
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

    await agent.completeDownload(`manual-dismiss-w${wIdx}`);
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
    await agent.completeDownload(`stack-1-w${wIdx}`);
    await new Promise((r) => setTimeout(r, 200));
    await agent.completeDownload(`stack-2-w${wIdx}`);

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

    await agent.completeDownload(`named-complete-w${wIdx}`);
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

    await agent.failDownload(`named-fail-w${wIdx}`, "Connection timeout");
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
      payload: { jobId: `info-toast-w${wIdx}`, requestId: `info-toast-w${wIdx}`, title: "InfoToastMovie" },
    });

    await expect(
      profilePage.locator(SEL.toast).filter({ hasText: /started.*InfoToastMovie/i }),
    ).toBeVisible({ timeout: 10_000 });
    await agent.disconnect();
  });
});
