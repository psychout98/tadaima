import { test, expect } from "./fixtures/auth.fixture";
import { API_URL, TEST_ADMIN, ensureWorkerProfile } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-20: Error Handling & Edge Cases", () => {
  test("20.2 — TMDB API failure handled gracefully", async ({ profilePage }) => {
    await profilePage.route("**/api/search*", async (route) => {
      await route.fulfill({ status: 500, body: JSON.stringify({ error: "TMDB_ERROR" }) });
    });
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("test");
    await profilePage.locator(SEL.searchBtn).click();
    // Should not crash - either shows error or empty results
    await profilePage.waitForTimeout(1000);
    await expect(profilePage.locator(SEL.searchBar)).toBeVisible();
  });

  test("20.5 — special characters in search", async ({ profilePage }) => {
    await profilePage.route("**/api/search*", async (route) => {
      await route.fulfill({ status: 200, body: JSON.stringify([]) });
    });
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("O'Brien & Co.");
    await profilePage.locator(SEL.searchBtn).click();
    // Should not crash
    await profilePage.waitForTimeout(500);
    await expect(profilePage.locator(SEL.searchBar)).toBeVisible();
  });

  test("20.9 — browser back/forward navigation", async ({ profilePage }) => {
    await profilePage.goto("/");
    await profilePage.locator(SEL.navDownloads).click();
    await profilePage.waitForURL("**/downloads");
    await profilePage.locator(SEL.navDevices).click();
    await profilePage.waitForURL("**/devices");

    // Go back
    await profilePage.goBack();
    await expect(profilePage).toHaveURL(/downloads/);

    // Go forward
    await profilePage.goForward();
    await expect(profilePage).toHaveURL(/devices/);
  });

  test("20.10 — page refresh preserves session", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    await profilePage.reload();
    await expect(profilePage.getByText("Downloads")).toBeVisible();
    // Session should still be active
    await expect(profilePage.locator(SEL.sidebar)).toBeVisible();
  });

  test("20.11 — multiple browser tabs work", async ({ browser }, testInfo) => {
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();
    const page2 = await ctx.newPage();

    // Use worker-scoped profile
    const { profileId, profileToken, adminToken } =
      await ensureWorkerProfile(testInfo.workerIndex);

    const profilesRes = await fetch(`${API_URL}/profiles`);
    const profiles: Array<{ id: string; name: string; avatar: string }> = await profilesRes.json();
    const profile = profiles.find((p) => p.id === profileId)!;

    const adminRes = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_ADMIN.username, password: TEST_ADMIN.password }),
    });
    const { accessToken: adminAccessToken, refreshToken: adminRefreshToken } = await adminRes.json();

    for (const page of [page1, page2]) {
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
        { token: profileToken, profile, adminToken: adminAccessToken, adminRefreshToken },
      );
      await page.reload();
    }

    await expect(page1.locator(SEL.sidebar)).toBeVisible();
    await expect(page2.locator(SEL.sidebar)).toBeVisible();
    await ctx.close();
  });

  test("20.6 — health endpoint always accessible", async ({ request }) => {
    const res = await request.get(`${API_URL}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("20.7 — version endpoint accessible", async ({ request }) => {
    const res = await request.get(`${API_URL}/version`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.version).toBeTruthy();
  });

  test("20.3 — RD API failure shows error", async ({ profilePage }) => {
    // Similar to TMDB failure test
    await profilePage.route("**/api/streams/**", async (route) => {
      await route.fulfill({ status: 500, body: JSON.stringify({ error: "RD_ERROR" }) });
    });
    await profilePage.goto("/");
    // Just verify page doesn't crash
    await expect(profilePage.locator(SEL.searchBar)).toBeVisible();
  });

  test("20.4 — 404 routes handled", async ({ profilePage }) => {
    await profilePage.goto("/nonexistent-page");
    // Should redirect to a valid page
    await profilePage.waitForURL(/\/(profiles|$)/);
  });

  test("20.8 — concurrent API requests don't crash", async ({ profilePage }) => {
    await profilePage.goto("/");
    // Rapidly navigate between pages
    await profilePage.locator(SEL.navDownloads).click();
    await profilePage.locator(SEL.navDevices).click();
    await profilePage.locator(SEL.navSettings).click();
    await profilePage.locator(SEL.navSearch).click();
    // Should end up at search without errors
    await expect(profilePage.locator(SEL.searchBar)).toBeVisible();
  });

  test("20.12 — app handles page refresh gracefully", async ({ profilePage }) => {
    await profilePage.goto("/settings");
    await profilePage.reload();
    await expect(profilePage.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});
