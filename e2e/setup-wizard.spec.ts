import { test, expect } from "@playwright/test";
import { TEST_ADMIN, TEST_TMDB_KEY, TEST_RD_KEY, TEST_PROFILE, API_URL } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-01a: Setup Wizard (pre-setup)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    await fetch(`${API_URL}/setup/reset`, { method: "POST" });
  });

  // 1.11 - API status pre-setup
  test("1.11 — GET /api/setup/status returns needsSetup: true on fresh DB", async ({ request }) => {
    const res = await request.get(`${API_URL}/setup/status`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.needsSetup).toBe(true);
  });

  // 1.1 - Fresh instance redirects to /setup
  test("1.1 — fresh instance redirects to /setup", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/setup");
    await expect(page.locator(SEL.setupWizard)).toBeVisible();
  });

  // 1.2 - Step 1 create admin account
  test("1.2 — step 1: create admin account and advance", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.locator(SEL.setupStepAdmin)).toBeVisible();
    await page.locator(SEL.usernameInput).fill(TEST_ADMIN.username);
    await page.locator(SEL.passwordInput).fill(TEST_ADMIN.password);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator(SEL.setupStepTmdb)).toBeVisible();
  });

  // 1.3 - Password mismatch (password < 8 chars keeps Next disabled)
  test("1.3 — short password keeps Next button disabled", async ({ page }) => {
    await page.goto("/setup");
    await page.locator(SEL.usernameInput).fill("admin");
    await page.locator(SEL.passwordInput).fill("short");
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  // 1.4 - Short password rejected
  test("1.4 — empty username keeps Next button disabled", async ({ page }) => {
    await page.goto("/setup");
    await page.locator(SEL.passwordInput).fill("longpassword123");
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  // 1.5 - Step 2: TMDB key
  test("1.5 — step 2: enter TMDB key and advance", async ({ page }) => {
    await page.goto("/setup");
    // Advance past step 1
    await page.locator(SEL.usernameInput).fill(TEST_ADMIN.username);
    await page.locator(SEL.passwordInput).fill(TEST_ADMIN.password);
    await page.getByRole("button", { name: "Next" }).click();
    // Step 2
    await expect(page.locator(SEL.setupStepTmdb)).toBeVisible();
    await page.getByPlaceholder("TMDB API key").fill(TEST_TMDB_KEY);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator(SEL.setupStepRd)).toBeVisible();
  });

  // 1.6 - Empty TMDB key keeps Next disabled
  test("1.6 — empty TMDB key keeps Next disabled", async ({ page }) => {
    await page.goto("/setup");
    await page.locator(SEL.usernameInput).fill(TEST_ADMIN.username);
    await page.locator(SEL.passwordInput).fill(TEST_ADMIN.password);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  // 1.7 - Step 3: RD key
  test("1.7 — step 3: enter RD key and advance", async ({ page }) => {
    await page.goto("/setup");
    await page.locator(SEL.usernameInput).fill(TEST_ADMIN.username);
    await page.locator(SEL.passwordInput).fill(TEST_ADMIN.password);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByPlaceholder("TMDB API key").fill(TEST_TMDB_KEY);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByPlaceholder("Real-Debrid API key").fill(TEST_RD_KEY);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator(SEL.setupStepProfile)).toBeVisible();
  });

  // 1.8 - Empty RD key keeps Next disabled
  test("1.8 — empty RD key keeps Next disabled", async ({ page }) => {
    await page.goto("/setup");
    await page.locator(SEL.usernameInput).fill(TEST_ADMIN.username);
    await page.locator(SEL.passwordInput).fill(TEST_ADMIN.password);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByPlaceholder("TMDB API key").fill(TEST_TMDB_KEY);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});

test.describe("TS-01b: Setup Wizard (complete flow)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await fetch(`${API_URL}/setup/reset`, { method: "POST" });
  });

  // 1.9 - Step 4: Complete setup (creates admin + first profile)
  test("1.9 — step 4: complete setup creates admin and profile", async ({ page }) => {
    await page.goto("/setup");
    // Step 1
    await page.locator(SEL.usernameInput).fill(TEST_ADMIN.username);
    await page.locator(SEL.passwordInput).fill(TEST_ADMIN.password);
    await page.getByRole("button", { name: "Next" }).click();
    // Step 2
    await page.getByPlaceholder("TMDB API key").fill(TEST_TMDB_KEY);
    await page.getByRole("button", { name: "Next" }).click();
    // Step 3
    await page.getByPlaceholder("Real-Debrid API key").fill(TEST_RD_KEY);
    await page.getByRole("button", { name: "Next" }).click();
    // Step 4
    await page.getByPlaceholder(/Profile name/).fill(TEST_PROFILE.name);
    await page.getByRole("button", { name: "Complete Setup" }).click();
    await page.waitForURL("**/profiles");
    await expect(page.getByText(TEST_PROFILE.name)).toBeVisible();
  });

  // 1.10 - Setup idempotency
  test("1.10 — setup page redirects away after setup is complete", async ({ page }) => {
    await page.goto("/setup");
    // Should be redirected away since setup is already done
    await page.waitForURL(/\/(profiles|$)/);
  });

  // 1.12 - API status post-setup
  test("1.12 — GET /api/setup/status returns needsSetup: false after setup", async ({ request }) => {
    const res = await request.get(`${API_URL}/setup/status`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.needsSetup).toBe(false);
  });
});
