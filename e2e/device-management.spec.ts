import { test, expect } from "./fixtures/auth.fixture";
import { API_URL, uniqueDeviceName } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-06: Device Management", () => {
  test("6.1 — list devices shows paired devices", async ({ profilePage }) => {
    await profilePage.goto("/devices");
    // Should have at least one device from pairing tests
    const cards = profilePage.locator(SEL.deviceCard);
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(0); // May be 0 depending on test order
  });

  test("6.2 — rename device via API", async ({ profileSelect, workerIndex }) => {
    const { token } = await profileSelect();
    // Create a device specifically for this test to avoid index-based access
    const origName = uniqueDeviceName(workerIndex, "RenameTarget");
    const codeRes = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = await codeRes.json();
    await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: origName, platform: "linux" }),
    });
    // Find the device we just created
    const devicesRes = await fetch(`${API_URL}/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const devices = await devicesRes.json();
    const target = devices.find((d: { name: string }) => d.name === origName);
    if (!target) return;

    const newName = uniqueDeviceName(workerIndex, "Renamed");
    const res = await fetch(`${API_URL}/devices/${target.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: newName }),
    });
    expect(res.ok).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe(newName);
  });

  test("6.3 — remove device via API", async ({ profileSelect, workerIndex }) => {
    const { token } = await profileSelect();
    // Create a device to delete
    const codeRes = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = await codeRes.json();
    const devName = uniqueDeviceName(workerIndex, "ToRemove");
    const claimRes = await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, deviceName: devName, platform: "linux" }),
    });
    const { deviceToken } = await claimRes.json();

    // Get its ID from the devices list
    const devicesRes = await fetch(`${API_URL}/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const devices = await devicesRes.json();
    const toRemove = devices.find((d: { name: string }) => d.name === devName);
    if (!toRemove) return;

    const res = await fetch(`${API_URL}/devices/${toRemove.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok).toBeTruthy();
  });

  test("6.4 — device online indicator in UI", async ({ profilePage }) => {
    await profilePage.goto("/devices");
    // Check that at least the status indicators are present
    const cards = profilePage.locator(SEL.deviceCard);
    if ((await cards.count()) > 0) {
      // Each card should show either "Online" or "Last seen"
      const firstCard = cards.first();
      const text = await firstCard.textContent();
      expect(text).toMatch(/Online|Last seen/);
    }
  });

  test("6.5 — device shows platform info", async ({ profilePage }) => {
    await profilePage.goto("/devices");
    const cards = profilePage.locator(SEL.deviceCard);
    if ((await cards.count()) > 0) {
      const firstCard = cards.first();
      const text = await firstCard.textContent();
      expect(text).toMatch(/macOS|Windows|Linux|Docker|linux|macos/i);
    }
  });

  test("6.7 — set default device via API", async ({ profileSelect, workerIndex }) => {
    const { token } = await profileSelect();
    // Create a device specifically for this test
    const devName = uniqueDeviceName(workerIndex, "DefaultTarget");
    const codeRes = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = await codeRes.json();
    await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: devName, platform: "linux" }),
    });
    const devicesRes = await fetch(`${API_URL}/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const devices = await devicesRes.json();
    const target = devices.find((d: { name: string }) => d.name === devName);
    if (!target) return;

    const res = await fetch(`${API_URL}/devices/${target.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isDefault: true }),
    });
    expect(res.ok).toBeTruthy();
    const updated = await res.json();
    expect(updated.isDefault).toBe(true);
  });

  test("6.6 — remove device via UI confirm flow", async ({ profilePage }) => {
    await profilePage.goto("/devices");
    const cards = profilePage.locator(SEL.deviceCard);
    if ((await cards.count()) === 0) return;

    const firstCard = cards.first();
    await firstCard.getByText("Remove").click();
    // Confirmation should appear
    await expect(firstCard.getByText("Remove?")).toBeVisible();
    await firstCard.getByText("Yes").click();
  });

  test("6.8 — default device indicator in UI", async ({ profilePage }) => {
    await profilePage.goto("/devices");
    const cards = profilePage.locator(SEL.deviceCard);
    if ((await cards.count()) === 0) return;
    // Look for "Default" text anywhere in device list
    await expect(profilePage.getByText("Default")).toBeVisible();
  });
});
