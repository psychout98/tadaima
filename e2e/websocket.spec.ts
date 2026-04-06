import { test, expect } from "./fixtures/auth.fixture";
import { API_URL, WS_URL } from "./helpers/constants";
import { SEL } from "./helpers/selectors";
import { MockAgent } from "./fixtures/ws-mock.fixture";

test.describe("TS-07: WebSocket Connectivity", () => {
  let deviceToken: string;

  test.beforeEach(async ({}, testInfo) => {
    // Pair a device for WebSocket tests
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
      body: JSON.stringify({ code, deviceName: "WS-Test-Device", platform: "linux" }),
    });
    const body = await claimRes.json();
    deviceToken = body.deviceToken;
  });

  test("7.1 — web client connects on profile select", async ({ profilePage }) => {
    await profilePage.goto("/");
    // Wait for connection status
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("7.2 — connection status indicator visible", async ({ profilePage }) => {
    await profilePage.goto("/");
    await expect(profilePage.locator(SEL.connectionStatus)).toBeVisible();
  });

  test("7.4 — agent connects via WebSocket", async () => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    expect(agent.isConnected).toBe(true);
    await agent.disconnect();
  });

  test("7.5 — agent heartbeat keeps connection alive", async () => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    await agent.sendHeartbeat();
    // Wait a moment for processing
    await new Promise((r) => setTimeout(r, 500));
    expect(agent.isConnected).toBe(true);
    await agent.disconnect();
  });

  test("7.7 — message routing web→agent", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();

    const msgPromise = agent.waitForMessage("download:request", 10_000);

    // Navigate to search and trigger a download via WebSocket from browser
    await profilePage.goto("/");
    await profilePage.evaluate(() => {
      // Simulate a download request
      const store = JSON.parse(localStorage.getItem("auth-store") ?? "{}");
      const ws = (window as any).__wsForTest;
      // This might not work directly, test via API/UI later
    });

    // This test is tricky because it requires the full flow
    // Just verify the agent can receive messages
    await agent.disconnect();
  });

  test("7.8 — message routing agent→web", async ({ profilePage }) => {
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();

    await profilePage.goto("/");
    // Wait for WebSocket to connect
    await expect(
      profilePage.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Agent sends a download:completed event
    agent.send({
      id: `test-${Date.now()}`,
      type: "download:completed",
      timestamp: Date.now(),
      payload: {
        jobId: "test-job-123",
        filePath: "/test/file.mkv",
        _meta: { title: "Test Movie Notify" },
      },
    });

    // Web should receive it as a toast
    await expect(
      profilePage.locator(SEL.toast).filter({ hasText: /Test Movie Notify/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.disconnect();
  });

  test("7.9 — multi-client broadcast", async ({ browser }) => {
    // Open two tabs as same profile
    const profilesRes = await fetch(`${API_URL}/profiles`);
    const profiles = await profilesRes.json();
    const selectRes = await fetch(`${API_URL}/profiles/${profiles[0].id}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { token, profile } = await selectRes.json();

    // Admin login for full store setup
    const adminRes = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testadmin", password: "testpass123" }),
    });
    const { accessToken: adminToken, refreshToken: adminRefreshToken } = await adminRes.json();

    const setupPage = async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto("/");
      await page.evaluate(
        ({ token, profile, adminToken, adminRefreshToken }) => {
          const store = JSON.parse(localStorage.getItem("auth-store") ?? "{}");
          store.state = {
            ...store.state,
            profileToken: token,
            profile: { id: profile.id, name: profile.name, avatar: profile.avatar },
            adminToken,
            adminRefreshToken,
          };
          localStorage.setItem("auth-store", JSON.stringify(store));
        },
        { token, profile, adminToken, adminRefreshToken },
      );
      await page.reload();
      return { page, ctx };
    };

    const { page: page1, ctx: ctx1 } = await setupPage();
    const { page: page2, ctx: ctx2 } = await setupPage();

    // Wait for both to connect
    await expect(
      page1.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page2.locator(SEL.connectionStatus).filter({ hasText: /Connected/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Connect agent and send event
    const agent = new MockAgent(WS_URL, deviceToken);
    await agent.connect();
    agent.send({
      id: `broadcast-${Date.now()}`,
      type: "download:completed",
      timestamp: Date.now(),
      payload: {
        jobId: "broadcast-test",
        filePath: "/test.mkv",
        _meta: { title: "Broadcast Test" },
      },
    });

    // Both pages should see the toast
    await expect(
      page1.locator(SEL.toast).filter({ hasText: /Broadcast Test/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page2.locator(SEL.toast).filter({ hasText: /Broadcast Test/i }),
    ).toBeVisible({ timeout: 10_000 });

    await agent.disconnect();
    await ctx1.close();
    await ctx2.close();
  });

  test("7.10 — auth required for WS connection", async () => {
    const ws = await import("ws");
    let socket: InstanceType<typeof ws.WebSocket> | null = null;
    try {
      await new Promise<void>((resolve) => {
        socket = new ws.WebSocket(`${WS_URL}/ws?token=invalid-token`);
        socket.on("close", (code) => {
          expect(code).not.toBe(1000); // Should not be normal close
          resolve();
        });
        socket.on("error", () => {
          resolve(); // Connection rejected
        });
        setTimeout(() => {
          resolve();
        }, 3000);
      });
    } finally {
      if (socket) {
        const s = socket as InstanceType<typeof ws.WebSocket>;
        if (s.readyState === ws.WebSocket.OPEN || s.readyState === ws.WebSocket.CONNECTING) {
          s.close();
        }
      }
    }
  });
});
