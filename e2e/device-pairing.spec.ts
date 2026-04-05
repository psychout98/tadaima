import { test, expect } from "./fixtures/auth.fixture";
import { API_URL } from "./helpers/constants";
import { SEL } from "./helpers/selectors";

test.describe("TS-05: Device Pairing", () => {
  test("5.1 — generate pairing code displays code", async ({ profilePage }) => {
    await profilePage.goto("/devices");
    await profilePage.locator(SEL.pairBtn).click();
    await expect(profilePage.locator(SEL.pairingCode)).toBeVisible();
    const code = await profilePage.locator(SEL.pairingCode).textContent();
    expect(code?.trim().length).toBeGreaterThanOrEqual(6);
  });

  test("5.2 — pairing code is 6 alphanumeric characters", async ({ profileSelect }) => {
    const { token } = await profileSelect();
    const res = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(body.expiresAt).toBeTruthy();
  });

  test("5.4 — claim pairing code via API", async ({ profileSelect }) => {
    const { token } = await profileSelect();
    // Generate code
    const codeRes = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = await codeRes.json();

    // Claim it
    const claimRes = await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        deviceName: "Test Device",
        platform: "linux",
      }),
    });
    expect(claimRes.ok).toBeTruthy();
    const body = await claimRes.json();
    expect(body.deviceToken).toBeTruthy();
  });

  test("5.5 — claim expired/invalid code rejected", async ({}) => {
    const claimRes = await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "ZZZZZZ",
        deviceName: "Test",
        platform: "linux",
      }),
    });
    expect(claimRes.ok).toBeFalsy();
  });

  test("5.6 — claim already-used code rejected", async ({ profileSelect }) => {
    const { token } = await profileSelect();
    const codeRes = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = await codeRes.json();

    // Claim once
    await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, deviceName: "D1", platform: "linux" }),
    });

    // Claim again
    const res2 = await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, deviceName: "D2", platform: "linux" }),
    });
    expect(res2.ok).toBeFalsy();
  });

  test("5.7 — device appears after pairing", async ({ profilePage, profileSelect }) => {
    const { token } = await profileSelect();
    // Pair a device via API
    const codeRes = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = await codeRes.json();
    await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, deviceName: "MyDevice", platform: "macos" }),
    });

    await profilePage.goto("/devices");
    await expect(profilePage.getByText("MyDevice")).toBeVisible();
  });

  test("5.8 — only one active code per profile", async ({ profileSelect }) => {
    const { token } = await profileSelect();
    const res1 = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code: code1 } = await res1.json();

    const res2 = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code: code2 } = await res2.json();

    // First code should now be invalid
    const claim1 = await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code1, deviceName: "D", platform: "linux" }),
    });
    expect(claim1.ok).toBeFalsy();

    // Second code should work
    const claim2 = await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code2, deviceName: "D", platform: "linux" }),
    });
    expect(claim2.ok).toBeTruthy();
  });

  test("5.9 — agent config endpoint returns data", async ({ profileSelect }) => {
    const { token } = await profileSelect();
    // Pair a device
    const codeRes = await fetch(`${API_URL}/devices/pair/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = await codeRes.json();
    const claimRes = await fetch(`${API_URL}/devices/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, deviceName: "ConfigTest", platform: "linux" }),
    });
    const { deviceToken } = await claimRes.json();

    // Get config
    const configRes = await fetch(`${API_URL}/agent/config`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    expect(configRes.ok).toBeTruthy();
    const config = await configRes.json();
    expect(config.rdApiKey).toBeTruthy();
  });

  test("5.10 — agent config requires auth", async ({}) => {
    const res = await fetch(`${API_URL}/agent/config`);
    expect(res.ok).toBeFalsy();
  });
});
