import { freemem } from "node:os";
import { config } from "./config.js";

interface CompletedEntry {
  title: string;
  size: number;
  completedAt: number;
}

export class TUI {
  private connected = false;
  private profileName = "";
  private version = "0.0.0";
  private interval: ReturnType<typeof setInterval> | null = null;
  private recentCompleted: CompletedEntry[] = [];

  constructor(version: string) {
    this.version = version;
    this.profileName = config.get("profileName") || "Unknown";
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

    if (this.recentCompleted.length === 0) {
      lines.push(` Waiting for downloads...`);
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
      ` ${diskFree} free`,
    );
    lines.push("");

    // Clear screen and write
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(lines.join("\n"));
  }

}

function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
