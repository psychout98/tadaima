import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// A per-test-file scratch directory. status-file.ts derives the status path
// from `config.path`, so we mock config.path to point inside this dir.
// vi.hoisted runs before the hoisted vi.mock factory, which is the only way
// to share values between the test body and the mock.
const { scratchRoot, fakeConfigPath } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tadaima-status-test-"));
  return { scratchRoot: root, fakeConfigPath: path.join(root, "config.json") };
});

vi.mock("../config.js", () => ({
  config: {
    // The real `conf` library exposes `path` as a getter that returns the
    // platform-specific config.json path. A plain string is enough here.
    path: fakeConfigPath,
  },
}));

// Re-export node:fs/promises through a mock wrapper so individual tests can
// override `rename` / `writeFile`. Without this, ESM namespace objects are
// frozen and vi.spyOn throws "Cannot redefine property".
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual };
});

import {
  writeStatusFile,
  getStatusFilePath,
  removeStatusFile,
  STATUS_HEARTBEAT_INTERVAL_MS,
  type AgentStatus,
} from "../status-file.js";

const sampleStatus = (): AgentStatus => ({
  version: "1.2.3",
  pid: 4242,
  connected: true,
  relayUrl: "https://relay.example.com",
  deviceId: "device-abc",
  deviceName: "Test Device",
  activeDownloads: 2,
  lastHeartbeat: "2026-04-09T00:00:00.000Z",
});

describe("status-file", () => {
  beforeEach(() => {
    // Ensure the scratch dir is clean before each test.
    try {
      rmSync(scratchRoot, { recursive: true, force: true });
    } catch {
      // ignore — may not exist
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getStatusFilePath", () => {
    it("returns status.json alongside the config file", () => {
      expect(getStatusFilePath()).toBe(join(scratchRoot, "status.json"));
    });
  });

  describe("STATUS_HEARTBEAT_INTERVAL_MS", () => {
    it("is a positive finite number", () => {
      expect(Number.isFinite(STATUS_HEARTBEAT_INTERVAL_MS)).toBe(true);
      expect(STATUS_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
    });
  });

  describe("writeStatusFile", () => {
    it("creates status.json (and its parent directory) if missing", async () => {
      const status = sampleStatus();
      await writeStatusFile(status);

      const path = getStatusFilePath();
      expect(existsSync(path)).toBe(true);
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      expect(parsed).toEqual(status);
    });

    it("overwrites an existing status file atomically via rename", async () => {
      const fsp = await import("node:fs/promises");
      const renameSpy = vi.spyOn(fsp, "rename");

      const first = sampleStatus();
      await writeStatusFile(first);
      const updated: AgentStatus = { ...first, activeDownloads: 5, connected: false };
      await writeStatusFile(updated);

      // Both writes should have gone through a tmp-then-rename cycle.
      expect(renameSpy).toHaveBeenCalledTimes(2);
      for (const call of renameSpy.mock.calls) {
        expect(String(call[0])).toBe(getStatusFilePath() + ".tmp");
        expect(String(call[1])).toBe(getStatusFilePath());
      }

      const parsed = JSON.parse(readFileSync(getStatusFilePath(), "utf8"));
      expect(parsed).toEqual(updated);
    });

    it("propagates write errors (so the caller can log them)", async () => {
      const fsp = await import("node:fs/promises");
      vi.spyOn(fsp, "writeFile").mockRejectedValueOnce(
        new Error("disk full"),
      );

      await expect(writeStatusFile(sampleStatus())).rejects.toThrow("disk full");
    });
  });

  describe("removeStatusFile", () => {
    it("removes an existing status file", async () => {
      await writeStatusFile(sampleStatus());
      expect(existsSync(getStatusFilePath())).toBe(true);

      removeStatusFile();
      expect(existsSync(getStatusFilePath())).toBe(false);
    });

    it("is a no-op if the file does not exist", () => {
      expect(existsSync(getStatusFilePath())).toBe(false);
      expect(() => removeStatusFile()).not.toThrow();
    });
  });
});

describe("heartbeat integration (resilience)", () => {
  it("a rejected writeStatusFile is swallowed by the safe wrapper", async () => {
    // Reproduce the heartbeat-loop pattern from index.ts: writeStatusSafe
    // wraps the promise in a .catch, so a rejection must never throw out.
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    const writeStatusSafe = (): void => {
      failing().catch(() => {
        /* swallowed */
      });
    };

    // Running it twice in a row must not throw and must not leave an
    // unhandled rejection around.
    expect(() => writeStatusSafe()).not.toThrow();
    expect(() => writeStatusSafe()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
