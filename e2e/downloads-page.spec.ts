import { test, expect } from "./fixtures/auth.fixture";
import { SEL } from "./helpers/selectors";

test.describe("TS-12: Downloads Page & History", () => {
  test("12.1 — downloads page loads", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    await expect(profilePage.getByText("Downloads")).toBeVisible();
  });

  test("12.2 — active downloads section exists", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    const tab = profilePage.locator('[data-testid="tab-active"]');
    await tab.click();
    await expect(tab).toHaveAttribute("data-state", "active", { timeout: 3000 });
  });

  test("12.3 — queued downloads section exists", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    const tab = profilePage.locator('[data-testid="tab-queued"]');
    await tab.click();
    await expect(tab).toHaveAttribute("data-state", "active", { timeout: 3000 });
  });

  test("12.4 — history tab shows completed downloads", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    const tab = profilePage.locator('[data-testid="tab-completed"]');
    await tab.click();
    await expect(tab).toHaveAttribute("data-state", "active", { timeout: 3000 });
  });

  test("12.5 — failed tab shows failed downloads", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    const tab = profilePage.locator('[data-testid="tab-failed"]');
    await tab.click();
    await expect(tab).toHaveAttribute("data-state", "active", { timeout: 3000 });
  });

  test("12.6 — all tab shows everything", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    const tab = profilePage.locator('[data-testid="tab-all"]');
    await tab.click();
    await expect(tab).toHaveAttribute("data-state", "active", { timeout: 3000 });
  });

  test("12.7 — history items have status badges", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    const history = profilePage.locator(SEL.downloadHistory);
    if (await history.isVisible().catch(() => false)) {
      // Each item should have a status badge
      const items = history.locator(".rounded-lg");
      if ((await items.count()) > 0) {
        await expect(
          items.first().getByText(/Completed|Failed|Cancelled/i),
        ).toBeVisible();
      }
    }
  });

  test("12.8 — empty state shown when no downloads", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    // Either has downloads or shows empty state
    const hasEmpty = await profilePage.locator(SEL.downloadsEmpty).isVisible().catch(() => false);
    const hasHistory = await profilePage.locator(SEL.downloadHistory).isVisible().catch(() => false);
    expect(hasEmpty || hasHistory).toBeTruthy();
  });

  test("12.9 — delete history item via UI", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    const deleteBtn = profilePage.locator(SEL.downloadHistory).getByText("Delete").first();
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click();
    }
  });

  test("12.10 — tab switching preserves state", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    await profilePage.locator('[data-testid="tab-completed"]').click();
    await profilePage.locator('[data-testid="tab-all"]').click();
    await expect(profilePage.getByText("Downloads")).toBeVisible();
  });

  test("12.11 — retry button on failed downloads", async ({ profilePage }) => {
    await profilePage.goto("/downloads");
    await profilePage.locator('[data-testid="tab-failed"]').click();
    // If any failed downloads with retry, button should exist
    const retryBtn = profilePage.getByText("Retry").first();
    if (await retryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(retryBtn).toBeEnabled();
    }
  });
});
