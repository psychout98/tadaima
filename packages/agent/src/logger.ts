import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { getLogPath } from "./daemon.js";

export function tailLogs(lines: number = 50, follow: boolean = false): void {
  const logPath = getLogPath();

  if (!existsSync(logPath)) {
    console.log("No log file found. Start the agent in daemon mode first.");
    return;
  }

  if (follow) {
    followLog(logPath);
  } else {
    tailFile(logPath, lines);
  }
}

function tailFile(path: string, n: number): void {
  const content = readFileSync(path, "utf-8");
  const allLines = content.split("\n");
  const tail = allLines.slice(-n);
  console.log(tail.join("\n"));
}

function followLog(path: string): void {
  let offset = statSync(path).size;

  console.log(`Following ${path} (Ctrl+C to stop)\n`);

  setInterval(() => {
    try {
      const currentSize = statSync(path).size;
      if (currentSize > offset) {
        const stream = createReadStream(path, {
          start: offset,
          encoding: "utf-8",
        });
        const rl = createInterface({ input: stream });

        rl.on("line", (line) => {
          console.log(line);
        });

        rl.on("close", () => {
          offset = currentSize;
        });
      }
    } catch {
      // File may have been rotated
    }
  }, 500);
}
