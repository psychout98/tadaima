import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

console.log(`tadaima-agent v${pkg.version}`);
console.log(`Node.js ${process.version} on ${process.platform} ${process.arch}`);
