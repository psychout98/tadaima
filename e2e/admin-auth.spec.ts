import { test, expect } from "./fixtures/auth.fixture";
import { TEST_ADMIN, API_URL } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-02: Admin Authentication", () => {
  test("2.1 — successful admin login", async ({ page }) => {
    await page.goto("/admin/login");
    await page.locator(SEL.usernameInput).fill(TEST_ADMIN.username);
    await page.locator(SEL.passwordInput).fill(TEST_ADMIN.password);
    await page.getByRole("button", { name: "Log In" }).click();
    await page.waitForURL("**/admin");
    await expect(page.getByText("Admin Panel")).toBeVisible();
  });

  test("2.2 — invalid password rejected", async ({ page }) => {
    await page.goto("/admin/login");
    await page.locator(SEL.usernameInput).fill(TEST_ADMIN.username);
    await page.locator(SEL.passwordInput).fill("wrongpassword");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/admin\/login/);
  });

  test("2.3 — invalid username shows generic error", async ({ page }) => {
    await page.goto("/admin/login");
    await page.locator(SEL.usernameInput).fill("nonexistentuser");
    await page.locator(SEL.passwordInput).fill("somepassword");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page.getByText(/invalid credentials|login failed/i)).toBeVisible();
  });

  test("2.4 — empty fields keep submit disabled", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByRole("button", { name: "Log In" })).toBeDisabled();
  });

  test("2.5 — token refresh works via API", async ({ request }) => {
    // Login
    const loginRes = await request.post(`${API_URL}/auth/login`, {
      data: { username: TEST_ADMIN.username, password: TEST_ADMIN.password },
    });
    const { refreshToken } = await loginRes.json();

    // Refresh
    const refreshRes = await request.post(`${API_URL}/auth/refresh`, {
      data: { refreshToken },
    });
    expect(refreshRes.ok()).toBeTruthy();
    const body = await refreshRes.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  test("2.6 — logout clears session and redirects", async ({ page }) => {
    // Login first
    await page.goto("/admin/login");
    await page.locator(SEL.usernameInput).fill(TEST_ADMIN.username);
    await page.locator(SEL.passwordInput).fill(TEST_ADMIN.password);
    await page.getByRole("button", { name: "Log In" }).click();
    await page.waitForURL("**/admin");

    // Click logout
    await page.locator(SEL.logoutBtn).click();
    await page.waitForURL("**/profiles");

    // Try to access admin - should redirect back to login
    await page.goto("/admin");
    await page.waitForURL("**/admin/login");
  });

  test("2.7 — expired refresh token forces re-login via API", async ({ request }) => {
    const refreshRes = await request.post(`${API_URL}/auth/refresh`, {
      data: { refreshToken: "expired-invalid-token" },
    });
    expect(refreshRes.ok()).toBeFalsy();
  });

  test("2.8 — multiple login sessions work independently", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    // Login on both
    for (const page of [page1, page2]) {
      await page.goto("/admin/login");
      await page.locator(SEL.usernameInput).fill(TEST_ADMIN.username);
      await page.locator(SEL.passwordInput).fill(TEST_ADMIN.password);
      await page.getByRole("button", { name: "Log In" }).click();
      await page.waitForURL("**/admin");
    }

    // Both should see admin panel
    await expect(page1.getByText("Admin Panel")).toBeVisible();
    await expect(page2.getByText("Admin Panel")).toBeVisible();

    await ctx1.close();
    await ctx2.close();
  });
});
