import { mkdirSync, unlinkSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "./config.js";

/**
 * How often the agent refreshes status.json. The tray / menu-bar apps read
 * this constant (via a tray-config.json the installer copies at build time)
 * to decide when the status file should be considered stale — their default
 * staleness threshold is 3× this interval.
 */
export const STATUS_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * The shape of the agent's status file. This interface is the contract
 * between the agent and the desktop tray / menu-bar apps. Changing it is
 * a breaking change for those apps.
 */
export interface AgentStatus {
  version: string;
  pid: number;
  connected: boolean;
  relay: string;
  deviceId: string;
  deviceName: string;
  activeDownloads: number;
  lastHeartbeat: string;
  updateAvailable: string | null;
}

/**
 * Returns the absolute path to status.json. It lives in the same directory
 * as config.json — whichever path the agent's config helper resolves to on
 * this platform — so tray apps can locate it by walking up from the config.
 */
export function getStatusFilePath(): string {
  return join(dirname(config.path), "status.json");
}

/**
 * Atomically write the agent status file. Writes to `status.json.tmp`
 * first, then renames over the real path so readers never see a partial
 * write. Errors are swallowed by the caller (the heartbeat loop) because
 * a failed status write must never crash the agent.
 */
export async function writeStatusFile(status: AgentStatus): Promise<void> {
  const statusPath = getStatusFilePath();
  const tmpPath = statusPath + ".tmp";

  mkdirSync(dirname(statusPath), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(status, null, 2));
  await rename(tmpPath, statusPath);
}

/**
 * Remove status.json on clean shutdown so tray apps can tell the
 * difference between "agent is stopped" and "agent crashed or hung".
 * Errors are intentionally ignored — the file may not exist.
 */
export function removeStatusFile(): void {
  try {
    unlinkSync(getStatusFilePath());
  } catch {
    // File may not exist — that's fine.
  }
}
