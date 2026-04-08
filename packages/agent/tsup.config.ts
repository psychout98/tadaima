import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  // Bundle @tadaima/shared into the output so it's not a runtime dependency
  noExternal: ["@tadaima/shared"],
  // Inject version at build time so it works in both Node and Bun-compiled binaries
  define: {
    "AGENT_VERSION": JSON.stringify(pkg.version),
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
});
