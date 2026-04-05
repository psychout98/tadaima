import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  eta: number;
}

/**
 * Download a file via HTTP with progress reporting.
 */
export async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<number> {
  await mkdir(dirname(destPath), { recursive: true });

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const totalBytes = parseInt(res.headers.get("content-length") ?? "0", 10);
  let downloadedBytes = 0;
  let lastReport = Date.now();
  const startTime = Date.now();

  const reader = res.body.getReader();
  const fileStream = createWriteStream(destPath);

  const readable = new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }

        downloadedBytes += value.byteLength;

        // Throttle progress to 1/sec
        const now = Date.now();
        if (now - lastReport >= 1000 && onProgress) {
          const elapsed = (now - startTime) / 1000;
          const speedBps =
            elapsed > 0 ? Math.round(downloadedBytes / elapsed) : 0;
          const remaining =
            speedBps > 0 ? (totalBytes - downloadedBytes) / speedBps : 0;

          onProgress({
            downloadedBytes,
            totalBytes,
            speedBps,
            eta: Math.round(remaining),
          });

          lastReport = now;
        }

        this.push(Buffer.from(value));
      } catch (err) {
        this.destroy(err as Error);
      }
    },
  });

  await pipeline(readable, fileStream);
  return downloadedBytes;
}
