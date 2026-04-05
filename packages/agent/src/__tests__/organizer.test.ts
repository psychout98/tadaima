import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

// Mock fs and config before importing
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../config.js", () => ({
  config: {
    get: vi.fn((key: string) => {
      if (key === "directories.movies") return "/media/Movies";
      if (key === "directories.tv") return "/media/TV";
      return "";
    }),
  },
}));

import { organizeFile } from "../organizer.js";
import { mkdir, rename } from "node:fs/promises";

describe("organizeFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("organizes a movie to Plex-compatible path", async () => {
    const result = await organizeFile({
      title: "Inception",
      year: 2010,
      tmdbId: 27205,
      mediaType: "movie",
      sourcePath: "/tmp/staging/job1/inception.mkv",
    });

    expect(mkdir).toHaveBeenCalled();
    expect(rename).toHaveBeenCalledWith(
      "/tmp/staging/job1/inception.mkv",
      expect.stringContaining("Inception (2010)"),
    );
    expect(result).toContain("Inception (2010)");
    expect(result).toContain(".mkv");
  });

  it("organizes a TV episode to Plex-compatible path", async () => {
    const result = await organizeFile({
      title: "Breaking Bad",
      year: 2008,
      tmdbId: 1396,
      mediaType: "tv",
      season: 1,
      episode: 1,
      episodeTitle: "Pilot",
      sourcePath: "/tmp/staging/job2/bb.s01e01.mkv",
    });

    expect(rename).toHaveBeenCalled();
    expect(result).toContain("Breaking Bad");
    expect(result).toContain("Season 01");
    expect(result).toContain("S01E01");
    expect(result).toContain("Pilot");
  });

  it("handles missing episode title gracefully", async () => {
    const result = await organizeFile({
      title: "The Office",
      year: 2005,
      tmdbId: 2316,
      mediaType: "tv",
      season: 3,
      episode: 14,
      sourcePath: "/tmp/staging/job3/office.mkv",
    });

    expect(result).toContain("S03E14");
    expect(result).toContain("Episode 14");
  });

  it("sanitizes titles with special characters", async () => {
    const result = await organizeFile({
      title: "Spider-Man: No Way Home",
      year: 2021,
      tmdbId: 634649,
      mediaType: "movie",
      sourcePath: "/tmp/staging/job4/spider-man.mkv",
    });

    // Colon should be replaced with dash
    expect(result).not.toContain(":");
    expect(result).toContain("Spider-Man");
  });
});
