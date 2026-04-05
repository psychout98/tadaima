import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runSetup } from "./setup.js";
import { AgentWebSocket } from "./ws-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const command = process.argv[2];

if (command === "setup") {
  runSetup();
} else if (command === "start") {
  console.log(`tadaima-agent v${pkg.version}`);
  const ws = new AgentWebSocket();
  ws.setMessageHandler((msg) => {
    console.log("Received:", msg.type);
  });
  ws.connect();

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    ws.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    ws.stop();
    process.exit(0);
  });
} else if (command === "--version" || command === "-v") {
  console.log(`tadaima-agent v${pkg.version}`);
} else {
  console.log(`tadaima-agent v${pkg.version}`);
  console.log(`Node.js ${process.version} on ${process.platform} ${process.arch}`);
  console.log("\nCommands:");
  console.log("  setup    Pair this device with your Tadaima instance");
  console.log("  start    Connect to relay and start accepting downloads");
  console.log("  -v       Show version");
}
