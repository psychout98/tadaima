import { config } from "./config.js";

const BASE_URL = "https://api.real-debrid.com/rest/1.0";

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.get("realDebrid.apiKey")}`,
  };
}

async function rdFetch(
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { ...getHeaders(), ...(opts.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RD API error ${res.status}: ${body}`);
  }
  return res;
}

export interface UnrestrictedLink {
  url: string;
  filename: string;
  filesize: number;
}

export const rdClient = {
  async addMagnet(
    magnet: string,
  ): Promise<{ id: string; uri: string }> {
    const form = new URLSearchParams({ magnet });
    const res = await rdFetch("/torrents/addMagnet", {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return (await res.json()) as { id: string; uri: string };
  },

  async selectFiles(torrentId: string, fileIds?: string): Promise<void> {
    const form = new URLSearchParams({ files: fileIds ?? "all" });
    await rdFetch(`/torrents/selectFiles/${torrentId}`, {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  },

  async getTorrentInfo(
    torrentId: string,
  ): Promise<{
    id: string;
    status: string;
    progress: number;
    links: string[];
    filename: string;
  }> {
    const res = await rdFetch(`/torrents/info/${torrentId}`);
    return (await res.json()) as {
      id: string;
      status: string;
      progress: number;
      links: string[];
      filename: string;
    };
  },

  async pollUntilReady(
    torrentId: string,
    pollInterval: number = config.get("rdPollInterval") * 1000,
    timeout: number = 30 * 60 * 1000,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const start = Date.now();
    const errorStatuses = ["error", "virus", "dead", "magnet_error"];

    while (Date.now() - start < timeout) {
      if (signal?.aborted) throw new Error("Cancelled");

      const info = await this.getTorrentInfo(torrentId);

      if (info.status === "downloaded") {
        return info.links;
      }

      if (errorStatuses.includes(info.status)) {
        throw new Error(`RD torrent error: ${info.status}`);
      }

      if (onProgress) onProgress(info.progress);

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error("RD poll timeout (30 minutes)");
  },

  async unrestrictLink(link: string): Promise<UnrestrictedLink> {
    const form = new URLSearchParams({ link });
    const res = await rdFetch("/unrestrict/link", {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = (await res.json()) as {
      download: string;
      filename: string;
      filesize: number;
    };
    return { url: data.download, filename: data.filename, filesize: data.filesize };
  },

  async unrestrictAll(links: string[]): Promise<UnrestrictedLink[]> {
    const results: UnrestrictedLink[] = [];
    for (const link of links) {
      results.push(await this.unrestrictLink(link));
    }
    return results;
  },

  async checkCache(
    infoHashes: string[],
  ): Promise<Record<string, boolean>> {
    if (infoHashes.length === 0) return {};
    const hashStr = infoHashes.join("/");
    const res = await rdFetch(`/torrents/instantAvailability/${hashStr}`);
    const data = (await res.json()) as Record<string, unknown>;
    const result: Record<string, boolean> = {};
    for (const hash of infoHashes) {
      const entry = data[hash.toLowerCase()];
      result[hash] =
        entry != null &&
        typeof entry === "object" &&
        Object.keys(entry as object).length > 0;
    }
    return result;
  },

  async downloadMagnet(
    magnet: string,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<UnrestrictedLink[]> {
    const { id } = await this.addMagnet(magnet);
    await this.selectFiles(id);
    const links = await this.pollUntilReady(
      id,
      undefined,
      undefined,
      onProgress,
      signal,
    );
    return this.unrestrictAll(links);
  },
};
