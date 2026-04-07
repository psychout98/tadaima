import { test, expect } from "./fixtures/auth.fixture";
import { SEL } from "./helpers/selectors";

test.describe("TS-15: Settings Page", () => {
  test("15.1 — settings page loads", async ({ profilePage }) => {
    await profilePage.goto("/settings");
    await expect(profilePage.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("15.2 — change profile PIN", async ({ profilePage }) => {
    await profilePage.goto("/settings");
    await profilePage.locator(SEL.pinInput).fill("4567");
    await profilePage.locator(SEL.setPinBtn).click();
    await expect(profilePage.locator(SEL.pinMsg)).toBeVisible();
    await expect(profilePage.locator(SEL.pinMsg)).toHaveText(/PIN updated/i);
  });

  test("15.3 — remove profile PIN", async ({ profilePage }) => {
    await profilePage.goto("/settings");
    await profilePage.locator(SEL.pinInput).clear();
    await profilePage.locator(SEL.setPinBtn).click();
    await expect(profilePage.locator(SEL.pinMsg)).toHaveText(/PIN removed/i);
  });

  test("15.4 — switch profile from settings", async ({ profilePage }) => {
    await profilePage.goto("/settings");
    await profilePage.locator(SEL.switchProfileBtn).click();
    await profilePage.waitForURL("**/profiles");
  });
});
