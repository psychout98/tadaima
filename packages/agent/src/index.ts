import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case "setup": {
      const { runSetup } = await import("./setup.js");
      await runSetup();
      break;
    }

    case "start": {
      const isDaemon = args.includes("-d") || args.includes("--daemon");

      if (isDaemon) {
        const { startDaemon } = await import("./daemon.js");
        startDaemon();
        break;
      }

      console.log(`tadaima-agent v${pkg.version}`);

      const { AgentWebSocket } = await import("./ws-client.js");
      const { DownloadHandler } = await import("./download-handler.js");
      const { TUI } = await import("./tui.js");

      const ws = new AgentWebSocket();
      const handler = new DownloadHandler(ws);
      const tui = new TUI(pkg.version);
      tui.setHandler(handler);

      ws.setMessageHandler((msg) => {
        const type = msg.type as string;
        if (type === "download:request") {
          handler.handleRequest(msg);
        } else if (type === "download:cancel") {
          handler.handleCancel(msg);
        } else if (type === "cache:check") {
          handler.handleCacheCheck(msg);
        }
      });

      // Track connection status for TUI
      const origConnect = ws.connect.bind(ws);
      ws.connect = function () {
        origConnect();
      };

      ws.connect();

      // Use TUI unless running as daemon
      if (!process.env.TADAIMA_DAEMON) {
        tui.start();
      }

      process.on("SIGINT", () => {
        tui.stop();
        ws.stop();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        tui.stop();
        ws.stop();
        process.exit(0);
      });
      break;
    }

    case "stop": {
      const { stopDaemon } = await import("./daemon.js");
      stopDaemon();
      break;
    }

    case "status": {
      const { getDaemonStatus } = await import("./daemon.js");
      const { config } = await import("./config.js");
      const st = getDaemonStatus();

      console.log(`tadaima-agent v${pkg.version}`);
      console.log(`Relay: ${config.get("relay") || "Not configured"}`);
      console.log(`Device: ${config.get("deviceName") || "Not paired"}`);
      console.log(
        `Status: ${st.running ? `Running (PID ${st.pid})` : "Not running"}`,
      );
      break;
    }

    case "config": {
      const { config } = await import("./config.js");
      const subcommand = args[1];

      if (subcommand === "get") {
        const key = args[2];
        if (!key) {
          console.log("Usage: tadaima config get <key>");
          break;
        }
        console.log(config.get(key as never));
      } else if (subcommand === "set") {
        const key = args[2];
        const value = args[3];
        if (!key || value === undefined) {
          console.log("Usage: tadaima config set <key> <value>");
          break;
        }
        config.set(key as never, value as never);
        console.log(`Set ${key} = ${value}`);
      } else if (subcommand === "list") {
        const store = config.store;
        const redacted = { ...store } as Record<string, unknown>;
        if (redacted.deviceToken)
          redacted.deviceToken = "****" + String(redacted.deviceToken).slice(-8);
        if (
          redacted.realDebrid &&
          typeof redacted.realDebrid === "object" &&
          (redacted.realDebrid as Record<string, unknown>).apiKey
        ) {
          redacted.realDebrid = {
            ...(redacted.realDebrid as Record<string, unknown>),
            apiKey: "****",
          };
        }
        console.log(JSON.stringify(redacted, null, 2));
      } else {
        console.log("Usage: tadaima config <get|set|list>");
      }
      break;
    }

    case "logs": {
      const { tailLogs } = await import("./logger.js");
      const follow = args.includes("-f") || args.includes("--follow");
      const nIdx = args.indexOf("-n");
      const lines = nIdx >= 0 ? parseInt(args[nIdx + 1], 10) : 50;
      tailLogs(lines, follow);
      break;
    }

    case "install-service": {
      const { installService } = await import("./service.js");
      installService();
      break;
    }

    case "uninstall-service": {
      const { uninstallService } = await import("./service.js");
      uninstallService();
      break;
    }

    case "version":
    case "--version":
    case "-v":
      console.log(`tadaima-agent v${pkg.version}`);
      break;

    default:
      console.log(`tadaima-agent v${pkg.version}`);
      console.log(
        `Node.js ${process.version} on ${process.platform} ${process.arch}`,
      );
      console.log("");
      console.log("Commands:");
      console.log("  setup              Pair this device with your Tadaima instance");
      console.log("  start              Start agent (foreground with TUI)");
      console.log("  start -d           Start as background daemon");
      console.log("  stop               Stop background daemon");
      console.log("  status             Show connection status");
      console.log("  config get <key>   Read a config value");
      console.log("  config set <k> <v> Update a config value");
      console.log("  config list        Show all config values");
      console.log("  logs               Tail recent logs");
      console.log("  logs -f            Follow log output");
      console.log("  install-service    Install as system service");
      console.log("  uninstall-service  Remove system service");
      console.log("  version            Show version info");
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
