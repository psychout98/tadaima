import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  // Bundle @tadaima/shared into the output so it's not a runtime dependency
  noExternal: ["@tadaima/shared"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
