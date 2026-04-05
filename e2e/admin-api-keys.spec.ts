import { test, expect } from "./fixtures/auth.fixture";
import { API_URL, TEST_ADMIN } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-16: Admin Panel — API Keys", () => {
  test("16.1 — view current API keys in admin panel", async ({ adminPage }) => {
    await expect(adminPage.getByText("Instance Settings")).toBeVisible();
    await expect(adminPage.getByText("Real-Debrid API Key")).toBeVisible();
    await expect(adminPage.getByText("TMDB API Key")).toBeVisible();
  });

  test("16.2 — update TMDB key", async ({ adminPage }) => {
    await adminPage.locator(SEL.tmdbApiKeyInput).fill("new-tmdb-key-test");
    await adminPage.locator(SEL.saveSettingsBtn).click();
    await expect(adminPage.locator(SEL.settingsMsg)).toHaveText(/saved/i);
  });

  test("16.3 — update RD key", async ({ adminPage }) => {
    await adminPage.locator(SEL.rdApiKeyInput).fill("new-rd-key-test");
    await adminPage.locator(SEL.saveSettingsBtn).click();
    await expect(adminPage.locator(SEL.settingsMsg)).toHaveText(/saved/i);
  });

  test("16.4 — save button disabled when fields empty", async ({ adminPage }) => {
    await expect(adminPage.locator(SEL.saveSettingsBtn)).toBeDisabled();
  });

  test("16.5 — settings endpoint requires admin auth", async ({ request }) => {
    const res = await request.get(`${API_URL}/admin/settings`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("16.6 — settings API returns key info", async ({ adminLogin }) => {
    const { accessToken } = await adminLogin();
    const res = await fetch(`${API_URL}/admin/settings`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.ok).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("rdApiKey");
    expect(body).toHaveProperty("tmdbApiKey");
  });

  test("16.7 — update settings via API", async ({ adminLogin }) => {
    const { accessToken } = await adminLogin();
    const res = await fetch(`${API_URL}/admin/settings`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ tmdbApiKey: "api-test-key-updated" }),
    });
    expect(res.ok).toBeTruthy();
  });

  test("16.8 — non-admin cannot access settings", async ({ request }) => {
    const res = await request.get(`${API_URL}/admin/settings`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
