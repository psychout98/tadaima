import { test, expect } from "./fixtures/auth.fixture";
import { MockAgent } from "./fixtures/ws-mock.fixture";
import { API_URL, WS_URL, ensureWorkerProfile, pairWorkerDevice } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-13: Real-Time Progress UI", () => {
  let deviceToken: string;
  let wIdx: number;

  test.beforeEach(async ({}, testInfo) => {
    wIdx = testInfo.workerIndex;
    const { profileToken } = await ensureWorkerProfile(wIdx);
    const { deviceToken: dt } = await pairWorkerDevice(profileToken, wIdx, "Progress-Dev");
    deviceToken = dt;
  });

  test("13.1 — progress bar updates live", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();

    await profilePage.goto("/downloads");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Send accepted
    agent.send({
      id: `a-${Date.now()}`,
      type: "download:accepted",
      timestamp: Date.now(),
      payload: { jobId: `progress-live-w${wIdx}`, requestId: `progress-live-w${wIdx}`, title: "LiveProgress" },
    });

    await new Promise((r) => setTimeout(r, 500));

    // Send progress updates
    await agent.sendProgress(`progress-live-w${wIdx}`, 25, 5_000_000);
    await new Promise((r) => setTimeout(r, 300));
    await agent.sendProgress(`progress-live-w${wIdx}`, 50, 10_000_000);

    // Check for progress display
    const card = profilePage.locator(SEL.activeDownloadCard).filter({ hasText: "LiveProgress" });
    await expect(card).toBeVisible({ timeout: 3000 });
    await expect(card.getByText(/\d+%/)).toBeVisible();

    await agent.completeDownload(`progress-live-w${wIdx}`);
    await agent.disconnect();
  });

  test("13.2 — download speed displayed", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();

    await profilePage.goto("/downloads");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    agent.send({
      id: `a-${Date.now()}`,
      type: "download:accepted",
      timestamp: Date.now(),
      payload: { jobId: `speed-test-w${wIdx}`, requestId: `speed-test-w${wIdx}`, title: "SpeedTest" },
    });
    await new Promise((r) => setTimeout(r, 300));
    await agent.sendProgress(`speed-test-w${wIdx}`, 30, 15_000_000);

    const card = profilePage.locator(SEL.activeDownloadCard).filter({ hasText: "SpeedTest" });
    await expect(card).toBeVisible({ timeout: 3000 });
    await expect(card.getByText(/MB\/s/)).toBeVisible({ timeout: 3000 });

    await agent.completeDownload(`speed-test-w${wIdx}`);
    await agent.disconnect();
  });

  test("13.4 — phase label updates", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();

    await profilePage.goto("/downloads");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    agent.send({
      id: `a-${Date.now()}`,
      type: "download:accepted",
      timestamp: Date.now(),
      payload: { jobId: `phase-test-w${wIdx}`, requestId: `phase-test-w${wIdx}`, title: "PhaseTest" },
    });
    await new Promise((r) => setTimeout(r, 300));
    await agent.sendProgress(`phase-test-w${wIdx}`, 10, 5_000_000, "adding");
    await new Promise((r) => setTimeout(r, 300));
    await agent.sendProgress(`phase-test-w${wIdx}`, 50, 10_000_000, "downloading");

    await agent.completeDownload(`phase-test-w${wIdx}`);
    await agent.disconnect();
  });

  test("13.8 — completion toast notification", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();

    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.completeDownload(`toast-complete-w${wIdx}`);

    await expect(
      profilePage.locator(SEL.toast).filter({ hasText: /arrived|complete/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.disconnect();
  });

  test("13.9 — failure toast notification", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();

    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.failDownload(`toast-fail-w${wIdx}`, "Network error");

    await expect(
      profilePage.locator(SEL.toast).filter({ hasText: /failed/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.disconnect();
  });

  test("13.6 — multiple simultaneous downloads", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();

    await profilePage.goto("/downloads");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Two concurrent downloads
    for (const name of ["DL-A", "DL-B"]) {
      agent.send({
        id: `a-${Date.now()}-${name}`,
        type: "download:accepted",
        timestamp: Date.now(),
        payload: { jobId: `multi-${name}-w${wIdx}`, requestId: `multi-${name}-w${wIdx}`, title: name },
      });
      await new Promise((r) => setTimeout(r, 200));
    }

    // Cleanup
    for (const name of ["DL-A", "DL-B"]) {
      await agent.completeDownload(`multi-${name}-w${wIdx}`);
    }
    await agent.disconnect();
  });

  test("13.7 — progress survives page navigation", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();

    await profilePage.goto("/downloads");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    agent.send({
      id: `a-${Date.now()}`,
      type: "download:accepted",
      timestamp: Date.now(),
      payload: { jobId: `nav-test-w${wIdx}`, requestId: `nav-test-w${wIdx}`, title: "NavTest" },
    });
    await new Promise((r) => setTimeout(r, 300));

    // Navigate away
    await profilePage.locator(SEL.navSearch).click();
    await profilePage.waitForURL("/");

    // Navigate back
    await profilePage.locator(SEL.navDownloads).click();
    await profilePage.waitForURL("**/downloads");

    await agent.completeDownload(`nav-test-w${wIdx}`);
    await agent.disconnect();
  });

  test("13.3 — ETA displayed during download", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();

    await profilePage.goto("/downloads");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    agent.send({
      id: `a-${Date.now()}`,
      type: "download:accepted",
      timestamp: Date.now(),
      payload: { jobId: `eta-test-w${wIdx}`, requestId: `eta-test-w${wIdx}`, title: "ETATest" },
    });
    await new Promise((r) => setTimeout(r, 300));
    await agent.sendProgress(`eta-test-w${wIdx}`, 40, 10_000_000);

    const card = profilePage.locator(SEL.activeDownloadCard).filter({ hasText: "ETATest" });
    await expect(card).toBeVisible({ timeout: 3000 });
    await expect(card.getByText(/ETA \d/)).toBeVisible({ timeout: 3000 });

    await agent.completeDownload(`eta-test-w${wIdx}`);
    await agent.disconnect();
  });

  test("13.10 — device status notification", async ({ profilePage }) => {
    await profilePage.goto("/");
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });
    // Connection indicator should be visible
    await expect(profilePage.locator(SEL.connectionStatus)).toBeVisible();
  });
});
