import { createHash } from "node:crypto";
import { createWriteStream, readFileSync, copyFileSync, chmodSync, renameSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { dirname, join, extname } from "node:path";
import { config } from "./config.js";
import {
  GITHUB_RELEASES_API,
  getAssetNameForPlatform,
} from "@tadaima/shared";

export interface UpdateResult {
  version: string;
  downloadUrl: string;
  checksumUrl: string;
}

let cachedETag = "";

/**
 * Try the relay's /api/version endpoint first for a quick version check.
 * Falls back to the full GitHub API if the relay is unreachable.
 */
async function checkViaRelay(currentVersion: string): Promise<string | null> {
  const relayUrl = config.get("relay");
  if (!relayUrl) return null;

  try {
    const res = await fetch(`${relayUrl}/api/version`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { latest: string | null };
    if (data.latest && isNewer(data.latest, currentVersion)) {
      return data.latest;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check the GitHub Releases API for a newer version.
 * Returns null if already up-to-date or unsupported platform.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateResult | null> {
  const assetName = getAssetNameForPlatform();
  if (!assetName) return null;

  // Quick check via relay first
  const relayLatest = await checkViaRelay(currentVersion);
  // If relay says we're up-to-date, skip the full GitHub API call
  if (relayLatest === null) {
    // Relay either unreachable or says up-to-date; still try GitHub for authoritative answer
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": `tadaima-agent/${currentVersion}`,
  };
  if (cachedETag) {
    headers["If-None-Match"] = cachedETag;
  }

  const res = await fetch(GITHUB_RELEASES_API, { headers });

  if (res.status === 304) return null; // not modified
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  }

  const etag = res.headers.get("etag");
  if (etag) cachedETag = etag;

  const data = (await res.json()) as {
    tag_name: string;
    assets: { name: string; browser_download_url: string }[];
  };

  const latestVersion = data.tag_name.replace(/^v/, "");
  if (!isNewer(latestVersion, currentVersion)) return null;

  const binaryAsset = data.assets.find((a) => a.name === assetName);
  const checksumAsset = data.assets.find((a) => a.name === "checksums.sha256");

  if (!binaryAsset || !checksumAsset) return null;

  config.set("lastUpdateCheck", new Date().toISOString());

  return {
    version: latestVersion,
    downloadUrl: binaryAsset.browser_download_url,
    checksumUrl: checksumAsset.browser_download_url,
  };
}

/**
 * Download, verify, and replace the current binary with the update.
 */
export async function applyUpdate(update: UpdateResult): Promise<void> {
  const configDir = dirname(config.path);
  const ext = extname(process.execPath);
  const tmpPath = join(configDir, `tadaima-agent-update-${update.version}${ext}`);
  const backupPath = join(configDir, `tadaima-agent-previous${ext}`);

  // Download binary
  const binRes = await fetch(update.downloadUrl);
  if (!binRes.ok || !binRes.body) {
    throw new Error(`Failed to download binary: ${binRes.status}`);
  }
  const ws = createWriteStream(tmpPath);
  await pipeline(Readable.fromWeb(binRes.body as import("stream/web").ReadableStream), ws);

  // Download and verify checksum
  const csRes = await fetch(update.checksumUrl);
  if (!csRes.ok) {
    throw new Error(`Failed to download checksums: ${csRes.status}`);
  }
  const checksumText = await csRes.text();
  const assetName = getAssetNameForPlatform()!;
  const expectedLine = checksumText.split("\n").find((l) => l.includes(assetName));
  if (!expectedLine) {
    throw new Error(`No checksum found for ${assetName}`);
  }
  const expectedHash = expectedLine.trim().split(/\s+/)[0].toLowerCase();

  const actualHash = createHash("sha256")
    .update(readFileSync(tmpPath))
    .digest("hex");

  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch: expected ${expectedHash}, got ${actualHash}`,
    );
  }

  // Make executable
  if (process.platform !== "win32") {
    chmodSync(tmpPath, 0o755);
  }

  // Backup current binary
  try {
    copyFileSync(process.execPath, backupPath);
    config.set("previousBinaryPath", backupPath);
  } catch {
    // Backup may fail if execPath is read-only (npm global); non-fatal
  }

  // Atomic rename
  renameSync(tmpPath, process.execPath);

  // If running as a service, exit so the service manager restarts with the new binary
  if (process.env.TADAIMA_DAEMON || isRunningAsService()) {
    console.log(`Updated to v${update.version}. Exiting for service restart.`);
    process.exit(0);
  } else {
    console.log(
      `Update to v${update.version} downloaded. Restart to apply.`,
    );
  }
}

/**
 * Check if enough time has passed since the last update check.
 */
export function shouldCheckNow(trigger: "startup" | "periodic"): boolean {
  const last = config.get("lastUpdateCheck");
  if (!last) return true;

  const elapsed = Date.now() - new Date(last).getTime();
  const ONE_HOUR = 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;

  if (trigger === "startup") return elapsed > ONE_HOUR;
  return elapsed > TWENTY_FOUR_HOURS;
}

/**
 * Restore the previous binary from backup.
 */
export function rollback(): void {
  const prev = config.get("previousBinaryPath");
  if (!prev) {
    console.log("No previous binary to roll back to.");
    return;
  }

  try {
    copyFileSync(prev, process.execPath);
    console.log(`Rolled back to previous binary from ${prev}.`);
    console.log("Restart the agent to use the restored version.");
  } catch (err) {
    console.error(
      "Rollback failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Log an update advisory for npm/Docker users who can't self-update.
 */
export function logUpdateAdvisory(currentVersion: string, latestVersion: string): void {
  console.log(`\nTadaima v${latestVersion} is available (you have v${currentVersion}).`);
  console.log("  npm:    npm install -g @psychout98/tadaima@latest");
  console.log("  Docker: docker compose pull && docker compose up -d\n");
}

// ── Helpers ──────────────────────────────────────────────────────

function isNewer(latest: string, current: string): boolean {
  const [lMaj, lMin, lPatch] = latest.split(".").map(Number);
  const [cMaj, cMin, cPatch] = current.split(".").map(Number);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPatch > cPatch;
}

function isRunningAsService(): boolean {
  // launchd/systemd/Windows Service detection heuristics
  return (
    !!process.env.INVOCATION_ID || // systemd
    process.ppid === 1 || // launchd (parent is launchd PID 1)
    !!process.env.TADAIMA_SERVICE // explicit flag
  );
}
