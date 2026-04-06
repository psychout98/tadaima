import { Hono } from "hono";
import { db } from "../db.js";
import { instanceSettings } from "@tadaima/shared";
import { decrypt } from "../crypto.js";
import { eq } from "drizzle-orm";
import {
  searchCache,
  mediaCache,
  streamCache,
  posterCache,
  SEARCH_TTL,
  MEDIA_TTL,
  STREAM_TTL,
  POSTER_TTL,
} from "../cache.js";

async function getTmdbKey(): Promise<string> {
  const [row] = await db
    .select()
    .from(instanceSettings)
    .where(eq(instanceSettings.key, "tmdb_api_key"))
    .limit(1);
  if (!row) throw new Error("TMDB API key not configured");
  return decrypt(row.value);
}

/**
 * Strip API keys from a string to prevent leaking secrets in logs or error
 * responses.  Matches the `api_key=<value>` query-parameter pattern used by
 * TMDB v3 as well as generic "key=<hex>" patterns.
 */
function redactApiKeys(text: string): string {
  return text.replace(/api_key=[^&\s]+/gi, "api_key=REDACTED");
}

const proxy = new Hono();

// ── Search ─────────────────────────────────────────────────────

proxy.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "VALIDATION_ERROR", detail: "q is required" }, 400);

  const cacheKey = `search:${q.toLowerCase().trim()}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return c.json(cached);

  try {
    const tmdbKey = await getTmdbKey();
    // NOTE: TMDB v3 API requires api_key as a query parameter; there is no
    // header-based auth option.  The key is only sent server-side (never to the
    // client) and we redact it from any error messages below.  (SEC-04)
    const res = await fetch(
      `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(q)}&include_adult=false`,
    );
    if (!res.ok) return c.json({ error: "UPSTREAM_ERROR", detail: "TMDB search failed" }, 502);

    const data = await res.json() as { results: Array<Record<string, unknown>> };
    const results = data.results
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .slice(0, 20)
      .map((r) => ({
        tmdbId: r.id,
        imdbId: null, // filled from detail endpoint
        title: r.title ?? r.name ?? "",
        year: extractYear(r.release_date as string ?? r.first_air_date as string),
        mediaType: r.media_type,
        posterPath: r.poster_path ?? null,
        overview: r.overview ?? null,
      }));

    searchCache.set(cacheKey, results, SEARCH_TTL);
    return c.json(results);
  } catch (err) {
    console.error("TMDB search error:", redactApiKeys(String(err)));
    return c.json({ error: "UPSTREAM_ERROR", detail: "Failed to connect to TMDB" }, 502);
  }
});

// ── Media Detail ───────────────────────────────────────────────

proxy.get("/media/:type/:tmdbId", async (c) => {
  const type = c.req.param("type");
  const tmdbId = c.req.param("tmdbId");

  if (type !== "movie" && type !== "tv") {
    return c.json({ error: "VALIDATION_ERROR", detail: "type must be movie or tv" }, 400);
  }

  const cacheKey = `media:${type}:${tmdbId}`;
  const cached = mediaCache.get(cacheKey);
  if (cached) return c.json(cached);

  try {
    const tmdbKey = await getTmdbKey();
    // TMDB v3: api_key query param is the only auth method (see SEC-04 note above)
    const append = type === "tv" ? "&append_to_response=external_ids" : "&append_to_response=external_ids";
    const res = await fetch(
      `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${tmdbKey}${append}`,
    );
    if (!res.ok) return c.json({ error: "UPSTREAM_ERROR", detail: "TMDB detail failed" }, 502);

    const raw = await res.json() as Record<string, unknown>;

    const detail: Record<string, unknown> = {
      tmdbId: raw.id,
      imdbId: (raw.external_ids as Record<string, unknown>)?.imdb_id ?? raw.imdb_id ?? null,
      title: raw.title ?? raw.name ?? "",
      year: extractYear(raw.release_date as string ?? raw.first_air_date as string),
      mediaType: type,
      posterPath: raw.poster_path ?? null,
      overview: raw.overview ?? null,
      runtime: raw.runtime ?? null,
      status: raw.status ?? null,
    };

    if (type === "tv" && Array.isArray(raw.seasons)) {
      detail.seasons = (raw.seasons as Array<Record<string, unknown>>).map((s) => ({
        seasonNumber: s.season_number,
        name: s.name,
        episodeCount: s.episode_count,
        airDate: s.air_date,
      }));
    }

    mediaCache.set(cacheKey, detail, MEDIA_TTL);
    return c.json(detail);
  } catch (err) {
    console.error("TMDB detail error:", redactApiKeys(String(err)));
    return c.json({ error: "UPSTREAM_ERROR", detail: "Failed to connect to TMDB" }, 502);
  }
});

// ── Streams (Torrentio) ────────────────────────────────────────

proxy.get("/streams/:type/:imdbId", async (c) => {
  const type = c.req.param("type");
  const imdbId = c.req.param("imdbId");
  const season = c.req.query("season");
  const episode = c.req.query("episode");

  const torrentioType = type === "movie" ? "movie" : "series";
  let torrentioId = imdbId;

  if (type === "tv" && season && episode) {
    torrentioId = `${imdbId}:${season}:${episode}`;
  }

  const cacheKey = `streams:${torrentioType}:${torrentioId}`;
  const cached = streamCache.get(cacheKey);
  if (cached) return c.json(cached);

  try {
    const url = `https://torrentio.strem.fun/stream/${torrentioType}/${torrentioId}.json`;
    const res = await fetch(url);
    if (!res.ok) return c.json({ error: "UPSTREAM_ERROR", detail: "Torrentio fetch failed" }, 502);

    const data = await res.json() as { streams?: Array<Record<string, unknown>> };
    const streams = (data.streams ?? []).map((s) => {
      const title = (s.title as string) ?? "";
      const infoHash = (s.infoHash as string) ?? "";
      return {
        title,
        infoHash,
        magnet: `magnet:?xt=urn:btih:${infoHash}`,
        size: parseSizeFromTitle(title),
        seeds: null,
        ...parseTorrentAttrs(title),
      };
    });

    streamCache.set(cacheKey, streams, STREAM_TTL);
    return c.json(streams);
  } catch (err) {
    console.error("Torrentio stream fetch error:", err);
    return c.json({ error: "UPSTREAM_ERROR", detail: "Failed to connect to Torrentio" }, 502);
  }
});

// ── Poster Proxy ───────────────────────────────────────────────

proxy.get("/poster/*", async (c) => {
  const path = c.req.path.replace("/api/poster/", "");
  if (!path) return c.json({ error: "VALIDATION_ERROR", detail: "path required" }, 400);

  const cacheKey = `poster:${path}`;
  const cached = posterCache.get(cacheKey);
  if (cached) {
    c.header("Content-Type", "image/jpeg");
    c.header("Cache-Control", "public, max-age=604800");
    return c.body(cached as unknown as ReadableStream);
  }

  try {
    const res = await fetch(`https://image.tmdb.org/t/p/w500/${path}`);
    if (!res.ok) return c.json({ error: "UPSTREAM_ERROR", detail: "Poster fetch failed" }, 502);

    const buffer = Buffer.from(await res.arrayBuffer());
    posterCache.set(cacheKey, buffer, POSTER_TTL);

    c.header("Content-Type", "image/jpeg");
    c.header("Cache-Control", "public, max-age=604800");
    return c.body(buffer as unknown as ReadableStream);
  } catch (err) {
    console.error("Poster proxy fetch error:", err);
    return c.json({ error: "UPSTREAM_ERROR", detail: "Failed to fetch poster" }, 502);
  }
});

// ── Helpers ────────────────────────────────────────────────────

function extractYear(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function parseSizeFromTitle(title: string): number | null {
  const match = title.match(/([\d.]+)\s*(GB|MB)/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  return match[2].toUpperCase() === "GB"
    ? Math.round(num * 1024 * 1024 * 1024)
    : Math.round(num * 1024 * 1024);
}

function parseTorrentAttrs(title: string): {
  resolution: string | null;
  codec: string | null;
  audio: string | null;
  hdr: boolean | null;
  source: string | null;
} {
  const t = title.toLowerCase();

  let resolution: string | null = null;
  if (t.includes("2160p") || t.includes("4k")) resolution = "2160p";
  else if (t.includes("1080p")) resolution = "1080p";
  else if (t.includes("720p")) resolution = "720p";
  else if (t.includes("480p")) resolution = "480p";

  let hdr: boolean | null = null;
  if (t.includes("dolby vision") || t.includes("dv")) hdr = true;
  else if (t.includes("hdr10+") || t.includes("hdr10plus")) hdr = true;
  else if (t.includes("hdr")) hdr = true;

  let audio: string | null = null;
  if (t.includes("atmos")) audio = "Atmos";
  else if (t.includes("7.1")) audio = "7.1";
  else if (t.includes("5.1")) audio = "5.1";
  else if (t.includes("2.0") || t.includes("aac")) audio = "2.0";

  let codec: string | null = null;
  if (t.includes("x265") || t.includes("h.265") || t.includes("hevc"))
    codec = "HEVC";
  else if (t.includes("x264") || t.includes("h.264") || t.includes("avc"))
    codec = "H.264";
  else if (t.includes("av1")) codec = "AV1";

  let source: string | null = null;
  if (t.includes("bluray") || t.includes("blu-ray")) source = "BluRay";
  else if (t.includes("web-dl") || t.includes("webdl")) source = "WEB-DL";
  else if (t.includes("webrip")) source = "WEBRip";
  else if (t.includes("hdtv")) source = "HDTV";

  return { resolution, codec, audio, hdr, source };
}

export { proxy };
