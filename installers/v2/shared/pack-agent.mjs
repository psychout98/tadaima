#!/usr/bin/env node
// Run `npm pack @psychout98/tadaima@<pinned version>` into a staging
// directory and print the resulting .tgz path on stdout. Used by both
// platform build scripts and by CI to produce the offline-install tarball
// that gets embedded in the installer.
//
// Usage:
//   node pack-agent.mjs [--out <dir>]
//
// The pinned version is read from agent-version.json in this directory.
// Only Node built-ins are used.

import { readFile, mkdir, readdir, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = join(__dirname, "agent-version.json");

function log(msg) {
  process.stderr.write(`[pack-agent] ${msg}\n`);
}

function parseArgs(argv) {
  const args = { out: null };
  const rest = argv.slice(2);
  while (rest.length) {
    const a = rest.shift();
    if (a === "--out") {
      args.out = rest.shift();
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const manifest = JSON.parse(await readFile(VERSION_FILE, "utf8"));
  const version = manifest.version;
  if (!version) {
    throw new Error(`no "version" field in ${VERSION_FILE}`);
  }

  const outDir = args.out
    ? resolve(args.out)
    : join(__dirname, ".staging", "agent-tarball");
  await mkdir(outDir, { recursive: true });

  log(`packing @psychout98/tadaima@${version} into ${outDir}`);

  // `npm pack <pkg>@<version>` writes a .tgz into the current working
  // directory. We invoke it with cwd=outDir so the tarball lands there.
  //
  // `shell: true` is required on Windows: since the CVE-2024-27980 patch
  // (Node 18.20.2 / 20.12.2, April 2024), spawning a .cmd/.bat file
  // without a shell fails with EINVAL before the child ever runs. Using
  // the shell routes the call through cmd.exe, which is the supported
  // post-patch way to invoke npm's .cmd shim. Enabling it unconditionally
  // keeps the POSIX path equivalent.
  const result = spawnSync(
    "npm",
    ["pack", `@psychout98/tadaima@${version}`, "--silent"],
    {
      cwd: outDir,
      stdio: ["ignore", "pipe", "inherit"],
      shell: true,
    },
  );
  if (result.error) {
    throw new Error(`npm pack could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`npm pack failed with exit code ${result.status}`);
  }

  // Find the tarball that npm just wrote. Normalize the name to a
  // predictable `agent-tarball.tgz` so downstream build scripts do not
  // need to know the version.
  const entries = await readdir(outDir);
  const tgz = entries.find((n) => n.endsWith(".tgz"));
  if (!tgz) {
    throw new Error(`no .tgz produced by npm pack in ${outDir}`);
  }
  const src = join(outDir, tgz);
  const dest = join(outDir, "agent-tarball.tgz");
  if (src !== dest) {
    await rename(src, dest);
  }

  process.stdout.write(dest + "\n");
}

main().catch((err) => {
  process.stderr.write(`[pack-agent] ${err.message}\n`);
  process.exit(1);
});
