import { describe, it, expect } from "vitest";
import {
  createMessageId,
  createTimestamp,
  sanitizeFilename,
  buildMoviePath,
  buildEpisodePath,
} from "../utils.js";

describe("createMessageId", () => {
  it("returns a 26-character ULID", () => {
    const id = createMessageId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createMessageId()));
    expect(ids.size).toBe(100);
  });
});

describe("createTimestamp", () => {
  it("returns a number close to Date.now()", () => {
    const ts = createTimestamp();
    expect(typeof ts).toBe("number");
    expect(Math.abs(ts - Date.now())).toBeLessThan(100);
  });
});

describe("sanitizeFilename", () => {
  it("removes illegal characters", () => {
    expect(sanitizeFilename('File<>"/\\|?*.txt')).toBe("File.txt");
  });

  it("replaces colon with dash", () => {
    expect(sanitizeFilename("Title: Subtitle")).toBe("Title - Subtitle");
  });

  it("collapses multiple spaces", () => {
    expect(sanitizeFilename("Too   Many   Spaces")).toBe("Too Many Spaces");
  });

  it("strips leading/trailing dots, spaces, dashes", () => {
    expect(sanitizeFilename("...  --Title-- ...")).toBe("Title");
  });

  it("handles empty string edge case", () => {
    expect(sanitizeFilename("...")).toBe("");
  });
});

describe("buildMoviePath", () => {
  it("builds Plex-compatible movie path", () => {
    expect(buildMoviePath("Inception", 2010, 27205, "mkv")).toBe(
      "Movies/Inception (2010) {tmdb-27205}/Inception (2010).mkv",
    );
  });

  it("sanitizes title with special characters", () => {
    expect(buildMoviePath("Spider-Man: No Way Home", 2021, 634649, "mkv")).toBe(
      "Movies/Spider-Man - No Way Home (2021) {tmdb-634649}/Spider-Man - No Way Home (2021).mkv",
    );
  });
});

describe("buildEpisodePath", () => {
  it("builds Plex-compatible episode path", () => {
    expect(buildEpisodePath("Breaking Bad", 1396, 1, 1, "Pilot", "mkv")).toBe(
      "TV/Breaking Bad {tmdb-1396}/Season 01/Breaking Bad - S01E01 - Pilot.mkv",
    );
  });

  it("zero-pads season and episode numbers", () => {
    expect(
      buildEpisodePath("The Office", 2316, 3, 14, "The Return", "mkv"),
    ).toBe(
      "TV/The Office {tmdb-2316}/Season 03/The Office - S03E14 - The Return.mkv",
    );
  });
});
