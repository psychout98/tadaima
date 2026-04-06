import prompts from "prompts";
import { hostname, platform } from "node:os";
import { config } from "./config.js";

function detectDeviceName(): string {
  return hostname().toLowerCase().replace(/\.local$/, "");
}

function detectPlatform(): string {
  const p = platform();
  switch (p) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return p;
  }
}

export async function runSetup() {
  console.log("\n  Tadaima Agent Setup\n");

  const { relayUrl } = await prompts({
    type: "text",
    name: "relayUrl",
    message: "Relay URL",
    initial: config.get("relay") || "http://localhost:3000",
    validate: (v: string) => (v.startsWith("http") ? true : "Must start with http:// or https://"),
  });

  if (!relayUrl) {
    console.log("Setup cancelled.");
    process.exit(0);
  }

  const { code } = await prompts({
    type: "text",
    name: "code",
    message: "Pairing code (from web app)",
    validate: (v: string) => (v.length === 6 ? true : "Code must be 6 characters"),
  });

  if (!code) {
    console.log("Setup cancelled.");
    process.exit(0);
  }

  const deviceName = detectDeviceName();
  const devicePlatform = detectPlatform();

  console.log(`\n  Pairing as "${deviceName}" (${devicePlatform})...`);

  // Claim the pairing code
  const res = await fetch(`${relayUrl}/api/devices/pair/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: code.toUpperCase(),
      name: deviceName,
      platform: devicePlatform,
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ detail: res.statusText }))) as Record<string, string>;
    console.error(`\n  Pairing failed: ${err.detail || err.error}`);
    process.exit(1);
  }

  const { deviceId, deviceToken, rdApiKey, wsUrl } = (await res.json()) as {
    deviceId: string;
    deviceToken: string;
    rdApiKey: string;
    wsUrl: string;
  };

  // Prompt for media directories
  const { moviesDir } = await prompts({
    type: "text",
    name: "moviesDir",
    message: "Movies directory",
    initial: config.get("directories.movies") || "/mnt/media/Movies",
    validate: (v: string) =>
      v.trim().length > 0 && v.startsWith("/") ? true : "Must be a non-empty absolute path",
  });

  const { tvDir } = await prompts({
    type: "text",
    name: "tvDir",
    message: "TV Shows directory",
    initial: config.get("directories.tv") || "/mnt/media/TV",
    validate: (v: string) =>
      v.trim().length > 0 && v.startsWith("/") ? true : "Must be a non-empty absolute path",
  });

  if (!moviesDir || !tvDir) {
    console.log("Setup cancelled.");
    process.exit(0);
  }

  // Save config
  config.set("relay", relayUrl);
  config.set("deviceToken", deviceToken);
  config.set("deviceId", deviceId);
  config.set("deviceName", deviceName);
  config.set("directories.movies", moviesDir || "/mnt/media/Movies");
  config.set("directories.tv", tvDir || "/mnt/media/TV");
  config.set("directories.staging", "/tmp/tadaima/staging");
  config.set("realDebrid.apiKey", rdApiKey);

  console.log(`\n  Connected! This device is now paired as "${deviceName}".`);
  console.log(`  Config saved to: ${config.path}`);
  console.log(`  WebSocket URL: ${wsUrl}\n`);
}
