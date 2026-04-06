import { test as base, type Page, type BrowserContext } from "@playwright/test";
import { TEST_ADMIN, TEST_PROFILE, API_URL } from "../helpers/constants";

type AuthFixtures = {
  /** Ensures setup wizard has been completed (runs once, cached) */
  setupComplete: void;
  /** A fresh page logged in as admin */
  adminPage: Page;
  /** A fresh page with a profile selected */
  profilePage: Page;
  /** Helper to complete setup via API */
  apiSetup: () => Promise<void>;
  /** Helper to login as admin and get token */
  adminLogin: () => Promise<{ accessToken: string; refreshToken: string }>;
  /** Helper to select a profile and get token */
  profileSelect: (profileId?: string) => Promise<{ token: string; profile: { id: string; name: string } }>;
};

export const test = base.extend<AuthFixtures>({
  apiSetup: async ({}, use) => {
    const fn = async () => {
      const statusRes = await fetch(`${API_URL}/setup/status`);
      const { needsSetup } = await statusRes.json();
      if (!needsSetup) return;

      await fetch(`${API_URL}/setup/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: TEST_ADMIN.username,
          password: TEST_ADMIN.password,
          tmdbApiKey: "test-tmdb-key-e2e",
          rdApiKey: "test-rd-key-e2e",
          profileName: TEST_PROFILE.name,
          profileAvatar: TEST_PROFILE.avatar,
        }),
      });
    };
    await use(fn);
  },

  setupComplete: [
    async ({ apiSetup }, use) => {
      await apiSetup();
      await use();
    },
    { auto: true },
  ],

  adminLogin: async ({}, use) => {
    const fn = async () => {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: TEST_ADMIN.username,
          password: TEST_ADMIN.password,
        }),
      });
      return res.json();
    };
    await use(fn);
  },

  adminPage: async ({ browser, setupComplete: _ }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Login via API, then store token in localStorage
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: TEST_ADMIN.username,
        password: TEST_ADMIN.password,
      }),
    });
    const { accessToken, refreshToken } = await res.json();

    await page.goto("/admin");
    await page.evaluate(
      ({ accessToken, refreshToken }) => {
        const store = JSON.parse(localStorage.getItem("auth-store") ?? "{}");
        store.state = {
          ...store.state,
          adminToken: accessToken,
          adminRefreshToken: refreshToken,
        };
        localStorage.setItem("auth-store", JSON.stringify(store));
      },
      { accessToken, refreshToken },
    );
    await page.reload();
    await page.waitForLoadState("networkidle");

    await use(page);

    // Cleanup: remove any test data created during admin session
    try {
      const profilesRes = await fetch(`${API_URL}/profiles`);
      const profiles = await profilesRes.json();
      // Delete any profiles beyond the first one (the default test profile)
      for (const p of profiles.slice(1)) {
        await fetch(`${API_URL}/profiles/${p.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      }
    } catch {
      // Best-effort cleanup
    }

    await ctx.close();
  },

  profilePage: async ({ browser, setupComplete: _ }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Get profiles
    const profilesRes = await fetch(`${API_URL}/profiles`);
    const profiles = await profilesRes.json();
    const profile = profiles[0];

    // Select profile via API
    const selectRes = await fetch(`${API_URL}/profiles/${profile.id}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { token } = await selectRes.json();

    // Also login as admin for admin features
    const adminRes = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: TEST_ADMIN.username,
        password: TEST_ADMIN.password,
      }),
    });
    const { accessToken: adminToken, refreshToken: adminRefreshToken } = await adminRes.json();

    await page.goto("/");
    await page.evaluate(
      ({ token, profile, adminToken, adminRefreshToken }) => {
        const store = JSON.parse(localStorage.getItem("auth-store") ?? "{}");
        store.state = {
          ...store.state,
          profileToken: token,
          profile: {
            id: profile.id,
            name: profile.name,
            avatar: profile.avatar,
            hasPin: profile.hasPin,
          },
          adminToken,
          adminRefreshToken,
        };
        localStorage.setItem("auth-store", JSON.stringify(store));
      },
      { token, profile, adminToken, adminRefreshToken },
    );
    await page.reload();

    // Snapshot devices before test
    let beforeDeviceIds = new Set<string>();
    try {
      const devicesRes = await fetch(`${API_URL}/devices`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (devicesRes.ok) {
        const devices = await devicesRes.json();
        beforeDeviceIds = new Set(devices.map((d: { id: string }) => d.id));
      }
    } catch {
      // Best-effort
    }

    await use(page);

    // Cleanup: only delete devices created during this test
    try {
      const devicesRes = await fetch(`${API_URL}/devices`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (devicesRes.ok) {
        const devices = await devicesRes.json();
        for (const d of devices) {
          if (!beforeDeviceIds.has(d.id)) {
            await fetch(`${API_URL}/devices/${d.id}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${adminToken}` },
            });
          }
        }
      }
    } catch {
      // Best-effort cleanup
    }

    await ctx.close();
  },

  profileSelect: async ({}, use) => {
    const fn = async (profileId?: string) => {
      let id = profileId;
      if (!id) {
        const profilesRes = await fetch(`${API_URL}/profiles`);
        const profiles = await profilesRes.json();
        id = profiles[0].id;
      }
      const res = await fetch(`${API_URL}/profiles/${id}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return res.json();
    };
    await use(fn);
  },
});

export { expect } from "@playwright/test";
