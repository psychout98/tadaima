import { mkdir, rename } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { config } from "./config.js";
import { buildMoviePath, buildEpisodePath } from "@tadaima/shared";

export interface OrganizeRequest {
  title: string;
  year: number;
  tmdbId: number;
  mediaType: "movie" | "tv";
  season?: number;
  episode?: number;
  episodeTitle?: string;
  sourcePath: string;
}

/**
 * Move a downloaded file to Plex-compatible directory structure.
 * Returns the final path.
 */
function assertWithinBase(destPath: string, baseDir: string): string {
  const resolvedDest = resolve(destPath);
  const resolvedBase = resolve(baseDir);
  if (!resolvedDest.startsWith(resolvedBase + "/") && resolvedDest !== resolvedBase) {
    throw new Error(`Path traversal detected: ${destPath} escapes base directory ${baseDir}`);
  }
  return resolvedDest;
}

export async function organizeFile(req: OrganizeRequest): Promise<string> {
  if (!req.sourcePath || req.sourcePath.trim() === "") {
    throw new Error("Invalid organizeFile request: sourcePath is empty or missing");
  }

  const ext = extname(req.sourcePath).replace(".", "");
  let relativePath: string;

  if (req.mediaType === "movie") {
    const moviesBase = config.get("directories.movies");
    relativePath = buildMoviePath(req.title, req.year, req.tmdbId, ext);
    const destPath = join(moviesBase, relativePath.replace(/^Movies\//, ""));
    assertWithinBase(destPath, moviesBase);
    await mkdir(dirname(destPath), { recursive: true });
    await rename(req.sourcePath, destPath);
    return destPath;
  } else {
    const tvBase = config.get("directories.tv");

    // Parse SxxExx pattern from filename if episode not provided
    const filename = basename(req.sourcePath);
    let episodeNum = req.episode;
    let epTitle = req.episodeTitle;
    if (episodeNum == null) {
      const match = filename.match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
      if (match) {
        episodeNum = parseInt(match[2], 10);
      }
    }
    if (!epTitle && episodeNum != null) {
      epTitle = `Episode ${episodeNum}`;
    }

    relativePath = buildEpisodePath(
      req.title,
      req.tmdbId,
      req.season ?? 1,
      episodeNum ?? 1,
      epTitle ?? `Episode ${episodeNum ?? 1}`,
      ext,
    );
    const destPath = join(tvBase, relativePath.replace(/^TV\//, ""));
    assertWithinBase(destPath, tvBase);
    await mkdir(dirname(destPath), { recursive: true });
    await rename(req.sourcePath, destPath);
    return destPath;
  }
}
