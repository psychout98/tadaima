import { test, expect } from "./fixtures/auth.fixture";
import { mockExternalApis } from "./fixtures/api-mock.fixture";
import { API_URL } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-14: Recently Viewed", () => {
  let profileToken: string;

  test.beforeEach(async () => {
    const profilesRes = await fetch(`${API_URL}/profiles`);
    const profiles = await profilesRes.json();
    if (!profiles.length) throw new Error("No profiles found — setup may not have completed");
    const selectRes = await fetch(`${API_URL}/profiles/${profiles[0].id}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await selectRes.json();
    profileToken = body.token;
  });

  test("14.1 — viewing a title adds to recently viewed", async () => {
    const res = await fetch(`${API_URL}/recently-viewed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${profileToken}`,
      },
      body: JSON.stringify({
        tmdbId: 27205,
        mediaType: "movie",
        title: "Inception",
        year: 2010,
        posterPath: "/test.jpg",
        imdbId: "tt1375666",
      }),
    });
    expect(res.ok).toBeTruthy();
  });

  test("14.2 — recently viewed shown on search page", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    // Add a recently viewed item
    await profilePage.evaluate(async () => {
      const store = JSON.parse(localStorage.getItem("auth-store") ?? "{}");
      const token = store.state?.profileToken;
      if (token) {
        await fetch("/api/recently-viewed", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            tmdbId: 27205,
            mediaType: "movie",
            title: "Inception",
            year: 2010,
            posterPath: null,
            imdbId: "tt1375666",
          }),
        });
      }
    });
    await profilePage.goto("/");
    await expect(profilePage.locator(SEL.recentlyViewed)).toBeVisible({ timeout: 5000 });
  });

  test("14.3 — recently viewed order (most recent first)", async () => {
    // Add two items with a small delay between to ensure ordering
    for (const item of [
      { tmdbId: 100, title: "First", year: 2020, mediaType: "movie" },
      { tmdbId: 200, title: "Second", year: 2021, mediaType: "movie" },
    ]) {
      const postRes = await fetch(`${API_URL}/recently-viewed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${profileToken}`,
        },
        body: JSON.stringify({ ...item, posterPath: null, imdbId: null }),
      });
      expect(postRes.ok).toBeTruthy();
    }

    const res = await fetch(`${API_URL}/recently-viewed`, {
      headers: { Authorization: `Bearer ${profileToken}` },
    });
    const items = await res.json();
    if (items.length >= 2) {
      const secondIdx = items.findIndex((i: { title: string }) => i.title === "Second");
      const firstIdx = items.findIndex((i: { title: string }) => i.title === "First");
      expect(secondIdx).toBeLessThan(firstIdx);
    }
  });

  test("14.5 — recently viewed per profile via API", async () => {
    const res = await fetch(`${API_URL}/recently-viewed`, {
      headers: { Authorization: `Bearer ${profileToken}` },
    });
    expect(res.ok).toBeTruthy();
    const items = await res.json();
    expect(Array.isArray(items)).toBe(true);
  });

  test("14.6 — click recently viewed opens details", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    const recentSection = profilePage.locator(SEL.recentlyViewed);
    await expect(recentSection).toBeVisible({ timeout: 3000 });
    const firstItem = recentSection.locator("button").first();
    await expect(firstItem).toBeVisible();
    await firstItem.click();
    await expect(profilePage.locator(SEL.streamPicker)).toBeVisible({ timeout: 5000 });
  });

  test("14.7 — duplicate viewing updates timestamp", async () => {
    // View same item twice
    for (let i = 0; i < 2; i++) {
      await fetch(`${API_URL}/recently-viewed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${profileToken}`,
        },
        body: JSON.stringify({
          tmdbId: 27205,
          mediaType: "movie",
          title: "Inception",
          year: 2010,
          posterPath: null,
          imdbId: "tt1375666",
        }),
      });
      await new Promise((r) => setTimeout(r, 100));
    }

    const res = await fetch(`${API_URL}/recently-viewed`, {
      headers: { Authorization: `Bearer ${profileToken}` },
    });
    const items = await res.json();
    const inceptionItems = items.filter((i: { tmdbId: number }) => i.tmdbId === 27205);
    // Should only have one entry (deduplicated)
    expect(inceptionItems.length).toBe(1);
  });

  test("14.4 — recently viewed limit", async () => {
    const res = await fetch(`${API_URL}/recently-viewed`, {
      headers: { Authorization: `Bearer ${profileToken}` },
    });
    const items = await res.json();
    expect(items.length).toBeLessThanOrEqual(20);
  });
});
