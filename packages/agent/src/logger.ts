import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createInterface } from "node:readline";
import type { Interface as RLInterface } from "node:readline";
import { getLogPath } from "./daemon.js";

let _intervalId: ReturnType<typeof setInterval> | undefined;
let _rl: RLInterface | undefined;

function cleanup(): void {
  if (_intervalId !== undefined) {
    clearInterval(_intervalId);
    _intervalId = undefined;
  }
  if (_rl) {
    _rl.close();
    _rl = undefined;
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

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
  cleanup();

  let offset = statSync(path).size;

  console.log(`Following ${path} (Ctrl+C to stop)\n`);

  _intervalId = setInterval(() => {
    try {
      const currentSize = statSync(path).size;
      if (currentSize > offset) {
        if (_rl) {
          _rl.close();
          _rl = undefined;
        }

        const stream = createReadStream(path, {
          start: offset,
          encoding: "utf-8",
        });
        _rl = createInterface({ input: stream });

        _rl.on("line", (line) => {
          console.log(line);
        });

        _rl.on("close", () => {
          offset = currentSize;
        });
      }
    } catch {
      // File may have been rotated
    }
  }, 500);
}
