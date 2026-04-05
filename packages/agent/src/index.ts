import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runSetup } from "./setup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const command = process.argv[2];

if (command === "setup") {
  runSetup();
} else if (command === "--version" || command === "-v") {
  console.log(`tadaima-agent v${pkg.version}`);
} else {
  console.log(`tadaima-agent v${pkg.version}`);
  console.log(`Node.js ${process.version} on ${process.platform} ${process.arch}`);
  console.log("\nCommands:");
  console.log("  setup    Pair this device with your Tadaima instance");
  console.log("  -v       Show version");
}
