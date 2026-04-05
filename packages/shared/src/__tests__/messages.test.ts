import { describe, it, expect } from "vitest";
import {
  downloadRequestSchema,
  downloadCancelSchema,
  cacheCheckSchema,
  downloadAcceptedSchema,
  downloadProgressSchema,
  downloadCompletedSchema,
  downloadFailedSchema,
  downloadRejectedSchema,
  downloadQueuedSchema,
  cacheResultSchema,
  agentHelloSchema,
  agentHeartbeatSchema,
  deviceStatusSchema,
  errorMessageSchema,
  messageSchema,
} from "../messages.js";

const base = { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", timestamp: 1714000000000 };

describe("command messages", () => {
  it("parses download:request", () => {
    const msg = {
      ...base,
      type: "download:request" as const,
      payload: {
        tmdbId: 27205,
        imdbId: "tt1375666",
        title: "Inception",
        year: 2010,
        mediaType: "movie" as const,
        magnet: "magnet:?xt=urn:btih:abc123",
        torrentName: "Inception.2010.1080p.mkv",
        expectedSize: 2147483648,
      },
    };
    expect(downloadRequestSchema.parse(msg)).toEqual(msg);
  });

  it("rejects download:request missing required fields", () => {
    expect(() =>
      downloadRequestSchema.parse({
        ...base,
        type: "download:request",
        payload: { tmdbId: 123 },
      }),
    ).toThrow();
  });

  it("parses download:request with TV episode fields", () => {
    const msg = {
      ...base,
      type: "download:request" as const,
      payload: {
        tmdbId: 1396,
        imdbId: "tt0903747",
        title: "Breaking Bad",
        year: 2008,
        mediaType: "tv" as const,
        season: 1,
        episode: 1,
        episodeTitle: "Pilot",
        magnet: "magnet:?xt=urn:btih:def456",
        torrentName: "Breaking.Bad.S01E01.mkv",
        expectedSize: 1073741824,
      },
    };
    expect(downloadRequestSchema.parse(msg)).toEqual(msg);
  });

  it("parses download:cancel", () => {
    const msg = {
      ...base,
      type: "download:cancel" as const,
      payload: { jobId: "job-123" },
    };
    expect(downloadCancelSchema.parse(msg)).toEqual(msg);
  });

  it("parses cache:check", () => {
    const msg = {
      ...base,
      type: "cache:check" as const,
      payload: { requestId: "req-1", infoHashes: ["abc", "def"] },
    };
    expect(cacheCheckSchema.parse(msg)).toEqual(msg);
  });
});

describe("event messages", () => {
  it("parses download:accepted", () => {
    const msg = {
      ...base,
      type: "download:accepted" as const,
      payload: { jobId: "j1", requestId: "r1" },
    };
    expect(downloadAcceptedSchema.parse(msg)).toEqual(msg);
  });

  it("parses download:progress", () => {
    const msg = {
      ...base,
      type: "download:progress" as const,
      payload: {
        jobId: "j1",
        phase: "downloading",
        progress: 45.5,
        downloadedBytes: 1000000,
        totalBytes: 2000000,
        speedBps: 500000,
        eta: 2000,
      },
    };
    expect(downloadProgressSchema.parse(msg)).toEqual(msg);
  });

  it("rejects download:progress with out-of-range progress", () => {
    expect(() =>
      downloadProgressSchema.parse({
        ...base,
        type: "download:progress",
        payload: { jobId: "j1", phase: "dl", progress: 150 },
      }),
    ).toThrow();
  });

  it("parses download:completed", () => {
    const msg = {
      ...base,
      type: "download:completed" as const,
      payload: { jobId: "j1", filePath: "/media/movie.mkv", finalSize: 2e9 },
    };
    expect(downloadCompletedSchema.parse(msg)).toEqual(msg);
  });

  it("parses download:failed", () => {
    const msg = {
      ...base,
      type: "download:failed" as const,
      payload: {
        jobId: "j1",
        error: "RD timeout",
        phase: "debrid",
        retryable: true,
      },
    };
    expect(downloadFailedSchema.parse(msg)).toEqual(msg);
  });

  it("parses download:rejected", () => {
    const msg = {
      ...base,
      type: "download:rejected" as const,
      payload: { requestId: "r1", reason: "disk full" },
    };
    expect(downloadRejectedSchema.parse(msg)).toEqual(msg);
  });

  it("parses download:queued", () => {
    const msg = {
      ...base,
      type: "download:queued" as const,
      payload: {
        queueId: "q1",
        requestId: "r1",
        title: "Inception",
        deviceName: "NAS",
      },
    };
    expect(downloadQueuedSchema.parse(msg)).toEqual(msg);
  });

  it("parses cache:result", () => {
    const msg = {
      ...base,
      type: "cache:result" as const,
      payload: { requestId: "r1", cached: { abc: true, def: false } },
    };
    expect(cacheResultSchema.parse(msg)).toEqual(msg);
  });
});

describe("system messages", () => {
  it("parses agent:hello", () => {
    const msg = {
      ...base,
      type: "agent:hello" as const,
      payload: {
        version: "0.1.0",
        platform: "darwin",
        activeJobs: 2,
        diskFreeBytes: 500e9,
      },
    };
    expect(agentHelloSchema.parse(msg)).toEqual(msg);
  });

  it("parses agent:heartbeat", () => {
    const msg = {
      ...base,
      type: "agent:heartbeat" as const,
      payload: { activeJobs: 1, diskFreeBytes: 400e9, uptimeSeconds: 3600 },
    };
    expect(agentHeartbeatSchema.parse(msg)).toEqual(msg);
  });

  it("parses device:status", () => {
    const msg = {
      ...base,
      type: "device:status" as const,
      payload: {
        deviceId: "d1",
        isOnline: true,
        lastSeenAt: 1714000000000,
      },
    };
    expect(deviceStatusSchema.parse(msg)).toEqual(msg);
  });

  it("parses error message", () => {
    const msg = {
      ...base,
      type: "error" as const,
      payload: {
        code: "INTERNAL_ERROR",
        detail: "something went wrong",
        originalMessageId: "msg-1",
      },
    };
    expect(errorMessageSchema.parse(msg)).toEqual(msg);
  });
});

describe("discriminated union", () => {
  it("routes to correct schema by type", () => {
    const msg = {
      ...base,
      type: "download:cancel" as const,
      payload: { jobId: "j1" },
    };
    const parsed = messageSchema.parse(msg);
    expect(parsed.type).toBe("download:cancel");
  });

  it("rejects unknown message type", () => {
    expect(() =>
      messageSchema.parse({ ...base, type: "unknown:type", payload: {} }),
    ).toThrow();
  });
});
