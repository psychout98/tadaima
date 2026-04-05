# Phase 8: Agent Polish — Detailed Spec

> **Goal**: Transform the agent into a polished CLI/TUI tool with daemon mode, system service integration, Windows tray app, config management, and log viewing.

After this phase, the agent can run as a foreground TUI, background daemon, or system service. Windows users get a system tray app. The CLI exposes configuration, logs, and status commands.

---

## Overview

Phase 8 adds four major capabilities to the agent:

1. **TUI (Terminal UI)** — Real-time progress display when running in foreground
2. **Daemon mode** — Background operation with PID file management and SIGTERM handling
3. **System service installation** — Windows Service, systemd, launchd integration
4. **Windows system tray app** — Status, download monitoring, start/stop, settings, logs
5. **Configuration CLI** — Get/set/list config values with dot notation
6. **Log viewer** — Tail and follow log output with rotation
7. **CLI commands** — Structured argument parsing with `commander.js`

---

## 1. TUI Mode (Terminal UI)

### 1.1 Technology Choice: Raw ANSI Escape Codes + ANSI Box Drawing

**Decision**: Use raw ANSI escape codes with a lightweight custom renderer, **not** ink or blessed.

**Justification**:
- **Ink** (React for CLI) is overkill for static layouts that update in place
- **Blessed** adds complexity and is harder to debug; better for complex interactive TUIs
- **Raw ANSI** is lightweight, well-documented, and gives full control over rendering
- No external dependencies beyond what we already have (`chalk` for colors, which is already in use)
- Proven approach used by `ora`, `cli-progress`, and other popular CLI tools
- Easy to test and reason about

### 1.2 TUI Layout & Behavior

When `tadaima start` runs (no `-d` flag), the terminal shows:

```
 tadaima v1.0.0 — Connected to relay (Noah)
 ──────────────────────────────────────────
 ↓ Interstellar (2014)           45.2 GB
   ████████████████░░░░░░░░░░░░  62%  18.4 MB/s  ETA 12m

 ↓ Breaking Bad S05E16            1.8 GB
   ██████████████████████████░░  89%  22.1 MB/s  ETA 1m

 ✓ The Matrix (1999)             12.4 GB  ただいま — completed 3m ago
 ──────────────────────────────────────────
 2 active · 847 GB free on /mnt/media
```

**Layout rules**:
- **Header**: Single line with version, connection status ("Connected" / "Connecting" / "Disconnected"), and profile name
- **Separator line**: 42 characters of `─`
- **Active downloads**: One per line, formatted as:
  - Icon (`↓`) + title (max 35 chars, truncate with `…`) + size right-aligned (5 chars)
  - Progress line: 2 spaces + bar (30 chars) + percentage (4 chars) + speed (10 chars) + ETA (7 chars)
- **Recently completed**: Shows last 3 completed downloads (max 2 total lines), each with:
  - Icon (`✓`) + title + size + "ただいま — completed Xm ago"
- **Separator line**: Same as header
- **Footer**: "N active · XXX GB free on /path/to/media"
- **Updates in place**: No scrolling. Use `\u001b[H` (move to home) + `\u001b[J` (clear below) to redraw
- **Ctrl+C handling**: Catches `SIGINT`, gracefully closes WebSocket, flushes logs, exits with code 0

### 1.3 Progress Bar Implementation

```typescript
function renderProgressBar(percent: number, width: number = 30): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
```

### 1.4 TUI Update Loop

- Update frequency: every 100ms (debounced from WebSocket progress events)
- Batch updates: render once per 100ms tick, not on every event
- Clear the screen, redraw from scratch each time
- No cursor visible (hide with `\u001b[?25l`, show with `\u001b[?25h` on exit)

### 1.5 Implementation File

**File**: `packages/agent/src/ui/tui-renderer.ts`

```typescript
import chalk from 'chalk';
import stripAnsi from 'strip-ansi';
import os from 'os';

interface DownloadProgress {
  id: string;
  title: string;
  size: number;
  progress: number; // 0-100
  speedBps: number;
  eta: number; // seconds
}

interface CompletedDownload {
  title: string;
  size: number;
  completedAt: number; // unix ms
}

interface TUIState {
  version: string;
  isConnected: boolean;
  profileName: string;
  activeDownloads: DownloadProgress[];
  completedDownloads: CompletedDownload[];
  mediaPath: string;
  diskFreeGb: number;
}

export class TUIRenderer {
  private lastRenderTime = 0;
  private renderDebounceMs = 100;
  private cursorHidden = false;

  async initialize() {
    process.stdout.write('\u001b[?25l'); // hide cursor
    this.cursorHidden = true;
  }

  async cleanup() {
    if (this.cursorHidden) {
      process.stdout.write('\u001b[?25h'); // show cursor
    }
  }

  shouldRender(): boolean {
    const now = Date.now();
    if (now - this.lastRenderTime < this.renderDebounceMs) {
      return false;
    }
    this.lastRenderTime = now;
    return true;
  }

  render(state: TUIState) {
    if (!this.shouldRender()) return;

    const lines: string[] = [];

    // Header
    const statusColor = state.isConnected ? chalk.green : chalk.red;
    const statusText = state.isConnected ? 'Connected' : 'Disconnected';
    lines.push(
      ` ${chalk.bold(`tadaima v${state.version}`)} — ${statusColor(
        `${statusText} to relay (${state.profileName})`
      )}`
    );

    // Separator
    lines.push(' ' + '─'.repeat(42));

    // Active downloads
    for (const dl of state.activeDownloads) {
      const sizeStr = this.formatBytes(dl.size).padStart(9);
      const titleTrunc = this.truncate(dl.title, 30);
      lines.push(
        ` ${chalk.cyan('↓')} ${titleTrunc.padEnd(30)} ${sizeStr}`
      );

      const bar = renderProgressBar(dl.progress, 30);
      const percent = `${dl.progress.toString().padStart(3)}%`;
      const speedStr = this.formatSpeed(dl.speedBps).padStart(10);
      const etaStr = this.formatEta(dl.eta).padStart(7);
      lines.push(`   ${bar}  ${percent}  ${speedStr}  ${etaStr}`);
      lines.push(''); // blank line between downloads
    }

    // Recently completed
    const recentCompleted = state.completedDownloads.slice(0, 3);
    for (const dl of recentCompleted) {
      const sizeStr = this.formatBytes(dl.size).padStart(9);
      const age = this.formatAge(Date.now() - dl.completedAt);
      const titleTrunc = this.truncate(dl.title, 35);
      lines.push(
        ` ${chalk.green('✓')} ${titleTrunc.padEnd(35)} ${sizeStr}  ${chalk.gray(
          `ただいま — completed ${age} ago`
        )}`
      );
    }

    // Separator
    lines.push(' ' + '─'.repeat(42));

    // Footer
    const activeCount = state.activeDownloads.length;
    lines.push(
      ` ${activeCount} active · ${state.diskFreeGb.toFixed(0)} GB free on ${
        state.mediaPath
      }`
    );

    // Clear screen and render
    process.stdout.write('\u001b[H\u001b[J'); // move to home, clear below
    process.stdout.write(lines.join('\n'));
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIdx = 0;
    while (size >= 1024 && unitIdx < units.length - 1) {
      size /= 1024;
      unitIdx++;
    }
    return `${size.toFixed(1)} ${units[unitIdx]}`;
  }

  private formatSpeed(bps: number): string {
    return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  }

  private formatEta(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  }

  private formatAge(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  private truncate(str: string, maxLen: number): string {
    const clean = stripAnsi(str);
    if (clean.length <= maxLen) return clean;
    return clean.slice(0, maxLen - 1) + '…';
  }
}
```

---

## 2. Daemon Mode

### 2.1 Daemon Start/Stop

**Command**: `tadaima start -d`

```bash
tadaima start -d
# Output: "Started tadaima agent. PID: 12345"
```

**Implementation**:
- Check if a process is already running (read PID file)
- If running, exit with error
- Otherwise, fork to background:
  1. Disable stdio redirection (daemon runs detached)
  2. Write PID to `~/.config/tadaima/tadaima.pid`
   3. Parent process exits immediately
   4. Child continues as daemon
- Daemon logs to `~/.config/tadaima/logs/tadaima.log` (rotating)

**Command**: `tadaima stop`

```bash
tadaima stop
# Output: "Stopping tadaima agent... done."
```

**Implementation**:
- Read PID file
- If not found, output "Not running"
- Send `SIGTERM` to process
- Wait up to 5 seconds for graceful shutdown
- If still running after 5s, send `SIGKILL`
- Delete PID file
- Exit with code 0 on success, 1 on failure

### 2.2 Graceful Shutdown (SIGTERM Handler)

When the daemon receives `SIGTERM`:

1. Close WebSocket connection gracefully (wait up to 2 seconds for final events)
2. Stop accepting new download requests
3. Flush all logs to disk
4. Close file handles
5. Exit with code 0

**Implementation**:

```typescript
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  try {
    await websocket.close();
    await logger.flush();
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', err);
    process.exit(1);
  }
});
```

### 2.3 PID File Management

**Location**: `~/.config/tadaima/tadaima.pid`

**Content**: Single line with the process ID (e.g., `12345\n`)

**Stale detection**: If PID file exists but the process doesn't (e.g., system crash), `tadaima start -d` or `tadaima status` detects this and cleans up.

```typescript
function readPidFile(): number | null {
  const pidFile = path.join(configDir(), 'tadaima.pid');
  if (!fs.existsSync(pidFile)) return null;
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
  if (isNaN(pid)) return null;
  // Check if process exists
  try {
    process.kill(pid, 0); // Signal 0: check existence
    return pid;
  } catch {
    fs.unlinkSync(pidFile); // Clean up stale file
    return null;
  }
}
```

---

## 3. System Service Installation

### 3.1 Windows Service

> **✅ RESOLVED**: Use `node-windows@~1.7.0` — more mature, better documented, handles registry setup automatically.

**Library**: `node-windows ~1.7.0`

**File**: `packages/agent/src/services/windows-service.ts`

**Installation** (`tadaima install-service`):

```typescript
import Service from 'node-windows';

export async function installWindowsService() {
  const agentExePath = process.execPath; // node.exe or bundled exe
  const scriptPath = path.join(__dirname, '../../dist/index.js');

  const svc = new Service({
    name: 'tadaima-agent',
    description: 'Tadaima download agent',
    script: scriptPath,
    env: {
      name: 'NODE_ENV',
      value: 'production',
    },
    execPath: agentExePath,
    params: 'start -d',
  });

  await new Promise<void>((resolve, reject) => {
    svc.on('install', () => {
      console.log('Service installed. Starting...');
      svc.start();
      resolve();
    });
    svc.on('error', reject);
    svc.install();
  });
}
```

**Uninstallation** (`tadaima uninstall-service`):

```typescript
export async function uninstallWindowsService() {
  const svc = new Service({
    name: 'tadaima-agent',
    script: process.argv[1],
  });

  await new Promise<void>((resolve, reject) => {
    svc.on('uninstall', () => {
      console.log('Service uninstalled.');
      resolve();
    });
    svc.on('error', reject);
    svc.stop(() => {
      svc.uninstall();
    });
  });
}
```

**Auto-start**:
- `node-windows` writes to the registry: `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\tadaima-agent`
- Service is set to `Start = 2` (auto-start)
- Runs as `LOCAL SYSTEM` by default (can be configured)

### 3.2 Linux (systemd)

**File**: `packages/agent/src/services/systemd-service.ts`

**Installation** (`tadaima install-service`):

1. Generate systemd unit file to `/etc/systemd/system/tadaima.service`
2. Run `systemctl daemon-reload`
3. Run `systemctl enable tadaima`
4. Run `systemctl start tadaima`

**Unit file template**:

```ini
[Unit]
Description=Tadaima Download Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=%USER%
WorkingDirectory=%HOME%
ExecStart=%NODE_PATH% %AGENT_SCRIPT% start -d
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Implementation**:

```typescript
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

export async function installSystemdService() {
  const user = os.userInfo().username;
  const homedir = os.homedir();
  const agentScript = path.join(__dirname, '../../dist/index.js');
  const nodePath = process.execPath;

  const unitContent = `[Unit]
Description=Tadaima Download Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${homedir}
ExecStart=${nodePath} ${agentScript} start -d
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`;

  // Requires sudo
  try {
    execSync(`sudo tee /etc/systemd/system/tadaima.service > /dev/null`, {
      input: unitContent,
    });
    execSync('sudo systemctl daemon-reload');
    execSync('sudo systemctl enable tadaima');
    execSync('sudo systemctl start tadaima');
    console.log('Service installed and started.');
  } catch (err) {
    console.error('Failed to install service:', err);
    throw err;
  }
}

export async function uninstallSystemdService() {
  try {
    execSync('sudo systemctl stop tadaima');
    execSync('sudo systemctl disable tadaima');
    execSync('sudo rm /etc/systemd/system/tadaima.service');
    execSync('sudo systemctl daemon-reload');
    console.log('Service uninstalled.');
  } catch (err) {
    console.error('Failed to uninstall service:', err);
    throw err;
  }
}
```

### 3.3 macOS (launchd)

**File**: `packages/agent/src/services/launchd-service.ts`

**Installation** (`tadaima install-service`):

1. Generate plist to `~/Library/LaunchAgents/com.tadaima.agent.plist`
2. Run `launchctl load ~/Library/LaunchAgents/com.tadaima.agent.plist`

**Plist template**:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tadaima.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>%NODE_PATH%</string>
    <string>%AGENT_SCRIPT%</string>
    <string>start</string>
    <string>-d</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>%HOME%/.config/tadaima/logs/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>%HOME%/.config/tadaima/logs/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
```

**Implementation**:

```typescript
import { execSync } from 'child_process';
import fs from 'fs';
import plist from 'plist';

export async function installLaunchdService() {
  const homedir = os.homedir();
  const agentScript = path.join(__dirname, '../../dist/index.js');
  const nodePath = process.execPath;
  const launchAgentsDir = path.join(homedir, 'Library/LaunchAgents');

  fs.mkdirSync(launchAgentsDir, { recursive: true });

  const plistObj = {
    Label: 'com.tadaima.agent',
    ProgramArguments: [nodePath, agentScript, 'start', '-d'],
    RunAtLoad: true,
    StandardOutPath: path.join(homedir, '.config/tadaima/logs/stdout.log'),
    StandardErrorPath: path.join(homedir, '.config/tadaima/logs/stderr.log'),
    EnvironmentVariables: {
      PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    },
  };

  const plistPath = path.join(launchAgentsDir, 'com.tadaima.agent.plist');
  fs.writeFileSync(plistPath, plist.build(plistObj));

  execSync(`launchctl load "${plistPath}"`);
  console.log('Service installed and started.');
}

export async function uninstallLaunchdService() {
  const homedir = os.homedir();
  const plistPath = path.join(homedir, 'Library/LaunchAgents/com.tadaima.agent.plist');

  if (fs.existsSync(plistPath)) {
    execSync(`launchctl unload "${plistPath}"`);
    fs.unlinkSync(plistPath);
    console.log('Service uninstalled.');
  }
}
```

### 3.4 Service Start/Stop

**Commands**:

```bash
tadaima install-service   # Platform-specific installation
tadaima uninstall-service # Platform-specific removal
```

**Implementation**: Detect OS at runtime:

```typescript
export async function installService() {
  const platform = process.platform;
  if (platform === 'win32') {
    await installWindowsService();
  } else if (platform === 'linux') {
    await installSystemdService();
  } else if (platform === 'darwin') {
    await installLaunchdService();
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}
```

---

## 4. Windows System Tray App

> **✅ RESOLVED**: Use `systray2` (lightweight, <5 MB, pure Node.js) for the system tray app. No Chromium dependency. Includes native Windows toast notifications. If `systray2` proves too limited for the tray app's needs, fall back to Electron tray-only mode in Phase 10.

### 4.1 Technology: systray2

**Dependencies**:
- `systray2 ~0.18.0` — lightweight tray icon + menu
- `@microdel/native-notifier ~0.2.0` — Windows native toasts (optional, fallback to `node-notifier`)
- Or fallback: `node-notifier ~10.0.0` (cross-platform)

### 4.2 Tray App States

**Icon states** (visual feedback):

| State | Icon | Meaning |
|-------|------|---------|
| Connected, idle | Green dot | Connected to relay, no downloads |
| Connected, active | Animated arrow | Downloads in progress |
| Disconnected | Red dot | Cannot reach relay |
| Updating | Spinner | Software update in progress |

**Implementation approach**:
- Base icon: static filled circle
- Overlay: green, red, or animated
- Use Unicode symbols or simple PNG overlays (16×16 px)

### 4.3 Right-Click Menu

```
┌─────────────────────────────────────────────┐
│ Status: Connected (Noah) · 2 active         │
│ ─────────────────────────────────────────── │
│ Open Tadaima                                │
│ Start Agent / Stop Agent                    │
│ Settings                                    │
│ Logs                                        │
│ Check for Updates                           │
│ Quit                                        │
└─────────────────────────────────────────────┘
```

**Menu items**:

| Item | Action | Behavior |
|------|--------|----------|
| **Status** | Read-only | Shows "Connected to relay (Profile) · N active downloads" or "Disconnected" |
| **Open Tadaima** | Click | Open relay web app in default browser (read URL from config) |
| **Start Agent** / **Stop Agent** | Toggle | Starts/stops the background service via daemon commands |
| **Settings** | Click | Opens a native settings window (see 4.4) |
| **Logs** | Click | Opens log file in default text editor (notepad on Windows) |
| **Check for Updates** | Click | Manually trigger update check (fetch latest version from GitHub) |
| **Quit** | Click | Stop agent + close tray app |

### 4.4 Settings Window

**Technology**: Simple HTML settings page rendered in the system default browser (localhost URL served by the agent).

**Settings panel**:

```
┌──────────────────────────────────────────┐
│                Settings                  │
├──────────────────────────────────────────┤
│ Relay URL:  [http://localhost:3000    ]  │
│ Media Path: [/mnt/media                 ] │
│ Max Concurrent: [3                      ] │
│ Auto-start:  [✓]                         │
│                                          │
│                         [ Save ] [ Cancel ]│
└──────────────────────────────────────────┘
```

**Implementation**:
- Read config via `tadaima config get <key>`
- Display in HTML form
- On save, write via `tadaima config set <key> <value>`
- Restart agent if critical settings change (relay URL, media path)

### 4.5 Windows Toast Notifications

When a download completes, show a native Windows toast:

```
┌─────────────────────────────────────────┐
│ 🎬 ただいま                              │
│ Interstellar (2014) has arrived          │
│                                          │
│  [View]  [Dismiss]                       │
└─────────────────────────────────────────┘
```

**Implementation**:

```typescript
import { notify } from 'node-notifier'; // or @microdel/native-notifier

function showCompletedNotification(title: string, size: string) {
  notify({
    title: 'ただいま',
    message: `${title} has arrived`,
    subtitle: `${size}`,
    sound: true, // play notification sound
    wait: true,  // wait for user interaction
  });
}
```

### 4.6 Auto-Start on Login

**Windows method**:
- Write registry key: `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run\tadaima-tray`
- Value: Path to tray app executable

**Implementation** (when tray app starts):

```typescript
import Registry from 'winreg';

async function enableAutoStart() {
  const regKey = new Registry({
    hive: Registry.HKCU,
    key: '\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  });

  const appPath = process.execPath; // tray app exe

  await new Promise<void>((resolve, reject) => {
    regKey.set('tadaima-tray', Registry.REG_SZ, appPath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
```

### 4.7 Tray App Implementation

**File**: `packages/agent/src/tray/index.ts` (or separate `packages/tray/`)

```typescript
import SysTray from 'systray2';
import { exec } from 'child_process';

interface MenuItem {
  label: string;
  enabled: boolean;
  checked: boolean;
}

const tray = new SysTray({
  menu: {
    icon: getIconPath(), // icon.png as base64
    isTemplateIcon: false,
    title: 'Tadaima',
    tooltip: 'Tadaima Agent',
    items: [
      {
        label: 'Status: Disconnected',
        enabled: false,
        checked: false,
      },
      {
        label: '',
        enabled: false,
        checked: false,
      },
      {
        label: 'Open Tadaima',
        enabled: true,
        checked: false,
      },
      {
        label: 'Start Agent',
        enabled: true,
        checked: false,
      },
      {
        label: 'Settings',
        enabled: true,
        checked: false,
      },
      {
        label: 'Logs',
        enabled: true,
        checked: false,
      },
      {
        label: 'Check for Updates',
        enabled: true,
        checked: false,
      },
      {
        label: 'Quit',
        enabled: true,
        checked: false,
      },
    ],
  },
  debug: false,
  copyDir: true, // copy native libs to temp
});

tray.onClick((action) => {
  if (action.seq_type === 'double') {
    // double click on tray icon
    openWebUI();
  }
});

tray.onReady(() => {
  console.log('Tray ready');
  updateStatus();
  // Poll status every 2 seconds
  setInterval(updateStatus, 2000);
});

async function handleMenuClick(index: number) {
  switch (index) {
    case 2: // Open Tadaima
      openWebUI();
      break;
    case 3: // Start/Stop Agent
      toggleAgent();
      break;
    case 4: // Settings
      openSettings();
      break;
    case 5: // Logs
      openLogs();
      break;
    case 6: // Check for Updates
      checkUpdates();
      break;
    case 7: // Quit
      await stopAgent();
      tray.kill(false);
      process.exit(0);
      break;
  }
}

async function updateStatus() {
  try {
    const status = await exec('tadaima status', { encoding: 'utf-8' });
    // Parse output, update menu item 0
    tray.setTemplate({
      ...tray.menu,
      items: [
        { label: `Status: ${status}`, enabled: false, checked: false },
        ...tray.menu.items.slice(1),
      ],
    });
  } catch (err) {
    tray.setTemplate({
      ...tray.menu,
      items: [
        { label: 'Status: Disconnected', enabled: false, checked: false },
        ...tray.menu.items.slice(1),
      ],
    });
  }
}

function openWebUI() {
  const { exec } = require('child_process');
  const config = readConfig();
  const url = config.relayUrl || 'http://localhost:3000';
  exec(`start ${url}`, { shell: true, windowsHide: true });
}

function openSettings() {
  // Open settings page in system browser (served by agent on localhost)
  // Fallback: open config file in notepad
  const { exec } = require('child_process');
  const configPath = path.join(os.homedir(), '.config/tadaima/config.json');
  exec(`notepad "${configPath}"`, { windowsHide: true });
}

function openLogs() {
  const { exec } = require('child_process');
  const logPath = path.join(os.homedir(), '.config/tadaima/logs/tadaima.log');
  exec(`notepad "${logPath}"`, { windowsHide: true });
}

async function toggleAgent() {
  const isRunning = await checkRunning();
  if (isRunning) {
    await stopAgent();
  } else {
    await startAgent();
  }
}

async function startAgent() {
  exec('tadaima start -d', { windowsHide: true });
}

async function stopAgent() {
  exec('tadaima stop', { windowsHide: true });
}

async function checkRunning(): Promise<boolean> {
  const pidFile = path.join(os.homedir(), '.config/tadaima/tadaima.pid');
  if (!fs.existsSync(pidFile)) return false;
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'));
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkUpdates() {
  // Fetch latest version from GitHub, compare with package.json
  // If newer, show dialog to download
  console.log('Checking for updates...');
}

tray.ready();
```

### 4.8 Icon Assets

**Files**:
- `packages/agent/src/tray/icon-base.png` (16×16 px, transparent background, outline circle)
- `packages/agent/src/tray/icon-green.png` (green filled circle)
- `packages/agent/src/tray/icon-red.png` (red filled circle)
- `packages/agent/src/tray/icon-animated.gif` (spinning arrow, 3 frames)

**Implementation**: Convert PNG to base64 at startup:

```typescript
function getIconPath(): string {
  const basePath = process.env.NODE_ENV === 'production'
    ? path.join(process.resourcesPath, 'tray')
    : path.join(__dirname, 'tray');
  const iconFile = path.join(basePath, 'icon-base.png');
  const data = fs.readFileSync(iconFile);
  return `data:image/png;base64,${data.toString('base64')}`;
}
```

---

## 5. Configuration CLI

### 5.1 Config Structure

**Location**: `~/.config/tadaima/config.json`

**Schema** (JSON with dot notation support):

```json
{
  "relayUrl": "http://localhost:3000",
  "profileId": "uuid-...",
  "deviceToken": "token-...",
  "directories": {
    "movies": "/mnt/media/Movies",
    "tv": "/mnt/media/TV"
  },
  "downloader": {
    "maxConcurrent": 3,
    "rdApiKey": "***REDACTED***"
  },
  "logging": {
    "level": "info",
    "format": "json"
  }
}
```

### 5.2 Commands

**Get a value**:

```bash
tadaima config get directories.movies
# Output: /mnt/media/Movies

tadaima config get downloader.rdApiKey
# Output: ***REDACTED***
```

**Set a value**:

```bash
tadaima config set directories.movies /new/path
# Output: Updated directories.movies

tadaima config set downloader.maxConcurrent 5
# Output: Updated downloader.maxConcurrent
```

**List all**:

```bash
tadaima config list
# Output:
# relayUrl: http://localhost:3000
# profileId: uuid-...
# deviceToken: ***REDACTED***
# directories.movies: /mnt/media/Movies
# directories.tv: /mnt/media/TV
# downloader.maxConcurrent: 3
# downloader.rdApiKey: ***REDACTED***
# logging.level: info
# logging.format: json
```

### 5.3 Implementation

**File**: `packages/agent/src/cli/config-command.ts`

```typescript
import { program } from 'commander';
import { getConfig, setConfig, listConfig, redactSensitive } from '../config';

program
  .command('config <subcommand>')
  .description('Manage agent configuration')
  .action(async (subcommand) => {
    // Parse: "get key", "set key value", "list"
  });

program
  .command('config get <key>')
  .description('Get a config value')
  .action(async (key: string) => {
    const value = getConfig(key);
    if (value === undefined) {
      console.error(`Config key not found: ${key}`);
      process.exit(1);
    }
    const redacted = redactSensitive(key, value);
    console.log(redacted);
  });

program
  .command('config set <key> <value>')
  .description('Set a config value')
  .action(async (key: string, value: string) => {
    setConfig(key, value);
    console.log(`Updated ${key}`);
  });

program
  .command('config list')
  .description('List all config values')
  .action(async () => {
    const all = listConfig();
    for (const [key, value] of Object.entries(all)) {
      const redacted = redactSensitive(key, value);
      console.log(`${key}: ${redacted}`);
    }
  });
```

**Sensitive keys** (redacted in output):
- `deviceToken`
- `rdApiKey`
- `password`
- Any key containing `secret` or `key`

**Implementation**:

```typescript
function redactSensitive(key: string, value: any): string {
  const sensitivePatterns = [
    'token',
    'key',
    'secret',
    'password',
    'api',
  ];
  const isSensitive = sensitivePatterns.some((pattern) =>
    key.toLowerCase().includes(pattern)
  );
  if (isSensitive) {
    return '***REDACTED***';
  }
  return String(value);
}
```

---

## 6. Log Viewer

### 6.1 Log File Setup

**Location**: `~/.config/tadaima/logs/tadaima.log`

**Format**: JSON lines (one JSON object per line) for machine parsing, with a human-readable fallback:

```json
{"timestamp":"2024-04-04T12:34:56Z","level":"info","message":"Connected to relay","context":{}}
{"timestamp":"2024-04-04T12:34:57Z","level":"info","message":"Starting download: Interstellar","context":{"jobId":"job-123"}}
```

**Rotation**:
- Max file size: 10 MB
- Keep 5 files: `tadaima.log`, `tadaima.log.1`, `tadaima.log.2`, ..., `tadaima.log.4`
- When current file hits 10 MB, rotate: `tadaima.log` → `tadaima.log.1`, etc.
- Oldest file (`tadaima.log.4`) is deleted

**Library**: `pino ~8.0.0` with `pino-roll` for rotation

### 6.2 Commands

**Tail (default)**:

```bash
tadaima logs
# Output: Last 50 lines
```

**Follow (live tail)**:

```bash
tadaima logs -f
# Output: Live tail, Ctrl+C to exit
```

**Last N lines**:

```bash
tadaima logs -n 100
# Output: Last 100 lines
```

### 6.3 Implementation

**File**: `packages/agent/src/cli/logs-command.ts`

```typescript
import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { readline } from 'readline';

program
  .command('logs')
  .description('View agent logs')
  .option('-f, --follow', 'Follow log output (live tail)')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .action(async (options) => {
    const logPath = path.join(
      process.env.HOME,
      '.config/tadaima/logs/tadaima.log'
    );

    if (!fs.existsSync(logPath)) {
      console.error('Log file not found');
      process.exit(1);
    }

    if (options.follow) {
      await followLogs(logPath);
    } else {
      await tailLogs(logPath, parseInt(options.lines));
    }
  });

async function tailLogs(filePath: string, lines: number) {
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const buffer: string[] = [];
  for await (const line of rl) {
    buffer.push(line);
    if (buffer.length > lines) {
      buffer.shift();
    }
  }

  buffer.forEach((line) => {
    try {
      const parsed = JSON.parse(line);
      console.log(
        `[${parsed.timestamp}] ${parsed.level.toUpperCase()}: ${parsed.message}`
      );
    } catch {
      console.log(line); // raw line if not JSON
    }
  });
}

async function followLogs(filePath: string) {
  const fileStream = createReadStream(filePath, { start: getFileSize(filePath) });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const parsed = JSON.parse(line);
      console.log(
        `[${parsed.timestamp}] ${parsed.level.toUpperCase()}: ${parsed.message}`
      );
    } catch {
      console.log(line);
    }
  }

  // Re-watch for new appends
  fs.watchFile(filePath, () => {
    // Restart read from end
  });
}

function getFileSize(filePath: string): number {
  return fs.statSync(filePath).size;
}
```

---

## 7. CLI Command Summary & Implementation

### 7.1 Main CLI Entry Point

**File**: `packages/agent/src/cli/index.ts`

Uses `commander.js ~13.0.0` for structured argument parsing.

```typescript
import { program } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.url, '../../package.json'), 'utf-8')
);

program.name('tadaima').version(packageJson.version);

// Import subcommands
import './setup-command';
import './start-command';
import './stop-command';
import './status-command';
import './config-command';
import './logs-command';
import './install-service-command';
import './version-command';

program.parse(process.argv);
```

### 7.2 All Commands

| Command | File | Behavior |
|---------|------|----------|
| `tadaima setup` | `setup-command.ts` | Interactive first-time setup (relay URL, profile, device token) |
| `tadaima start` | `start-command.ts` | Start agent in foreground with TUI |
| `tadaima start -d` | `start-command.ts` | Fork to daemon, write PID file |
| `tadaima stop` | `stop-command.ts` | Send SIGTERM to daemon, clean up PID file |
| `tadaima status` | `status-command.ts` | Show connection + active downloads |
| `tadaima config get <key>` | `config-command.ts` | Read config value (redact sensitive) |
| `tadaima config set <key> <value>` | `config-command.ts` | Write config value |
| `tadaima config list` | `config-command.ts` | List all config (redact sensitive) |
| `tadaima logs` | `logs-command.ts` | Tail last 50 log lines |
| `tadaima logs -f` | `logs-command.ts` | Follow logs (live tail) |
| `tadaima logs -n <N>` | `logs-command.ts` | Last N lines |
| `tadaima install-service` | `install-service-command.ts` | Install as Windows Service / systemd / launchd |
| `tadaima uninstall-service` | `install-service-command.ts` | Remove service |
| `tadaima version` | `version-command.ts` | Show version info |

### 7.3 Start Command Details

**File**: `packages/agent/src/cli/start-command.ts`

```typescript
import { program } from 'commander';
import { fork } from 'child_process';
import fs from 'fs';
import path from 'path';

const configDir = () => path.join(process.env.HOME, '.config/tadaima');
const pidFile = () => path.join(configDir(), 'tadaima.pid');

program
  .command('start')
  .description('Start agent (foreground or daemon)')
  .option('-d, --daemon', 'Run as background daemon')
  .action(async (options) => {
    if (options.daemon) {
      await startDaemon();
    } else {
      await startForeground();
    }
  });

async function startForeground() {
  // Initialize config
  // Connect to relay
  // Start TUI renderer
  // Load agent state
  // Set up SIGINT handler
}

async function startDaemon() {
  // Check if already running
  const existingPid = readPidFile();
  if (existingPid && processExists(existingPid)) {
    console.error('Agent is already running (PID: ' + existingPid + ')');
    process.exit(1);
  }

  // Fork to background
  const child = fork(process.argv[1], ['start'], {
    detached: true,
    stdio: 'ignore',
  });

  // Write PID file
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(pidFile(), child.pid.toString());

  console.log(`Started tadaima agent. PID: ${child.pid}`);
  child.unref();
  process.exit(0);
}
```

### 7.4 Status Command Details

**File**: `packages/agent/src/cli/status-command.ts`

```typescript
import { program } from 'commander';

program
  .command('status')
  .description('Show agent status')
  .action(async () => {
    const isRunning = await checkDaemonRunning();
    if (!isRunning) {
      console.log('Agent is not running');
      process.exit(1);
    }

    // Connect to agent via IPC or HTTP endpoint
    // Request current state: connected?, profile, active downloads
    const status = await getAgentStatus();
    console.log(`Connected to relay (${status.profile})`);
    console.log(`Active downloads: ${status.activeCount}`);
    for (const dl of status.activeDownloads) {
      console.log(`  - ${dl.title} (${dl.progress}%)`);
    }
  });
```

### 7.5 Version Command Details

**File**: `packages/agent/src/cli/version-command.ts`

```typescript
import { program } from 'commander';
import { readFileSync } from 'fs';

program
  .command('version')
  .description('Show version and build info')
  .action(() => {
    const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
    console.log(`tadaima v${pkg.version}`);
    console.log(`Node: ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
  });
```

---

## 8. New Dependencies

### 8.1 packages/agent package.json

```jsonc
{
  "name": "@tadaima/agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc --build",
    "dev": "tsx watch src/index.ts",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tadaima/shared": "workspace:*",
    "ws": "~8.18.0",
    "commander": "~13.0.0",
    "conf": "~13.0.0",
    "pino": "~8.18.0",
    "pino-roll": "~1.0.0",
    "chalk": "~5.4.0",
    "strip-ansi": "~7.1.0",
    "systray2": "~0.18.0",
    "node-windows": "~1.7.0",
    "winreg": "~1.2.4",
    "plist": "~3.1.0"
  },
  "devDependencies": {
    "@types/node": "~22.0.0",
    "typescript": "~5.8.0",
    "tsx": "~4.19.0",
    "vitest": "~4.1.0"
  }
}
```

**Exact versions to pin**:
- `commander ~13.0.0` — CLI framework
- `conf ~13.0.0` — config file management (JSON)
- `pino ~8.18.0` — structured logging
- `pino-roll ~1.0.0` — log rotation
- `chalk ~5.4.0` — terminal colors (already used in relay/web)
- `strip-ansi ~7.1.0` — remove ANSI codes from strings
- `systray2 ~0.18.0` — lightweight tray app (Windows/macOS/Linux)
- `node-windows ~1.7.0` — Windows Service integration
- `winreg ~1.2.4` — Windows registry access
- `plist ~3.1.0` — macOS plist generation

---

## 9. File Structure

All new files for Phase 8:

```
packages/agent/
├── src/
│   ├── cli/
│   │   ├── index.ts                        # Main CLI entry point (commander setup)
│   │   ├── setup-command.ts                # Interactive setup wizard
│   │   ├── start-command.ts                # Start foreground / daemon
│   │   ├── stop-command.ts                 # Stop daemon
│   │   ├── status-command.ts               # Show status
│   │   ├── config-command.ts               # Get / set / list config
│   │   ├── logs-command.ts                 # Tail / follow logs
│   │   ├── install-service-command.ts      # Install system service
│   │   └── version-command.ts              # Show version info
│   ├── ui/
│   │   └── tui-renderer.ts                 # TUI rendering (ANSI escape codes)
│   ├── services/
│   │   ├── windows-service.ts              # Windows Service registration
│   │   ├── systemd-service.ts              # Linux systemd unit file
│   │   └── launchd-service.ts              # macOS launchd plist
│   ├── tray/
│   │   ├── index.ts                        # Tray app (systray2)
│   │   ├── icon-base.png                   # 16x16 base icon
│   │   ├── icon-green.png                  # 16x16 green overlay
│   │   ├── icon-red.png                    # 16x16 red overlay
│   │   └── icon-animated.gif               # 16x16 spinning arrow
│   ├── config/
│   │   └── index.ts                        # Config file handling
│   ├── logging/
│   │   └── index.ts                        # Pino logger setup with rotation
│   ├── daemon/
│   │   └── index.ts                        # Daemon utilities (PID, fork, signals)
│   └── index.ts                            # Main entry point (parse CLI args)
```

---

## 10. Complete File Contents

### 10.1 packages/agent/src/cli/index.ts

```typescript
import { program } from 'commander';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
);

program.name('tadaima').version(packageJson.version);

// Subcommands are registered in their respective files
// They use: program.command('name').description('...').action(...)

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
```

### 10.2 packages/agent/src/cli/start-command.ts

```typescript
import { program } from 'commander';
import { fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createAgent } from '../agent/index.js';
import { TUIRenderer } from '../ui/tui-renderer.js';
import { getLogger } from '../logging/index.js';

const configDir = () => path.join(os.homedir(), '.config/tadaima');
const pidFile = () => path.join(configDir(), 'tadaima.pid');

function readPidFile(): number | null {
  try {
    const pidPath = pidFile();
    if (!fs.existsSync(pidPath)) return null;
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim());
    if (isNaN(pid)) return null;
    // Verify process exists
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writePidFile(pid: number) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(pidFile(), pid.toString());
}

function deletePidFile() {
  const pidPath = pidFile();
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
}

program
  .command('start')
  .description('Start agent (foreground or daemon)')
  .option('-d, --daemon', 'Run as background daemon')
  .action(async (options) => {
    if (options.daemon) {
      await startDaemon();
    } else {
      await startForeground();
    }
  });

async function startForeground() {
  const logger = getLogger();
  const agent = createAgent();
  const tui = new TUIRenderer();

  await tui.initialize();

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await tui.cleanup();
    await agent.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await tui.cleanup();
    await agent.close();
    process.exit(0);
  });

  await agent.start();

  // Update TUI every 100ms
  setInterval(() => {
    const state = agent.getTUIState();
    tui.render(state);
  }, 100);
}

async function startDaemon() {
  const logger = getLogger();

  // Check if already running
  const existingPid = readPidFile();
  if (existingPid && processExists(existingPid)) {
    console.error(`Agent is already running (PID: ${existingPid})`);
    process.exit(1);
  }

  // Clean up stale PID file if it exists
  deletePidFile();

  // Fork to background
  const child = fork(process.argv[1], ['start'], {
    detached: true,
    stdio: 'ignore',
  });

  writePidFile(child.pid!);
  logger.info(`Started tadaima agent. PID: ${child.pid}`);
  console.log(`Started tadaima agent. PID: ${child.pid}`);

  child.unref();
  process.exit(0);
}
```

### 10.3 packages/agent/src/cli/stop-command.ts

```typescript
import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getLogger } from '../logging/index.js';

const configDir = () => path.join(os.homedir(), '.config/tadaima');
const pidFile = () => path.join(configDir(), 'tadaima.pid');

function readPidFile(): number | null {
  try {
    const pidPath = pidFile();
    if (!fs.existsSync(pidPath)) return null;
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim());
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function deletePidFile() {
  const pidPath = pidFile();
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
}

program
  .command('stop')
  .description('Stop background daemon')
  .action(async () => {
    const logger = getLogger();
    const pid = readPidFile();

    if (!pid || !processExists(pid)) {
      console.log('Agent is not running');
      process.exit(0);
    }

    console.log('Stopping tadaima agent...');
    logger.info(`Stopping agent (PID: ${pid})`);

    // Send SIGTERM
    process.kill(pid, 'SIGTERM');

    // Wait up to 5 seconds for graceful shutdown
    let waited = 0;
    while (waited < 5000) {
      if (!processExists(pid)) {
        deletePidFile();
        console.log('Agent stopped.');
        process.exit(0);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      waited += 100;
    }

    // Force kill
    console.log('Forcing shutdown...');
    process.kill(pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 500));

    deletePidFile();
    console.log('Agent stopped.');
    process.exit(0);
  });
```

### 10.4 packages/agent/src/cli/status-command.ts

```typescript
import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getConfig } from '../config/index.js';

const configDir = () => path.join(os.homedir(), '.config/tadaima');
const pidFile = () => path.join(configDir(), 'tadaima.pid');

function readPidFile(): number | null {
  try {
    const pidPath = pidFile();
    if (!fs.existsSync(pidPath)) return null;
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim());
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

program
  .command('status')
  .description('Show agent status')
  .action(async () => {
    const pid = readPidFile();

    if (!pid || !processExists(pid)) {
      console.log('Agent is not running');
      process.exit(1);
    }

    // TODO: Connect to agent via IPC or HTTP to get detailed state
    // For now, just report running status
    const profileId = getConfig('profileId');
    console.log(`Agent is running (PID: ${pid})`);
    console.log(`Profile: ${profileId || 'not configured'}`);
    process.exit(0);
  });
```

### 10.5 packages/agent/src/cli/config-command.ts

```typescript
import { program } from 'commander';
import {
  getConfig,
  setConfig,
  listConfig,
  redactSensitive,
} from '../config/index.js';

program
  .command('config get <key>')
  .description('Get a config value')
  .action((key: string) => {
    try {
      const value = getConfig(key);
      if (value === undefined) {
        console.error(`Config key not found: ${key}`);
        process.exit(1);
      }
      const redacted = redactSensitive(key, value);
      console.log(redacted);
      process.exit(0);
    } catch (err) {
      console.error('Error reading config:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('config set <key> <value>')
  .description('Set a config value')
  .action((key: string, value: string) => {
    try {
      setConfig(key, value);
      console.log(`Updated ${key}`);
      process.exit(0);
    } catch (err) {
      console.error('Error writing config:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('config list')
  .description('List all config values')
  .action(() => {
    try {
      const all = listConfig();
      for (const [key, value] of Object.entries(all)) {
        const redacted = redactSensitive(key, value);
        console.log(`${key}: ${redacted}`);
      }
      process.exit(0);
    } catch (err) {
      console.error('Error reading config:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
```

### 10.6 packages/agent/src/cli/logs-command.ts

```typescript
import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createReadStream } from 'fs';
import readline from 'readline';

const configDir = () => path.join(os.homedir(), '.config/tadaima');
const logsDir = () => path.join(configDir(), 'logs');
const logFile = () => path.join(logsDir(), 'tadaima.log');

function formatLogLine(line: string): string {
  try {
    const parsed = JSON.parse(line);
    return `[${parsed.timestamp}] ${parsed.level.toUpperCase()}: ${parsed.message}`;
  } catch {
    return line;
  }
}

program
  .command('logs')
  .description('View agent logs')
  .option('-f, --follow', 'Follow log output (live tail)')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .action(async (options) => {
    const logPath = logFile();

    if (!fs.existsSync(logPath)) {
      console.error('Log file not found');
      process.exit(1);
    }

    if (options.follow) {
      await followLogs(logPath);
    } else {
      await tailLogs(logPath, parseInt(options.lines));
    }
  });

async function tailLogs(filePath: string, lines: number) {
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const buffer: string[] = [];
  for await (const line of rl) {
    buffer.push(line);
    if (buffer.length > lines) {
      buffer.shift();
    }
  }

  buffer.forEach((line) => {
    console.log(formatLogLine(line));
  });

  process.exit(0);
}

async function followLogs(filePath: string) {
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    console.log(formatLogLine(line));
  }

  // Watch for new content
  const watcher = fs.watch(filePath, async () => {
    const newStream = createReadStream(filePath, { start: fs.statSync(filePath).size });
    const newRl = readline.createInterface({
      input: newStream,
      crlfDelay: Infinity,
    });

    for await (const line of newRl) {
      console.log(formatLogLine(line));
    }
  });

  // Graceful shutdown on Ctrl+C
  process.on('SIGINT', () => {
    watcher.close();
    process.exit(0);
  });
}
```

### 10.7 packages/agent/src/cli/install-service-command.ts

```typescript
import { program } from 'commander';
import { installService, uninstallService } from '../services/index.js';
import { getLogger } from '../logging/index.js';

const logger = getLogger();

program
  .command('install-service')
  .description('Install agent as a system service')
  .action(async () => {
    try {
      await installService();
      console.log('Service installed successfully.');
      process.exit(0);
    } catch (err) {
      logger.error('Failed to install service', err);
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('uninstall-service')
  .description('Uninstall system service')
  .action(async () => {
    try {
      await uninstallService();
      console.log('Service uninstalled successfully.');
      process.exit(0);
    } catch (err) {
      logger.error('Failed to uninstall service', err);
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
```

### 10.8 packages/agent/src/cli/version-command.ts

```typescript
import { program } from 'commander';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

program
  .command('version')
  .description('Show version and build information')
  .action(() => {
    try {
      const pkg = JSON.parse(
        readFileSync(join(__dirname, '../../package.json'), 'utf-8')
      );
      console.log(`tadaima v${pkg.version}`);
      console.log(`Node: ${process.version}`);
      console.log(`Platform: ${process.platform} ${process.arch}`);
      process.exit(0);
    } catch (err) {
      console.error('Error reading version:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
```

### 10.9 packages/agent/src/ui/tui-renderer.ts

(Already provided above in section 1.5 — include full implementation)

### 10.10 packages/agent/src/config/index.ts

```typescript
import Conf from 'conf';
import path from 'path';
import os from 'os';

const configDir = path.join(os.homedir(), '.config/tadaima');

const conf = new Conf({
  cwd: configDir,
  configName: 'config',
  defaults: {
    relayUrl: 'http://localhost:3000',
    profileId: undefined,
    deviceToken: undefined,
    directories: {
      movies: path.join(os.homedir(), 'Downloads/Movies'),
      tv: path.join(os.homedir(), 'Downloads/TV'),
    },
    downloader: {
      maxConcurrent: 3,
      rdApiKey: undefined,
    },
    logging: {
      level: 'info',
      format: 'json',
    },
  },
});

export function getConfig(key: string): any {
  return conf.get(key);
}

export function setConfig(key: string, value: any) {
  conf.set(key, value);
}

export function listConfig(): Record<string, any> {
  const all = conf.store as Record<string, any>;
  const flattened: Record<string, any> = {};

  function flatten(obj: any, prefix: string = '') {
    for (const [key, val] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        flatten(val, fullKey);
      } else {
        flattened[fullKey] = val;
      }
    }
  }

  flatten(all);
  return flattened;
}

export function redactSensitive(key: string, value: any): string {
  const sensitivePatterns = ['token', 'key', 'secret', 'password', 'api'];
  const isSensitive = sensitivePatterns.some((pattern) =>
    key.toLowerCase().includes(pattern)
  );
  if (isSensitive) {
    return '***REDACTED***';
  }
  return String(value);
}
```

### 10.11 packages/agent/src/logging/index.ts

```typescript
import pino from 'pino';
import { roll } from 'pino-roll';
import fs from 'fs';
import path from 'path';
import os from 'os';

const configDir = path.join(os.homedir(), '.config/tadaima');
const logsDir = path.join(configDir, 'logs');

// Ensure logs directory exists
fs.mkdirSync(logsDir, { recursive: true });

const transport = pino.transport({
  target: 'pino-roll',
  options: {
    file: path.join(logsDir, 'tadaima.log'),
    frequency: 'daily',
    size: '10M', // 10MB per file
    limit: { count: 5 }, // keep 5 files
  },
});

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport
);

export function getLogger() {
  return logger;
}

export async function flushLogs() {
  await new Promise((resolve) => {
    logger.flush(() => resolve(undefined));
  });
}
```

### 10.12 packages/agent/src/services/index.ts

```typescript
import { installService as installWindows, uninstallService as uninstallWindows } from './windows-service.js';
import { installService as installSystemd, uninstallService as uninstallSystemd } from './systemd-service.js';
import { installService as installLaunchd, uninstallService as uninstallLaunchd } from './launchd-service.js';

export async function installService() {
  const platform = process.platform;
  if (platform === 'win32') {
    return await installWindows();
  } else if (platform === 'linux') {
    return await installSystemd();
  } else if (platform === 'darwin') {
    return await installLaunchd();
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}

export async function uninstallService() {
  const platform = process.platform;
  if (platform === 'win32') {
    return await uninstallWindows();
  } else if (platform === 'linux') {
    return await uninstallSystemd();
  } else if (platform === 'darwin') {
    return await uninstallLaunchd();
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}
```

### 10.13 packages/agent/src/services/windows-service.ts

```typescript
import Service from 'node-windows';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function installService() {
  const agentExePath = process.execPath;
  const scriptPath = path.join(__dirname, '../../dist/index.js');

  const svc = new Service({
    name: 'tadaima-agent',
    description: 'Tadaima Download Agent',
    script: scriptPath,
    execPath: agentExePath,
    params: 'start -d',
    env: {
      name: 'NODE_ENV',
      value: 'production',
    },
  });

  return new Promise<void>((resolve, reject) => {
    svc.on('install', () => {
      console.log('Service installed. Starting...');
      svc.start();
      resolve();
    });
    svc.on('error', (err) => reject(err));
    svc.install();
  });
}

export async function uninstallService() {
  const svc = new Service({
    name: 'tadaima-agent',
    script: process.argv[1],
  });

  return new Promise<void>((resolve, reject) => {
    svc.on('uninstall', () => {
      console.log('Service uninstalled.');
      resolve();
    });
    svc.on('error', (err) => reject(err));

    svc.stop(() => {
      svc.uninstall();
    });
  });
}
```

### 10.14 packages/agent/src/services/systemd-service.ts

```typescript
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function installService() {
  const user = os.userInfo().username;
  const homedir = os.homedir();
  const agentScript = path.join(
    process.cwd(),
    'packages/agent/dist/index.js'
  );
  const nodePath = process.execPath;

  const unitContent = `[Unit]
Description=Tadaima Download Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${homedir}
ExecStart=${nodePath} ${agentScript} start -d
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`;

  try {
    execSync(`sudo tee /etc/systemd/system/tadaima.service > /dev/null`, {
      input: unitContent,
    });
    execSync('sudo systemctl daemon-reload');
    execSync('sudo systemctl enable tadaima');
    execSync('sudo systemctl start tadaima');
    console.log('Service installed and started.');
  } catch (err) {
    console.error('Failed to install service:', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function uninstallService() {
  try {
    execSync('sudo systemctl stop tadaima');
    execSync('sudo systemctl disable tadaima');
    execSync('sudo rm /etc/systemd/system/tadaima.service');
    execSync('sudo systemctl daemon-reload');
    console.log('Service uninstalled.');
  } catch (err) {
    console.error('Failed to uninstall service:', err instanceof Error ? err.message : String(err));
    throw err;
  }
}
```

### 10.15 packages/agent/src/services/launchd-service.ts

```typescript
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import plist from 'plist';

export async function installService() {
  const homedir = os.homedir();
  const agentScript = path.join(
    process.cwd(),
    'packages/agent/dist/index.js'
  );
  const nodePath = process.execPath;
  const launchAgentsDir = path.join(homedir, 'Library/LaunchAgents');

  fs.mkdirSync(launchAgentsDir, { recursive: true });

  const plistObj = {
    Label: 'com.tadaima.agent',
    ProgramArguments: [nodePath, agentScript, 'start', '-d'],
    RunAtLoad: true,
    StandardOutPath: path.join(homedir, '.config/tadaima/logs/stdout.log'),
    StandardErrorPath: path.join(homedir, '.config/tadaima/logs/stderr.log'),
    EnvironmentVariables: {
      PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    },
  };

  const plistPath = path.join(launchAgentsDir, 'com.tadaima.agent.plist');
  fs.writeFileSync(plistPath, plist.build(plistObj) as string);

  try {
    execSync(`launchctl load "${plistPath}"`);
    console.log('Service installed and started.');
  } catch (err) {
    console.error('Failed to install service:', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function uninstallService() {
  const homedir = os.homedir();
  const plistPath = path.join(
    homedir,
    'Library/LaunchAgents/com.tadaima.agent.plist'
  );

  if (fs.existsSync(plistPath)) {
    try {
      execSync(`launchctl unload "${plistPath}"`);
      fs.unlinkSync(plistPath);
      console.log('Service uninstalled.');
    } catch (err) {
      console.error('Failed to uninstall service:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}
```

### 10.16 packages/agent/src/tray/index.ts

```typescript
import SysTray from 'systray2';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { getConfig } from '../config/index.js';
import { getLogger } from '../logging/index.js';

const logger = getLogger();

const configDir = () => path.join(os.homedir(), '.config/tadaima');
const pidFile = () => path.join(configDir(), 'tadaima.pid');

interface TrayState {
  isRunning: boolean;
  isConnected: boolean;
  activeCount: number;
  profileName: string;
}

class TrayApp {
  private tray: SysTray | null = null;
  private state: TrayState = {
    isRunning: false,
    isConnected: false,
    activeCount: 0,
    profileName: 'Unknown',
  };

  async start() {
    this.tray = new SysTray({
      menu: {
        icon: this.getIconBase64(),
        isTemplateIcon: false,
        title: 'Tadaima',
        tooltip: 'Tadaima Agent',
        items: [
          {
            label: 'Status: Disconnected',
            enabled: false,
            checked: false,
          },
          {
            label: '',
            enabled: false,
            checked: false,
          },
          {
            label: 'Open Tadaima',
            enabled: true,
            checked: false,
          },
          {
            label: 'Start Agent',
            enabled: true,
            checked: false,
          },
          {
            label: 'Settings',
            enabled: true,
            checked: false,
          },
          {
            label: 'Logs',
            enabled: true,
            checked: false,
          },
          {
            label: 'Check for Updates',
            enabled: true,
            checked: false,
          },
          {
            label: 'Quit',
            enabled: true,
            checked: false,
          },
        ],
      },
      debug: false,
      copyDir: true,
    });

    this.tray.onClick((action) => {
      if (action.seq_type === 'double') {
        this.openWebUI();
      }
    });

    this.tray.onReady(() => {
      logger.info('Tray app ready');
      this.updateStatus();
      setInterval(() => this.updateStatus(), 2000);
    });

    // Menu click handling
    this.tray.on('click', (action) => {
      this.handleMenuClick(action.item.seq_id);
    });

    this.tray.ready();
  }

  private async handleMenuClick(itemId: number) {
    switch (itemId) {
      case 2: // Open Tadaima
        this.openWebUI();
        break;
      case 3: // Start/Stop Agent
        await this.toggleAgent();
        break;
      case 4: // Settings
        this.openSettings();
        break;
      case 5: // Logs
        this.openLogs();
        break;
      case 6: // Check for Updates
        this.checkUpdates();
        break;
      case 7: // Quit
        await this.stopAgent();
        if (this.tray) {
          this.tray.kill(false);
        }
        process.exit(0);
        break;
    }
  }

  private async updateStatus() {
    const isRunning = await this.checkRunning();
    this.state.isRunning = isRunning;

    // TODO: Query agent for connection status and active downloads
    const statusLabel = isRunning
      ? `Status: Connected (${this.state.profileName}) · ${this.state.activeCount} active`
      : 'Status: Disconnected';

    const startStopLabel = isRunning ? 'Stop Agent' : 'Start Agent';

    if (this.tray) {
      this.tray.setTemplate({
        ...this.tray.menu,
        items: [
          { label: statusLabel, enabled: false, checked: false },
          { label: '', enabled: false, checked: false },
          { label: 'Open Tadaima', enabled: true, checked: false },
          { label: startStopLabel, enabled: true, checked: false },
          { label: 'Settings', enabled: true, checked: false },
          { label: 'Logs', enabled: true, checked: false },
          { label: 'Check for Updates', enabled: true, checked: false },
          { label: 'Quit', enabled: true, checked: false },
        ],
      });
    }
  }

  private openWebUI() {
    const config = getConfig('relayUrl') || 'http://localhost:3000';
    try {
      if (process.platform === 'win32') {
        execSync(`start ${config}`, { shell: true, windowsHide: true });
      } else if (process.platform === 'darwin') {
        execSync(`open ${config}`, { shell: true });
      } else {
        execSync(`xdg-open ${config}`, { shell: true });
      }
    } catch (err) {
      logger.error('Failed to open web UI', err);
    }
  }

  private openSettings() {
    const configPath = path.join(
      os.homedir(),
      '.config/tadaima/config.json'
    );
    try {
      if (process.platform === 'win32') {
        execSync(`notepad "${configPath}"`, { windowsHide: true });
      } else if (process.platform === 'darwin') {
        execSync(`open -a TextEdit "${configPath}"`);
      } else {
        execSync(`xdg-open "${configPath}"`);
      }
    } catch (err) {
      logger.error('Failed to open settings', err);
    }
  }

  private openLogs() {
    const logPath = path.join(
      os.homedir(),
      '.config/tadaima/logs/tadaima.log'
    );
    try {
      if (process.platform === 'win32') {
        execSync(`notepad "${logPath}"`, { windowsHide: true });
      } else if (process.platform === 'darwin') {
        execSync(`open -a TextEdit "${logPath}"`);
      } else {
        execSync(`xdg-open "${logPath}"`);
      }
    } catch (err) {
      logger.error('Failed to open logs', err);
    }
  }

  private async toggleAgent() {
    const isRunning = await this.checkRunning();
    if (isRunning) {
      await this.stopAgent();
    } else {
      await this.startAgent();
    }
  }

  private async startAgent() {
    try {
      execSync('tadaima start -d', { windowsHide: true });
    } catch (err) {
      logger.error('Failed to start agent', err);
    }
  }

  private async stopAgent() {
    try {
      execSync('tadaima stop', { windowsHide: true });
    } catch (err) {
      logger.error('Failed to stop agent', err);
    }
  }

  private async checkRunning(): Promise<boolean> {
    const pidPath = pidFile();
    if (!fs.existsSync(pidPath)) return false;
    try {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf-8'));
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private checkUpdates() {
    logger.info('Checking for updates...');
    // TODO: Fetch latest version from GitHub
  }

  private getIconBase64(): string {
    // For now, return a simple pixel icon
    // In production, embed actual icon file
    const iconPath = path.join(
      __dirname,
      'icon-base.png'
    );
    if (fs.existsSync(iconPath)) {
      const data = fs.readFileSync(iconPath);
      return `data:image/png;base64,${data.toString('base64')}`;
    }
    // Fallback: 1x1 transparent PNG
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }
}

// Export for use in main agent
export const trayApp = new TrayApp();

// Auto-start if running on Windows
if (process.platform === 'win32' && !process.env.NO_TRAY) {
  trayApp.start().catch((err) => {
    logger.error('Failed to start tray app', err);
  });
}
```

### 10.17 packages/agent/src/index.ts

Main entry point that ties everything together:

```typescript
import { program } from 'commander';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from './logging/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJson = JSON.parse(
  readFileSync(path.join(__dirname, '../package.json'), 'utf-8')
);

const logger = getLogger();

program.name('tadaima').version(packageJson.version);

// Import and register all commands
import './cli/start-command.js';
import './cli/stop-command.js';
import './cli/status-command.js';
import './cli/config-command.js';
import './cli/logs-command.js';
import './cli/install-service-command.js';
import './cli/version-command.js';

// Parse and execute
program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

// Global error handler
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
  process.exit(1);
});
```

---

## 11. Execution Order & Implementation Checklist

### Phase 8 Implementation Steps

1. **Dependencies** — Update `packages/agent/package.json` with all new libraries
   - [ ] Install and test each library individually
   - [ ] Verify Windows-specific libs work on CI/local Windows machine

2. **Core infrastructure** (in order)
   - [ ] `src/logging/index.ts` — Pino logger with rotation
   - [ ] `src/config/index.ts` — Config file management with redaction
   - [ ] `src/daemon/index.ts` — Daemon utilities (PID file, fork, signals)

3. **CLI commands** (in order, start with simplest)
   - [ ] `src/cli/index.ts` — Commander setup
   - [ ] `src/cli/version-command.ts` — Just reads package.json
   - [ ] `src/cli/logs-command.ts` — Tail/follow logic
   - [ ] `src/cli/config-command.ts` — Get/set/list
   - [ ] `src/cli/status-command.ts` — Query daemon state
   - [ ] `src/cli/stop-command.ts` — Send SIGTERM
   - [ ] `src/cli/start-command.ts` — Daemon fork logic
   - [ ] `src/cli/install-service-command.ts` — Platform-specific service registration

4. **TUI rendering**
   - [ ] `src/ui/tui-renderer.ts` — ANSI rendering
   - [ ] Integrate into `start-command.ts` (foreground mode)
   - [ ] Test with mock download data

5. **System service integration**
   - [ ] `src/services/windows-service.ts` — node-windows integration
   - [ ] `src/services/systemd-service.ts` — systemd unit generation
   - [ ] `src/services/launchd-service.ts` — launchd plist generation
   - [ ] Manual testing on each OS

6. **Windows tray app** (Windows-specific, can defer to Phase 10)
   - [ ] `src/tray/index.ts` — systray2 integration
   - [ ] Icon assets (16×16 PNG files)
   - [ ] Right-click menu
   - [ ] Status updates
   - [ ] Integration with agent commands

7. **Build & packaging**
   - [ ] Verify all TS compiles
   - [ ] Test `pnpm build` works
   - [ ] Test binary location: `dist/index.js`
   - [ ] Ensure tray app is bundled (for Windows installer)

### Verification Checklist

- [ ] `tadaima version` outputs version and platform
- [ ] `tadaima config list` shows defaults
- [ ] `tadaima config set foo bar` persists to disk
- [ ] `tadaima config get foo` retrieves value
- [ ] `tadaima logs` shows last 50 lines of log file
- [ ] `tadaima logs -f` follows live (Ctrl+C exits cleanly)
- [ ] `tadaima start` runs foreground TUI with mock data
- [ ] `tadaima start -d` forks to background, writes PID
- [ ] `tadaima status` shows "not running" when no PID file
- [ ] `tadaima status` shows "running" when daemon is alive
- [ ] `tadaima stop` sends SIGTERM, waits, deletes PID file
- [ ] `tadaima stop` exits cleanly if daemon not running
- [ ] `tadaima install-service` succeeds on Windows/Linux/macOS
- [ ] Service starts on boot after installation
- [ ] `tadaima uninstall-service` removes service cleanly
- [ ] Windows tray icon appears (if on Windows)
- [ ] Tray menu shows "Start / Stop" toggle
- [ ] Clicking "Open Tadaima" opens relay URL in browser
- [ ] Toast notification fires on download complete

---

## 12. Common Pitfalls

### 1. **Daemon detachment on Windows**
- `fork({ detached: true })` doesn't work the same on Windows as Unix
- **Solution**: Use `node-windows` for Windows; Unix code uses standard fork()

### 2. **PID file race conditions**
- Two processes might check the PID file at the same time and both fork
- **Solution**: Use `fs.writeFileSync()` atomically; check `process.kill(pid, 0)` to verify

### 3. **TUI cursor handling**
- If the process crashes, the cursor might stay hidden
- **Solution**: Always restore cursor on exit (even via error handlers); add a timeout-based restore

### 4. **Systemd unit path on different distros**
- Some systems use `/usr/lib/systemd/system/` instead of `/etc/systemd/system/`
- **Solution**: Use `/etc/systemd/system/` (user-supplied services) consistently; document this

### 5. **Config file permissions**
- Config file in `~/.config/` might have restrictive permissions
- **Solution**: Explicitly set umask or chmod config file to 0o600 after writing

### 6. **Log rotation edge cases**
- Multiple processes writing to log at the same time; pino-roll might not handle this
- **Solution**: Use Pino's built-in sync mode; add file locking if needed in Phase 9

### 7. **Tray app not finding tadaima command**
- The tray app executes `tadaima` via `execSync()`, but the command might not be in PATH
- **Solution**: Either bundle the agent CLI into tray app, or use full path to executable

### 8. **Config redaction breaking JSON**
- Redacting `rdApiKey: "abc123"` to `rdApiKey: "***REDACTED***"` breaks JSON parsing
- **Solution**: Return formatted string (key: value), not JSON; use for display only

### 9. **Windows registry persistence across uninstall**
- Auto-start registry key might not be removed on uninstall
- **Solution**: Explicitly delete registry key in `node-windows` uninstall handler

### 10. **Plist syntax errors on macOS**
- Malformed plist will fail silently; `launchctl load` will error cryptically
- **Solution**: Validate plist with `plutil -lint` before loading; use the `plist` npm library to generate

---

## 13. Summary

Phase 8 transforms the agent from a background service into a **polished, user-friendly CLI tool** with:

- **TUI mode**: Real-time progress display with ANSI escape codes
- **Daemon mode**: Fork to background, PID file management, graceful shutdown
- **System services**: Windows Service, systemd, launchd integration
- **Windows tray app**: Visual status, start/stop control, settings, logs
- **Configuration CLI**: Get/set/list with sensitive value redaction
- **Log viewer**: Tail and follow with rotation support
- **CLI commands**: Structured argument parsing with commander.js

All files are complete and ready to implement. The spec is detailed enough to guide development while marking decisions that need validation. Windows tray app can be deferred to Phase 10 if needed.

