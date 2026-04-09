#!/usr/bin/env node
// Download and verify a pinned Node.js runtime for embedding in a Tadaima
// installer. Used by both installers/v2/windows/build.ps1 and
// installers/v2/macos/build.sh, and by the GitHub Actions workflow.
//
// Usage:
//   node fetch-node-runtime.mjs <platform> [--out <dir>]
//
//   <platform> is a key from installers/v2/shared/node-runtime-versions.json
//   (e.g. "win-x64", "darwin-arm64", "darwin-x64").
//
//   --out defaults to installers/v2/shared/.staging/node-<platform>/.
//
// Output: the absolute path to the extracted Node directory is printed on
// stdout as the final line of output, so callers can `$(node …)` it.
//
// The script uses only Node built-ins so it can run before any dependencies
// are installed. Do not add npm deps.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { get as httpsGet } from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSIONS_FILE = join(__dirname, "node-runtime-versions.json");

function parseArgs(argv) {
  const args = { platform: null, out: null };
  const rest = argv.slice(2);
  while (rest.length) {
    const a = rest.shift();
    if (a === "--out") {
      args.out = rest.shift();
    } else if (!args.platform) {
      args.platform = a;
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  if (!args.platform) {
    throw new Error(
      "Usage: fetch-node-runtime.mjs <platform> [--out <dir>]\n" +
        "Valid platforms: see installers/v2/shared/node-runtime-versions.json",
    );
  }
  return args;
}

async function loadManifest() {
  const raw = await readFile(VERSIONS_FILE, "utf8");
  return JSON.parse(raw);
}

function log(msg) {
  process.stderr.write(`[fetch-node-runtime] ${msg}\n`);
}

async function download(url, dest) {
  log(`downloading ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await new Promise((resolvePromise, reject) => {
    const request = (u) => {
      httpsGet(u, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          request(new URL(res.headers.location, u).toString());
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        const out = createWriteStream(dest);
        pipeline(res, out).then(resolvePromise, reject);
      }).on("error", reject);
    };
    request(url);
  });
}

async function sha256File(path) {
  const { createReadStream } = await import("node:fs");
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolvePromise(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function extract(archivePath, targetDir) {
  log(`extracting ${archivePath}`);
  // We deliberately shell out to platform-native archive tools rather than
  // pull in an npm tar/zip library. Both tar and unzip ship with macOS,
  // Linux, and Windows runners used in CI.
  let result;
  if (archivePath.endsWith(".zip")) {
    // PowerShell's Expand-Archive is present on Windows CI images; on mac
    // and Linux we fall back to `unzip`, which is usually available.
    if (process.platform === "win32") {
      result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${targetDir}' -Force`,
        ],
        { stdio: "inherit" },
      );
    } else {
      result = spawnSync("unzip", ["-q", "-o", archivePath, "-d", targetDir], {
        stdio: "inherit",
      });
    }
  } else if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
    result = spawnSync("tar", ["-xzf", archivePath, "-C", targetDir], {
      stdio: "inherit",
    });
  } else {
    throw new Error(`Unsupported archive type: ${archivePath}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `extraction failed (exit code ${result.status ?? "n/a"})`,
    );
  }
}

async function listOneChild(dir) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (dirs.length !== 1) {
    throw new Error(
      `expected exactly one top-level directory inside ${dir}, got: ${dirs.join(", ") || "none"}`,
    );
  }
  return join(dir, dirs[0]);
}

async function main() {
  const args = parseArgs(process.argv);
  const manifest = await loadManifest();
  const entry = manifest.platforms[args.platform];
  if (!entry) {
    throw new Error(
      `unknown platform "${args.platform}"; valid: ${Object.keys(manifest.platforms).join(", ")}`,
    );
  }

  const stagingRoot = args.out
    ? resolve(args.out)
    : join(__dirname, ".staging", `node-${args.platform}`);

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  const archiveName = entry.url.split("/").pop();
  const archivePath = join(stagingRoot, archiveName);
  await download(entry.url, archivePath);

  const actual = await sha256File(archivePath);
  if (actual !== entry.sha256) {
    throw new Error(
      `checksum mismatch for ${args.platform}\n  expected ${entry.sha256}\n  got      ${actual}`,
    );
  }
  log(`checksum ok (${actual})`);

  const extractDir = join(stagingRoot, "extracted");
  await mkdir(extractDir, { recursive: true });
  extract(archivePath, extractDir);

  // Both the .tar.gz and .zip distributions contain a single top-level
  // directory (e.g. node-v22.11.0-darwin-arm64). Walk into it so the caller
  // gets the directory that directly contains bin/node (or node.exe).
  const nodeRoot = await listOneChild(extractDir);
  await stat(nodeRoot); // sanity check

  // The final line of stdout is the path — scripts consume it with $(…).
  process.stdout.write(nodeRoot + "\n");
}

main().catch((err) => {
  process.stderr.write(`[fetch-node-runtime] ${err.message}\n`);
  process.exit(1);
});
