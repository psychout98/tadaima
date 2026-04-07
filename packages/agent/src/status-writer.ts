import { writeFileSync, unlinkSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.js";

export interface AgentStatus {
  pid: number;
  version: string;
  connected: boolean;
  relay: string;
  deviceName: string;
  activeDownloads: number;
  lastHeartbeat: string;
  updateAvailable: string | null;
}

function getStatusPath(): string {
  return join(dirname(config.path), "status.json");
}

/**
 * Atomically write the agent status file.
 * The menu bar / tray app reads this file to display status.
 */
export function writeStatus(status: AgentStatus): void {
  const statusPath = getStatusPath();
  const tmpPath = statusPath + ".tmp";

  try {
    mkdirSync(dirname(statusPath), { recursive: true });
    writeFileSync(tmpPath, JSON.stringify(status, null, 2));
    renameSync(tmpPath, statusPath);
  } catch {
    // Non-fatal — status file is for the tray app, not critical
  }
}

/**
 * Remove the status file on shutdown so tray apps know the agent is stopped.
 */
export function removeStatus(): void {
  try {
    unlinkSync(getStatusPath());
  } catch {
    // File may not exist
  }
}
