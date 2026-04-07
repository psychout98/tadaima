import { test, expect } from "./fixtures/auth.fixture";
import { mockExternalApis, TMDB_SEARCH_RESULTS } from "./fixtures/api-mock.fixture";
import { SEL } from "./helpers/selectors";

test.describe("TS-08: Search & Browse", () => {
  test("8.1 — search page loads", async ({ profilePage }) => {
    await profilePage.goto("/");
    await expect(profilePage.locator(SEL.searchBar)).toBeVisible();
  });

  test("8.2 — search for movie returns results", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("Inception");
    await profilePage.locator(SEL.searchBtn).click();
    await expect(profilePage.locator(SEL.resultsGrid)).toBeVisible();
    await expect(profilePage.locator(SEL.resultCard).first()).toBeVisible();
  });

  test("8.3 — search for TV show returns results", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("Game of Thrones");
    await profilePage.locator(SEL.searchBtn).click();
    await expect(profilePage.locator(SEL.resultCard).first()).toBeVisible();
  });

  test("8.4 — empty search results shows message", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("xyznonexistent123");
    await profilePage.locator(SEL.searchBtn).click();
    await expect(profilePage.locator(SEL.noResults)).toBeVisible();
  });

  test("8.5 — result card displays title and year", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("Inception");
    await profilePage.locator(SEL.searchBtn).click();
    const card = profilePage.locator(SEL.resultCard).first();
    await expect(card).toBeVisible();
    await expect(card.getByText("Inception")).toBeVisible();
    await expect(card.getByText("2010")).toBeVisible();
  });

  test("8.6 — click result opens stream picker", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("Inception");
    await profilePage.locator(SEL.searchBtn).click();
    await profilePage.locator(SEL.resultCard).first().click();
    await expect(profilePage.locator(SEL.streamPicker)).toBeVisible();
  });

  test("8.7 — movie details show metadata", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("Inception");
    await profilePage.locator(SEL.searchBtn).click();
    await profilePage.locator(SEL.resultCard).first().click();
    await expect(profilePage.getByRole("heading", { name: "Inception" })).toBeVisible();
    await expect(profilePage.getByText("2010")).toBeVisible();
    await expect(profilePage.getByText("Movie")).toBeVisible();
  });

  test("8.8 — TV show details show seasons", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("Game of Thrones");
    await profilePage.locator(SEL.searchBtn).click();
    await profilePage.locator(SEL.resultCard).first().click();
    // Season selector should be visible for TV
    const seasonSelect = profilePage.locator("select").first();
    await expect(seasonSelect).toHaveValue("1", { timeout: 5000 });
  });

  test("8.9 — media type badge displayed", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("Inception");
    await profilePage.locator(SEL.searchBtn).click();
    // Movie badge
    await expect(profilePage.locator(SEL.resultCard).first().getByText("Movie")).toBeVisible();
  });

  test("8.10 — search doesn't trigger on empty input", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await expect(profilePage.locator(SEL.searchBtn)).toBeDisabled();
  });

  test("8.11 — close button on stream picker returns to results", async ({ profilePage }) => {
    await mockExternalApis(profilePage);
    await profilePage.goto("/");
    await profilePage.locator(SEL.searchBar).fill("Inception");
    await profilePage.locator(SEL.searchBtn).click();
    await profilePage.locator(SEL.resultCard).first().click();
    await expect(profilePage.locator(SEL.streamPicker)).toBeVisible();
    await profilePage.getByText("Close").click();
    await expect(profilePage.locator(SEL.resultsGrid)).toBeVisible();
  });

  test("8.12 — unauthenticated search rejected via API", async ({ request }) => {
    const res = await request.get("/api/search?q=test");
    // Should require auth or return error
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
