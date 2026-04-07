import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { GITHUB_RELEASES_API, GITHUB_REPO } from "@tadaima/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
let relayVersion = "0.0.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "../..", "package.json"), "utf-8"),
  );
  relayVersion = pkg.version;
} catch {
  // ignore
}

const version = new Hono();

interface CachedRelease {
  latest: string;
  downloadUrl: string;
  fetchedAt: number;
}

const SIX_HOURS = 6 * 60 * 60 * 1000;
let cache: CachedRelease | null = null;

async function getLatestRelease(): Promise<CachedRelease | null> {
  if (cache && Date.now() - cache.fetchedAt < SIX_HOURS) {
    return cache;
  }

  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "tadaima-relay",
      },
    });

    if (!res.ok) return cache; // return stale cache on error

    const data = (await res.json()) as { tag_name: string };
    const latest = data.tag_name.replace(/^v/, "");

    cache = {
      latest,
      downloadUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
      fetchedAt: Date.now(),
    };

    return cache;
  } catch {
    return cache; // return stale cache on network error
  }
}

// GET /api/version — public, no auth required
// Returns current relay version and latest available agent version
version.get("/", async (c) => {
  const release = await getLatestRelease();

  return c.json({
    current: relayVersion,
    latest: release?.latest ?? null,
    downloadUrl: release?.downloadUrl ?? null,
  });
});

export { version as versionRoute };
