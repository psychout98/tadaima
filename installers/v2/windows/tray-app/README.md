# TadaimaTray (Windows tray app)

Thin WinUI 3 wrapper around the `@psychout98/tadaima` npm agent. Reads
`status.json` from the agent config directory on a 2s timer and exposes:

- Connection state (green / red / gray dot)
- Settings…
- Check for Updates
- View Logs…
- Uninstall Tadaima…
- Quit

## Notify icon

WinUI 3 does not ship a `NotifyIcon` equivalent. We use
[H.NotifyIcon.WinUI](https://github.com/HavenDV/H.NotifyIcon) — a community
package that wraps the Win32 `Shell_NotifyIcon` API and integrates with
WinUI 3 data binding. The fallback plan if this package proves unreliable
at GA is to P/Invoke `Shell_NotifyIconW` directly.

## Config path

The tray app reads `status.json` from the same directory the agent writes
it. On Windows that is `%APPDATA%\tadaima\`
(`Environment.SpecialFolder.ApplicationData` → `tadaima`), because the
agent uses the `conf` npm package under the project name `tadaima`.

## Bundled runtime

All Node/npm/agent invocations are done against the runtime bundled inside
the install directory — never against a system-installed Node. The install
directory is discovered from the tray app's own executable path at
runtime, so the tray app works correctly on non-default `Program Files`
locations.
