import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { platform, homedir } from "node:os";
import { join } from "node:path";

const SERVICE_NAME = "tadaima-agent";

export function installService(): void {
  const os = platform();

  if (os === "linux") {
    installSystemd();
  } else if (os === "darwin") {
    installLaunchd();
  } else if (os === "win32") {
    console.log(
      "Windows service installation requires the MSI installer or node-windows.",
    );
    console.log(
      "Run the Tadaima installer (.msi) for automatic service registration.",
    );
  } else {
    console.log(`Unsupported platform: ${os}`);
  }
}

export function uninstallService(): void {
  const os = platform();

  if (os === "linux") {
    uninstallSystemd();
  } else if (os === "darwin") {
    uninstallLaunchd();
  } else {
    console.log(`Unsupported platform: ${os}`);
  }
}

// ── systemd (Linux) ────────────────────────────────────────────

function installSystemd(): void {
  const execPath = process.execPath;
  const scriptPath = process.argv[1];
  const user = process.env.USER ?? "root";

  const unit = `[Unit]
Description=Tadaima Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
ExecStart=${execPath} ${scriptPath} start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;

  const unitPath = `/etc/systemd/system/${SERVICE_NAME}.service`;

  try {
    writeFileSync(unitPath, unit);
    execSync("systemctl daemon-reload");
    execSync(`systemctl enable ${SERVICE_NAME}`);
    execSync(`systemctl start ${SERVICE_NAME}`);
    console.log(`Service installed and started: ${SERVICE_NAME}`);
    console.log(`  Status: systemctl status ${SERVICE_NAME}`);
    console.log(`  Logs:   journalctl -u ${SERVICE_NAME} -f`);
  } catch (err) {
    console.error(
      "Failed to install service. Try running with sudo.",
      err instanceof Error ? err.message : "",
    );
  }
}

function uninstallSystemd(): void {
  const unitPath = `/etc/systemd/system/${SERVICE_NAME}.service`;

  try {
    execSync(`systemctl stop ${SERVICE_NAME}`).toString();
  } catch {
    // May not be running
  }

  try {
    execSync(`systemctl disable ${SERVICE_NAME}`);
    if (existsSync(unitPath)) unlinkSync(unitPath);
    execSync("systemctl daemon-reload");
    console.log(`Service removed: ${SERVICE_NAME}`);
  } catch (err) {
    console.error(
      "Failed to uninstall service. Try running with sudo.",
      err instanceof Error ? err.message : "",
    );
  }
}

// ── launchd (macOS) ────────────────────────────────────────────

function installLaunchd(): void {
  const execPath = process.execPath;
  const scriptPath = process.argv[1];
  const label = `com.tadaima.agent`;
  const plistPath = join(homedir(), "Library/LaunchAgents", `${label}.plist`);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${execPath}</string>
    <string>${scriptPath}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), ".config/tadaima/logs/tadaima.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), ".config/tadaima/logs/tadaima.log")}</string>
</dict>
</plist>
`;

  try {
    writeFileSync(plistPath, plist);
    execSync(`launchctl load ${plistPath}`);
    console.log(`Service installed and started: ${label}`);
    console.log(`  Plist: ${plistPath}`);
    console.log(`  Stop:  launchctl unload ${plistPath}`);
  } catch (err) {
    console.error(
      "Failed to install service.",
      err instanceof Error ? err.message : "",
    );
  }
}

function uninstallLaunchd(): void {
  const label = `com.tadaima.agent`;
  const plistPath = join(homedir(), "Library/LaunchAgents", `${label}.plist`);

  try {
    execSync(`launchctl unload ${plistPath}`);
  } catch {
    // May not be loaded
  }

  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
    console.log(`Service removed: ${label}`);
  } else {
    console.log("Service not installed.");
  }
}
