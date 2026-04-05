import { freemem } from "node:os";
import { config } from "./config.js";
import type { DownloadHandler } from "./download-handler.js";

interface CompletedEntry {
  title: string;
  size: number;
  completedAt: number;
}

const BAR_WIDTH = 30;

export class TUI {
  private handler: DownloadHandler | null = null;
  private connected = false;
  private profileName = "";
  private version = "0.0.0";
  private interval: ReturnType<typeof setInterval> | null = null;
  private recentCompleted: CompletedEntry[] = [];

  constructor(version: string) {
    this.version = version;
    this.profileName = config.get("profileName") || "Unknown";
  }

  setHandler(handler: DownloadHandler): void {
    this.handler = handler;
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  addCompleted(title: string, size: number): void {
    this.recentCompleted.unshift({ title, size, completedAt: Date.now() });
    if (this.recentCompleted.length > 5) this.recentCompleted.pop();
  }

  start(): void {
    // Hide cursor
    process.stdout.write("\x1b[?25l");
    this.render();
    this.interval = setInterval(() => this.render(), 1000);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    // Show cursor
    process.stdout.write("\x1b[?25l");
    process.stdout.write("\x1b[?25h");
  }

  private render(): void {
    const lines: string[] = [];
    const status = this.connected ? "Connected" : "Disconnected";

    lines.push("");
    lines.push(
      ` tadaima v${this.version} — ${status} to relay (${this.profileName})`,
    );
    lines.push(` ${"─".repeat(50)}`);

    // Active downloads
    const jobs = this.handler ? this.getActiveJobs() : [];
    if (jobs.length === 0 && this.recentCompleted.length === 0) {
      lines.push(` Waiting for downloads...`);
    }

    for (const job of jobs) {
      const sizeStr = job.totalBytes
        ? formatSize(job.totalBytes)
        : "";
      lines.push(` ↓ ${job.title.padEnd(35)} ${sizeStr.padStart(10)}`);

      const filled = Math.round((job.progress / 100) * BAR_WIDTH);
      const empty = BAR_WIDTH - filled;
      const bar = "█".repeat(filled) + "░".repeat(empty);
      const pct = `${Math.round(job.progress)}%`.padStart(4);
      const speed = job.speedBps ? formatSpeed(job.speedBps) : "";
      const eta = job.eta ? `ETA ${formatEta(job.eta)}` : "";

      lines.push(`   ${bar}  ${pct}  ${speed.padStart(10)}  ${eta}`);
      lines.push("");
    }

    // Recently completed
    for (const entry of this.recentCompleted) {
      const ago = formatTimeAgo(entry.completedAt);
      lines.push(
        ` ✓ ${entry.title.padEnd(35)} ${formatSize(entry.size).padStart(10)}  ただいま — completed ${ago}`,
      );
    }

    lines.push(` ${"─".repeat(50)}`);
    const diskFree = formatSize(freemem());
    lines.push(
      ` ${jobs.length} active · ${diskFree} free`,
    );
    lines.push("");

    // Clear screen and write
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(lines.join("\n"));
  }

  private getActiveJobs(): Array<{
    title: string;
    progress: number;
    totalBytes?: number;
    speedBps?: number;
    eta?: number;
  }> {
    // Access internal state via the handler's public interface
    // For now return empty — handler needs to expose active jobs
    return [];
  }
}

function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function formatSpeed(bps: number): string {
  const mbps = bps / (1024 * 1024);
  return `${mbps.toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
