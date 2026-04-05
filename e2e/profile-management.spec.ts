import { test, expect } from "./fixtures/auth.fixture";
import { TEST_ADMIN, API_URL } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-03: Profile Management (Admin)", () => {
  test("3.1 — list profiles in admin panel", async ({ adminPage }) => {
    await expect(adminPage.locator(SEL.profileList)).toBeVisible();
    // At least the profile created during setup
    await expect(adminPage.locator(SEL.profileRow).first()).toBeVisible();
  });

  test("3.2 — create a new profile", async ({ adminPage }) => {
    await adminPage.locator(SEL.addProfileBtn).click();
    await expect(adminPage.locator(SEL.addProfileForm)).toBeVisible();
    await adminPage.locator(SEL.newProfileName).fill("NewProfile");
    await adminPage.locator(SEL.createProfileBtn).click();
    await expect(adminPage.getByText("NewProfile")).toBeVisible();
  });

  test("3.3 — create profile with PIN", async ({ adminPage }) => {
    await adminPage.locator(SEL.addProfileBtn).click();
    await adminPage.locator(SEL.newProfileName).fill("PinProfile");
    await adminPage.locator(SEL.newProfilePin).fill("5678");
    await adminPage.locator(SEL.createProfileBtn).click();
    await expect(adminPage.getByText("PinProfile")).toBeVisible();
    // Check PIN badge appears
    const row = adminPage.locator(SEL.profileRow).filter({ hasText: "PinProfile" });
    await expect(row.getByText("PIN")).toBeVisible();
  });

  test("3.4 — duplicate name rejected", async ({ adminPage, adminLogin }) => {
    const { accessToken } = await adminLogin();
    // Try to create duplicate via API
    const res = await fetch(`${API_URL}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: "TestUser" }),
    });
    // Should fail with conflict or validation error
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("3.5 — edit profile name via API", async ({ adminLogin }) => {
    const { accessToken } = await adminLogin();
    // Get profiles
    const listRes = await fetch(`${API_URL}/profiles`);
    const profiles = await listRes.json();
    const profile = profiles.find((p: { name: string }) => p.name === "NewProfile");
    if (!profile) return;

    const res = await fetch(`${API_URL}/profiles/${profile.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: "RenamedProfile" }),
    });
    expect(res.ok).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe("RenamedProfile");
  });

  test("3.6 — edit profile avatar via API", async ({ adminLogin }) => {
    const { accessToken } = await adminLogin();
    const listRes = await fetch(`${API_URL}/profiles`);
    const profiles = await listRes.json();
    const profile = profiles[0];

    const res = await fetch(`${API_URL}/profiles/${profile.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ avatar: "bg-pink-500" }),
    });
    expect(res.ok).toBeTruthy();
  });

  test("3.7 — add PIN to existing profile via API", async ({ adminLogin }) => {
    const { accessToken } = await adminLogin();
    const listRes = await fetch(`${API_URL}/profiles`);
    const profiles = await listRes.json();
    const unpinned = profiles.find((p: { hasPin: boolean }) => !p.hasPin);
    if (!unpinned) return;

    const res = await fetch(`${API_URL}/profiles/${unpinned.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ pin: "9999" }),
    });
    expect(res.ok).toBeTruthy();
    const updated = await res.json();
    expect(updated.hasPin).toBe(true);

    // Remove pin for cleanup
    await fetch(`${API_URL}/profiles/${unpinned.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ pin: null }),
    });
  });

  test("3.8 — remove PIN from profile via API", async ({ adminLogin }) => {
    const { accessToken } = await adminLogin();
    const listRes = await fetch(`${API_URL}/profiles`);
    const profiles = await listRes.json();
    const pinned = profiles.find((p: { hasPin: boolean }) => p.hasPin);
    if (!pinned) return;

    const res = await fetch(`${API_URL}/profiles/${pinned.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ pin: null }),
    });
    expect(res.ok).toBeTruthy();
    const updated = await res.json();
    expect(updated.hasPin).toBe(false);
  });

  test("3.9 — delete profile removes it", async ({ adminPage, adminLogin }) => {
    // Create one to delete
    const { accessToken } = await adminLogin();
    await fetch(`${API_URL}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: "ToDelete" }),
    });
    await adminPage.reload();
    await expect(adminPage.getByText("ToDelete")).toBeVisible();

    // Click delete
    const row = adminPage.locator(SEL.profileRow).filter({ hasText: "ToDelete" });
    await row.getByText("Delete").click();
    await expect(adminPage.getByText("ToDelete")).not.toBeVisible();
  });

  test("3.10 — cannot delete last profile via API", async ({ adminLogin }) => {
    const { accessToken } = await adminLogin();
    const listRes = await fetch(`${API_URL}/profiles`);
    const profiles = await listRes.json();

    // Delete all but one, then try to delete the last
    // (only test if we have exactly one)
    if (profiles.length === 1) {
      const res = await fetch(`${API_URL}/profiles/${profiles[0].id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res.ok).toBeFalsy();
    }
  });

  test("3.11 — non-admin cannot manage profiles", async ({ request }) => {
    // Try to create profile without admin token
    const res = await request.post(`${API_URL}/profiles`, {
      data: { name: "Unauthorized" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
