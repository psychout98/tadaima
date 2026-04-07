import { test, expect } from "./fixtures/auth.fixture";
import { TEST_ADMIN, API_URL, uniqueDeviceName } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-04: Profile Picker & Selection", () => {
  test("4.1 — profile grid renders all profiles", async ({ page }) => {
    await page.goto("/profiles");
    await expect(page.locator(SEL.profileGrid)).toBeVisible();
    const cards = page.locator(SEL.profileCard);
    expect(await cards.count()).toBeGreaterThan(0);
  });

  test("4.2 — select profile without PIN navigates to app", async ({ page, adminLogin, workerIndex }) => {
    // Create a guaranteed non-PIN profile for this worker
    const { accessToken } = await adminLogin();
    const noPinName = uniqueDeviceName(workerIndex, "NoPinSelect");
    await fetch(`${API_URL}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: noPinName }),
    }).catch(() => {}); // Ignore if already exists

    await page.goto("/profiles");
    const card = page.locator(SEL.profileCard).filter({ hasText: noPinName });
    await expect(card).toBeVisible();
    await card.click();
    await page.waitForURL("/");
  });

  test("4.3 — select PIN-protected profile shows PIN input", async ({ page, adminLogin, workerIndex }) => {
    // Create a profile with PIN (unique to worker)
    const { accessToken } = await adminLogin();
    const pinProfileName = uniqueDeviceName(workerIndex, "PinPick3");
    await fetch(`${API_URL}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: pinProfileName, pin: "1234" }),
    }).catch(() => {}); // Ignore if already exists

    await page.goto("/profiles");
    const card = page.locator(SEL.profileCard).filter({ hasText: pinProfileName });
    await card.click();
    await expect(page.locator(SEL.pinInput)).toBeVisible();
  });

  test("4.4 — correct PIN accepted", async ({ page, adminLogin, workerIndex }) => {
    // Create a PIN profile specifically for this test
    const { accessToken } = await adminLogin();
    const pinProfileName = uniqueDeviceName(workerIndex, "PinPick4");
    await fetch(`${API_URL}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: pinProfileName, pin: "1234" }),
    }).catch(() => {}); // Ignore if already exists

    await page.goto("/profiles");
    const card = page.locator(SEL.profileCard).filter({ hasText: pinProfileName });
    await card.click();
    await page.locator(SEL.pinInput).fill("1234");
    await page.getByRole("button", { name: "Enter" }).click();
    await page.waitForURL("/");
  });

  test("4.5 — wrong PIN rejected", async ({ page, adminLogin, workerIndex }) => {
    // Create a PIN profile specifically for this test
    const { accessToken } = await adminLogin();
    const pinProfileName = uniqueDeviceName(workerIndex, "PinPick5");
    await fetch(`${API_URL}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: pinProfileName, pin: "1234" }),
    }).catch(() => {}); // Ignore if already exists

    await page.goto("/profiles");
    const card = page.locator(SEL.profileCard).filter({ hasText: pinProfileName });
    await card.click();
    await page.locator(SEL.pinInput).fill("0000");
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.locator(SEL.pinError)).toBeVisible();
  });

  test("4.6 — PIN input accepts only digits", async ({ page, adminLogin, workerIndex }) => {
    // Create a PIN profile specifically for this test
    const { accessToken } = await adminLogin();
    const pinProfileName = uniqueDeviceName(workerIndex, "PinPick6");
    await fetch(`${API_URL}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: pinProfileName, pin: "1234" }),
    }).catch(() => {}); // Ignore if already exists

    await page.goto("/profiles");
    const card = page.locator(SEL.profileCard).filter({ hasText: pinProfileName });
    await card.click();
    await expect(page.locator(SEL.pinInput)).toBeVisible();
    await page.locator(SEL.pinInput).fill("abcd");
    await expect(page.locator(SEL.pinInput)).toHaveValue("");
  });

  test("4.7 — admin link visible when admin token exists", async ({ page }) => {
    // Set admin token in localStorage
    await page.goto("/profiles");
    await page.evaluate(() => {
      const store = JSON.parse(localStorage.getItem("auth-store") ?? '{"state":{}}');
      store.state = { ...store.state, adminToken: "fake-token" };
      localStorage.setItem("auth-store", JSON.stringify(store));
    });
    await page.reload();
    await expect(page.getByText("Manage")).toBeVisible();
  });

  test("4.8 — profile session token stored after selection", async ({ page, adminLogin, workerIndex }) => {
    // Create a guaranteed non-PIN profile for this worker
    const { accessToken } = await adminLogin();
    const noPinName = uniqueDeviceName(workerIndex, "NoPinStore");
    await fetch(`${API_URL}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: noPinName }),
    }).catch(() => {}); // Ignore if already exists

    await page.goto("/profiles");
    const card = page.locator(SEL.profileCard).filter({ hasText: noPinName });
    await expect(card).toBeVisible();
    await card.click();
    await page.waitForURL("/");
    const store = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem("auth-store") ?? "{}");
    });
    expect(store.state?.profileToken).toBeTruthy();
    expect(store.state?.profile?.id).toBeTruthy();
  });

  test("4.9 — switch profile returns to picker", async ({ profilePage }) => {
    // profilePage is already in the app with a profile selected
    await profilePage.goto("/");
    // Click the profile/switch button in sidebar
    await profilePage.locator(SEL.sidebar).getByText("Switch profile").click();
    await profilePage.waitForURL("**/profiles");
    await expect(profilePage.locator(SEL.profileGrid)).toBeVisible();
  });
});
