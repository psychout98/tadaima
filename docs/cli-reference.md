# Agent CLI Reference

## Commands

### `tadaima-agent setup`

Interactive setup wizard. Pairs this device with a Tadaima instance.

Prompts for:
- Relay URL (e.g., `https://your-instance.up.railway.app`)
- Pairing code (6 characters, from the web app Devices page)
- Movies directory path
- TV Shows directory path

The RD API key is distributed automatically from the relay during pairing.

### `tadaima-agent start`

Start the agent in foreground mode with a terminal UI showing:
- Connection status
- Active downloads with progress bars
- Recently completed downloads

Press `Ctrl+C` to stop.

### `tadaima-agent start -d`

Start as a background daemon. Writes PID to `~/.config/tadaima/tadaima.pid` and logs to `~/.config/tadaima/logs/tadaima.log`.

### `tadaima-agent stop`

Stop the background daemon.

### `tadaima-agent status`

Show current status: version, relay URL, device name, running/not running.

### `tadaima-agent config get <key>`

Read a config value. Supports dot notation:

```bash
tadaima-agent config get directories.movies
tadaima-agent config get relay
tadaima-agent config get maxConcurrentDownloads
```

### `tadaima-agent config set <key> <value>`

Update a config value:

```bash
tadaima-agent config set directories.movies /mnt/media/Movies
tadaima-agent config set maxConcurrentDownloads 3
```

### `tadaima-agent config list`

Show all configuration (sensitive values redacted).

### `tadaima-agent logs`

Show last 50 lines of the daemon log.

### `tadaima-agent logs -f`

Follow the log file in real-time.

### `tadaima-agent logs -n <count>`

Show the last N lines:

```bash
tadaima-agent logs -n 100
```

### `tadaima-agent install-service`

Install as a system service:
- **Linux**: generates systemd unit, enables and starts
- **macOS**: generates launchd plist, loads it

Service auto-starts on boot and restarts on failure.

### `tadaima-agent uninstall-service`

Stop and remove the system service.

### `tadaima-agent version`

Show version info.

## Configuration

Config file location: `~/.config/tadaima/config.json`

| Key | Description | Default |
|-----|------------|---------|
| `relay` | Relay server URL | — |
| `deviceToken` | JWT device token (set during pairing) | — |
| `deviceId` | Device UUID | — |
| `deviceName` | Device hostname | — |
| `directories.movies` | Movies download directory | — |
| `directories.tv` | TV Shows download directory | — |
| `directories.staging` | Temporary download directory | `/tmp/tadaima/staging` |
| `realDebrid.apiKey` | RD API key (set during pairing) | — |
| `maxConcurrentDownloads` | Max simultaneous downloads | `2` |
| `rdPollInterval` | RD status poll interval (seconds) | `30` |
