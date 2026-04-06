import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  createWriteStream,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config.js";

function getPidPath(): string {
  return join(dirname(config.path), "tadaima.pid");
}

function getLogDir(): string {
  return join(dirname(config.path), "logs");
}

export function getLogPath(): string {
  return join(getLogDir(), "tadaima.log");
}

export function startDaemon(): void {
  const pidPath = getPidPath();

  if (existsSync(pidPath)) {
    const oldPid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    if (Number.isNaN(oldPid)) {
      console.log("Stale PID file (invalid contents). Removing.");
      unlinkSync(pidPath);
    } else {
      try {
        process.kill(oldPid, 0);
        console.log(`Agent already running (PID ${oldPid})`);
        return;
      } catch {
        unlinkSync(pidPath);
      }
    }
  }

  const logDir = getLogDir();
  mkdirSync(logDir, { recursive: true });

  const logPath = getLogPath();
  const logStream = createWriteStream(logPath, { flags: "a" });

  const child = spawn(process.execPath, [process.argv[1], "start"], {
    detached: true,
    stdio: ["ignore", logStream, logStream],
    env: { ...process.env, TADAIMA_DAEMON: "1" },
  });

  child.unref();

  if (child.pid) {
    writeFileSync(pidPath, String(child.pid));
    console.log(`Agent started in background (PID ${child.pid})`);
    console.log(`Logs: ${logPath}`);
  }
}

export function stopDaemon(): void {
  const pidPath = getPidPath();

  if (!existsSync(pidPath)) {
    console.log("Agent is not running.");
    return;
  }

  const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
  if (Number.isNaN(pid)) {
    console.log("Stale PID file (invalid contents). Removing.");
    unlinkSync(pidPath);
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to PID ${pid}`);
    unlinkSync(pidPath);
  } catch {
    console.log(`Process ${pid} not found. Cleaning up PID file.`);
    unlinkSync(pidPath);
  }
}

export function getDaemonStatus(): { running: boolean; pid?: number } {
  const pidPath = getPidPath();

  if (!existsSync(pidPath)) {
    return { running: false };
  }

  const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
  if (Number.isNaN(pid)) {
    console.log("Stale PID file (invalid contents). Removing.");
    unlinkSync(pidPath);
    return { running: false };
  }

  try {
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    unlinkSync(pidPath);
    return { running: false };
  }
}
