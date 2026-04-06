import { test, expect } from "./fixtures/auth.fixture";
import { SEL } from "./helpers/selectors";

test.describe("TS-18: Navigation & App Shell", () => {
  test("18.1 — sidebar renders with nav links", async ({ profilePage }) => {
    await profilePage.goto("/");
    await expect(profilePage.locator(SEL.sidebar)).toBeVisible();
    await expect(profilePage.locator(SEL.navSearch)).toBeVisible();
    await expect(profilePage.locator(SEL.navDownloads)).toBeVisible();
    await expect(profilePage.locator(SEL.navDevices)).toBeVisible();
    await expect(profilePage.locator(SEL.navSettings)).toBeVisible();
  });

  test("18.2 — navigate to Search", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    await profilePage.locator(SEL.navSearch).click();
    await profilePage.waitForURL("/");
    await expect(profilePage.locator(SEL.searchBar)).toBeVisible();
  });

  test("18.3 — navigate to Downloads", async ({ profilePage }) => {
    await profilePage.goto("/");
    await profilePage.locator(SEL.navDownloads).click();
    await profilePage.waitForURL("**/downloads");
    await expect(profilePage.getByText("Downloads")).toBeVisible();
  });

  test("18.4 — navigate to Devices", async ({ profilePage }) => {
    await profilePage.goto("/");
    await profilePage.locator(SEL.navDevices).click();
    await profilePage.waitForURL("**/devices");
    await expect(profilePage.getByText("Devices")).toBeVisible();
  });

  test("18.5 — navigate to Settings", async ({ profilePage }) => {
    await profilePage.goto("/");
    await profilePage.locator(SEL.navSettings).click();
    await profilePage.waitForURL("**/settings");
    await expect(profilePage.getByText("Settings")).toBeVisible();
  });

  test("18.6 — active link highlighted", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    const navLink = profilePage.locator(SEL.navDownloads);
    await expect(navLink).toHaveClass(/font-medium/);
  });

  test("18.7 — profile name/avatar shown in sidebar", async ({ profilePage }) => {
    await profilePage.goto("/");
    await expect(profilePage.locator(SEL.profileName)).toBeVisible();
  });

  test("18.8 — switch profile link works", async ({ profilePage }) => {
    await profilePage.goto("/");
    await profilePage.locator(SEL.sidebar).getByText("Switch profile").click();
    await profilePage.waitForURL("**/profiles");
  });

  test("18.9 — connection status in shell", async ({ profilePage }) => {
    await profilePage.goto("/");
    await expect(profilePage.locator(SEL.connectionStatus)).toBeVisible();
  });

  test("18.10 — sidebar present on all pages", async ({ profilePage }) => {
    for (const path of ["/", "/downloads", "/devices", "/settings"]) {
      await profilePage.goto(path);
      await expect(profilePage.locator(SEL.sidebar)).toBeVisible();
    }
  });
});
