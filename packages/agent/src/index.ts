import type { AgentConfig } from "./config.js";

declare const AGENT_VERSION: string;
const pkg = { version: AGENT_VERSION };

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
      const { shouldCheckNow, checkForUpdate, applyUpdate, logUpdateAdvisory } =
        await import("./updater.js");
      const { writeStatusFile, removeStatusFile, STATUS_HEARTBEAT_INTERVAL_MS } =
        await import("./status-file.js");

      const ws = new AgentWebSocket();
      const handler = new DownloadHandler(ws);
      const tui = new TUI(pkg.version);

      // Track connection state for status file (ws internals are private)
      let wsConnected = false;

      // Non-blocking update check on startup
      let pendingUpdate: Awaited<ReturnType<typeof checkForUpdate>> = null;

      const tryApplyUpdate = async () => {
        if (!pendingUpdate) return;
        if (handler.activeCount > 0) return; // defer until idle
        try {
          await applyUpdate(pendingUpdate);
        } catch (err) {
          console.warn(
            "Auto-update failed:",
            err instanceof Error ? err.message : err,
          );
        }
        pendingUpdate = null;
      };

      const runUpdateCheck = async () => {
        try {
          const result = await checkForUpdate(pkg.version);
          if (result) {
            // For npm/Docker installs where binary replacement won't work,
            // just log an advisory
            const isBinaryInstall = !process.argv[1]?.includes("node_modules");
            if (!isBinaryInstall) {
              logUpdateAdvisory(pkg.version, result.version);
              return;
            }
            pendingUpdate = result;
            await tryApplyUpdate();
          }
        } catch (err) {
          console.warn(
            "Update check failed:",
            err instanceof Error ? err.message : err,
          );
        }
      };

      if (shouldCheckNow("startup")) {
        runUpdateCheck();
      }

      // Periodic update check every hour
      const updateInterval = setInterval(async () => {
        if (shouldCheckNow("periodic")) {
          await runUpdateCheck();
        }
      }, 60 * 60 * 1000);

      ws.setMessageHandler((msg) => {
        wsConnected = true; // receiving messages means we're connected
        const type = msg.type as string;
        if (type === "download:request") {
          handler.handleRequest(msg);
        } else if (type === "download:cancel") {
          handler.handleCancel(msg);
        } else if (type === "cache:check") {
          handler.handleCacheCheck(msg);
        }
      });

      ws.connect();

      // Write status file on each heartbeat for the tray / menu bar apps.
      const { config: agentConfig } = await import("./config.js");
      const snapshotStatus = (connected: boolean) => ({
        version: pkg.version,
        pid: process.pid,
        connected,
        relayUrl: agentConfig.get("relay"),
        deviceId: agentConfig.get("deviceId"),
        deviceName: agentConfig.get("deviceName"),
        activeDownloads: handler.activeCount,
        lastHeartbeat: new Date().toISOString(),
      });
      const writeStatusSafe = (connected: boolean) => {
        writeStatusFile(snapshotStatus(connected)).catch((err) => {
          // A failed status write must never crash the heartbeat loop.
          console.warn(
            "status.json write failed:",
            err instanceof Error ? err.message : err,
          );
        });
      };

      const statusInterval = setInterval(() => {
        writeStatusSafe(wsConnected);
      }, STATUS_HEARTBEAT_INTERVAL_MS);

      // Write an initial status file immediately so tray apps have
      // something to read before the first heartbeat tick lands.
      writeStatusSafe(false);

      // Use TUI unless running as daemon
      if (!process.env.TADAIMA_DAEMON) {
        tui.start();
      }

      process.on("SIGINT", () => {
        clearInterval(updateInterval);
        clearInterval(statusInterval);
        removeStatusFile();
        tui.stop();
        ws.stop();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        clearInterval(updateInterval);
        clearInterval(statusInterval);
        removeStatusFile();
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
        console.log(config.get(key as keyof AgentConfig));
      } else if (subcommand === "set") {
        const key = args[2];
        const value = args[3];
        if (!key || value === undefined) {
          console.log("Usage: tadaima config set <key> <value>");
          break;
        }
        config.set(key as keyof AgentConfig, value as AgentConfig[keyof AgentConfig]);
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

    case "update": {
      const { checkForUpdate, applyUpdate, logUpdateAdvisory } = await import("./updater.js");
      const isBinaryInstall = !process.argv[1]?.includes("node_modules");
      console.log(`Current version: v${pkg.version}`);
      console.log("Checking for updates...");
      try {
        const result = await checkForUpdate(pkg.version);
        if (!result) {
          console.log("Already up to date.");
        } else if (!isBinaryInstall) {
          logUpdateAdvisory(pkg.version, result.version);
        } else {
          console.log(`Update available: v${result.version}`);
          await applyUpdate(result);
        }
      } catch (err) {
        console.error(
          "Update failed:",
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
      break;
    }

    case "rollback": {
      const { rollback } = await import("./updater.js");
      rollback();
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
      console.log("  update             Check for and apply updates");
      console.log("  rollback           Restore previous binary version");
      console.log("  version            Show version info");
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
