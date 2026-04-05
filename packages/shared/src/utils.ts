import { ulid } from "ulid";

/**
 * Generate a ULID message ID.
 */
export function createMessageId(): string {
  return ulid();
}

/**
 * Return current time as unix milliseconds.
 */
export function createTimestamp(): number {
  return Date.now();
}

/**
 * Remove illegal filename characters, collapse spaces, strip edge junk.
 */
export function sanitizeFilename(name: string): string {
  return (
    name
      // Remove illegal chars
      .replace(/[<>"/\\|?*]/g, "")
      // Replace colon with dash
      .replace(/:/g, " - ")
      // Collapse multiple spaces
      .replace(/\s+/g, " ")
      // Strip leading/trailing dots, spaces, dashes
      .replace(/^[\s.-]+|[\s.-]+$/g, "")
  );
}

/**
 * Build Plex-compatible movie path.
 * Example: "Movies/Inception (2010) {tmdb-27205}/Inception (2010).mkv"
 */
export function buildMoviePath(
  title: string,
  year: number,
  tmdbId: number,
  ext: string,
): string {
  const safe = sanitizeFilename(title);
  const folder = `${safe} (${year}) {tmdb-${tmdbId}}`;
  const file = `${safe} (${year}).${ext}`;
  return `Movies/${folder}/${file}`;
}

/**
 * Build Plex-compatible episode path.
 * Example: "TV/Breaking Bad {tmdb-1396}/Season 01/Breaking Bad - S01E01 - Pilot.mkv"
 */
export function buildEpisodePath(
  title: string,
  tmdbId: number,
  season: number,
  episode: number,
  episodeTitle: string,
  ext: string,
): string {
  const safeTitle = sanitizeFilename(title);
  const safeEpTitle = sanitizeFilename(episodeTitle);
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");
  const showFolder = `${safeTitle} {tmdb-${tmdbId}}`;
  const seasonFolder = `Season ${s}`;
  const file = `${safeTitle} - S${s}E${e} - ${safeEpTitle}.${ext}`;
  return `TV/${showFolder}/${seasonFolder}/${file}`;
}
