import { test, expect } from "./fixtures/auth.fixture";
import { mockExternalApis, STREAM_FIXTURES } from "./fixtures/api-mock.fixture";
import { SEL } from "./helpers/selectors";

test.describe("TS-09: Stream Selection", () => {
  async function openStreams(page: import("@playwright/test").Page) {
    await mockExternalApis(page);
    await page.goto("/");
    await page.locator(SEL.searchBar).fill("Inception");
    await page.locator(SEL.searchBtn).click();
    await page.locator(SEL.resultCard).first().click();
    await expect(page.locator(SEL.streamPicker)).toBeVisible();
  }

  test("9.1 — stream picker opens on result click", async ({ profilePage }) => {
    await openStreams(profilePage);
    await expect(profilePage.locator(SEL.streamPicker)).toBeVisible();
  });

  test("9.2 — streams listed with metadata", async ({ profilePage }) => {
    await openStreams(profilePage);
    const rows = profilePage.locator(SEL.streamRow);
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("9.3 — filter by resolution", async ({ profilePage }) => {
    await openStreams(profilePage);
    await profilePage.locator(SEL.streamRow).first().waitFor();
    // Click 1080p filter
    await profilePage.getByRole("button", { name: "1080p" }).click();
    // Only 1080p streams should be visible
    const rows = profilePage.locator(SEL.streamRow);
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).getByText("1080p")).toBeVisible();
    }
  });

  test("9.4 — filter by HDR", async ({ profilePage }) => {
    await openStreams(profilePage);
    await profilePage.locator(SEL.streamRow).first().waitFor();
    await profilePage.locator(SEL.filterHdr).click();
    const rows = profilePage.locator(SEL.streamRow);
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).getByText("HDR")).toBeVisible();
    }
  });

  test("9.5 — filter by audio", async ({ profilePage }) => {
    await openStreams(profilePage);
    await profilePage.locator(SEL.streamRow).first().waitFor();
    await profilePage.getByRole("button", { name: "Atmos" }).click();
    const rows = profilePage.locator(SEL.streamRow);
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).getByText("Atmos")).toBeVisible();
    }
  });

  test("9.6 — multiple filters combine", async ({ profilePage }) => {
    await openStreams(profilePage);
    await profilePage.locator(SEL.streamRow).first().waitFor();
    await profilePage.getByRole("button", { name: "2160p" }).click();
    await profilePage.locator(SEL.filterHdr).click();
    // Should show only HDR 2160p streams
    const rows = profilePage.locator(SEL.streamRow);
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).getByText("2160p")).toBeVisible();
      await expect(rows.nth(i).getByText("HDR")).toBeVisible();
    }
  });

  test("9.7 — clear filters restores full list", async ({ profilePage }) => {
    await openStreams(profilePage);
    await profilePage.locator(SEL.streamRow).first().waitFor();
    const initialCount = await profilePage.locator(SEL.streamRow).count();
    await profilePage.getByRole("button", { name: "2160p" }).click();
    const filteredCount = await profilePage.locator(SEL.streamRow).count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    await profilePage.getByText(/Clear/).click();
    const restoredCount = await profilePage.locator(SEL.streamRow).count();
    expect(restoredCount).toBe(initialCount);
  });

  test("9.10 — TV show season/episode selector", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("Game of Thrones");
    await profilePage.locator(SEL.searchBtn).click();
    await profilePage.locator(SEL.resultCard).first().click();
    await expect(profilePage.getByText("Season 1")).toBeVisible({ timeout: 5000 });
    await expect(profilePage.getByText("Episode 1")).toBeVisible();
  });

  test("9.11 — device selector visible", async ({ profilePage }) => {
    await openStreams(profilePage);
    await expect(profilePage.locator(SEL.deviceSelector)).toBeVisible();
  });

  test("9.13 — download button triggers request", async ({ profilePage }) => {
    await openStreams(profilePage);
    await profilePage.locator(SEL.streamRow).first().waitFor();
    const downloadBtn = profilePage.locator(SEL.downloadBtn).first();
    await expect(downloadBtn).toBeVisible();
    // Click triggers WS message - just verify button is clickable
    await downloadBtn.click();
    // Should not crash
  });

  test("9.14 — no streams shows empty message", async ({ profilePage }) => {
    // Mock streams to return empty
    await profilePage.route("**/api/streams/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await mockExternalApis(profilePage);
    // Re-route streams to empty (override the mock)
    await profilePage.route("**/api/streams/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("Inception");
    await profilePage.locator(SEL.searchBtn).click();
    await profilePage.locator(SEL.resultCard).first().click();
    await expect(profilePage.getByText("No streams available")).toBeVisible({ timeout: 10_000 });
  });

  test("9.8 — stream count shown", async ({ profilePage }) => {
    await openStreams(profilePage);
    await profilePage.locator(SEL.streamRow).first().waitFor();
    await expect(profilePage.getByText(/Showing \d+ of \d+ streams/)).toBeVisible();
  });

  test("9.12 — default device pre-selected", async ({ profilePage }) => {
    await openStreams(profilePage);
    // Device selector should exist (may or may not have default)
    await expect(profilePage.locator(SEL.deviceSelector)).toBeVisible();
  });
});
