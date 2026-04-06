import { type Page, expect } from "@playwright/test";

/** Wait for a navigation to complete and the page to be stable */
export async function waitForNav(page: Page, url: string | RegExp) {
  await page.waitForURL(url, { waitUntil: "networkidle" });
}

/** Wait for a toast notification with specific text */
export async function waitForToast(page: Page, text: string | RegExp) {
  const toast = page.locator('[data-testid="toast"]').filter({ hasText: text });
  await expect(toast.first()).toBeVisible({ timeout: 10_000 });
  return toast.first();
}

/** Wait for WebSocket connection to be established */
export async function waitForWsConnected(page: Page) {
  await expect(
    page.locator('[data-testid="connection-status"]').filter({ hasText: "Connected" }),
  ).toBeVisible({ timeout: 10_000 });
}

/** Wait for loading state to resolve */
export async function waitForLoaded(page: Page) {
  // Wait for any "Loading..." text to disappear
  await page.waitForFunction(
    () => !document.body.textContent?.includes("Loading..."),
    null,
    { timeout: 10_000 },
  );
}

/** Dismiss all visible toasts */
export async function dismissToasts(page: Page) {
  const toasts = page.locator('[data-testid="toast-close"]');
  const count = await toasts.count();
  for (let i = 0; i < count; i++) {
    await toasts.nth(i).click().catch(() => {});
  }
}
