import { mkdir, rename } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
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
export async function organizeFile(req: OrganizeRequest): Promise<string> {
  const ext = extname(req.sourcePath).replace(".", "");
  let relativePath: string;

  if (req.mediaType === "movie") {
    relativePath = buildMoviePath(req.title, req.year, req.tmdbId, ext);
    const destPath = join(config.get("directories.movies"), relativePath.replace(/^Movies\//, ""));
    await mkdir(dirname(destPath), { recursive: true });
    await rename(req.sourcePath, destPath);
    return destPath;
  } else {
    relativePath = buildEpisodePath(
      req.title,
      req.tmdbId,
      req.season ?? 1,
      req.episode ?? 1,
      req.episodeTitle ?? `Episode ${req.episode ?? 1}`,
      ext,
    );
    const destPath = join(config.get("directories.tv"), relativePath.replace(/^TV\//, ""));
    await mkdir(dirname(destPath), { recursive: true });
    await rename(req.sourcePath, destPath);
    return destPath;
  }
}
