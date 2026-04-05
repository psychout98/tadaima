import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config
vi.mock("../config.js", () => ({
  config: {
    get: vi.fn((key: string) => {
      if (key === "realDebrid.apiKey") return "test-rd-key";
      if (key === "rdPollInterval") return 1;
      return "";
    }),
  },
}));

import { rdClient } from "../rd-client.js";

describe("rdClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("addMagnet", () => {
    it("sends magnet to RD and returns torrent ID", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "torrent-123", uri: "magnet:..." }),
      });

      const result = await rdClient.addMagnet("magnet:?xt=urn:btih:abc");

      expect(result.id).toBe("torrent-123");
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/torrents/addMagnet"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("throws on HTTP error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });

      await expect(
        rdClient.addMagnet("magnet:bad"),
      ).rejects.toThrow("RD API error 403");
    });
  });

  describe("checkCache", () => {
    it("returns boolean map for each hash", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            abc123: { rd: [{ 1: { filename: "test.mkv" } }] },
            def456: {},
          }),
      });

      const result = await rdClient.checkCache(["abc123", "def456"]);

      expect(result.abc123).toBe(true);
      expect(result.def456).toBe(false);
    });

    it("returns empty map for empty input", async () => {
      const result = await rdClient.checkCache([]);
      expect(result).toEqual({});
    });
  });

  describe("unrestrictLink", () => {
    it("returns download URL and metadata", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            download: "https://download.rd/file.mkv",
            filename: "file.mkv",
            filesize: 1073741824,
          }),
      });

      const result = await rdClient.unrestrictLink("https://rd/link/1");

      expect(result.url).toBe("https://download.rd/file.mkv");
      expect(result.filename).toBe("file.mkv");
      expect(result.filesize).toBe(1073741824);
    });
  });

  describe("pollUntilReady", () => {
    it("returns links when status is downloaded", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "t1",
            status: "downloaded",
            progress: 100,
            links: ["https://rd/link/1"],
            filename: "test.mkv",
          }),
      });

      const links = await rdClient.pollUntilReady("t1", 100, 5000);
      expect(links).toEqual(["https://rd/link/1"]);
    });

    it("throws on error status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "t1",
            status: "error",
            progress: 0,
            links: [],
            filename: "test.mkv",
          }),
      });

      await expect(
        rdClient.pollUntilReady("t1", 100, 5000),
      ).rejects.toThrow("RD torrent error: error");
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "t1",
            status: "queued",
            progress: 0,
            links: [],
            filename: "test.mkv",
          }),
      });

      await expect(
        rdClient.pollUntilReady("t1", 100, 5000, undefined, controller.signal),
      ).rejects.toThrow("Cancelled");
    });
  });
});
