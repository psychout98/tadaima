# Installer v2 — Beta Smoke Test Checklist

Run the relevant list end-to-end on a **clean VM** before tagging a new
`installer-v*-beta*` release. If any item fails, do not ship — open an
issue and fix it first.

## Before you start

Confirm the path the agent uses for `config.json` and `status.json` by
grepping `packages/agent/src/config.ts` for the `Conf` constructor. On
macOS the path is `~/Library/Application Support/tadaima/`; on Windows
it is `%APPDATA%\tadaima\`. The checklist refers to this location as
"the agent config directory".

A "clean VM" means default Defender / Gatekeeper settings, no prior
Tadaima install, and no prior `@psychout98/tadaima` npm install.

## Windows (clean Windows 11 VM)

- [ ] `Tadaima-Setup.msi` downloads from the latest prerelease without
  a Defender auto-delete.
- [ ] Double-clicking the MSI surfaces the SmartScreen prompt; "More
  info → Run anyway" proceeds to the installer UI.
- [ ] UAC elevation is requested exactly once, at the very start.
- [ ] The first-run config GUI appears in the installing user's
  desktop (not a SYSTEM-context ghost window).
- [ ] Entering a valid relay URL, a real pairing code from the web
  app, and two existing directories succeeds and closes the window.
- [ ] After the MSI finishes, the `Tadaima Agent` task exists in
  Task Scheduler with triggers `OnLogon` and restart-on-failure.
- [ ] The tray icon appears within 10 seconds, green.
- [ ] The tray dropdown shows the device name, relay URL, and
  `Active downloads: 0`.
- [ ] `status.json` exists in the agent config directory and its
  `lastHeartbeat` field updates every 10 seconds.
- [ ] Opening Settings, changing `maxConcurrentDownloads`, and
  clicking Save writes the new value back into `config.json`.
- [ ] Changing the relay URL in Settings triggers a task restart and
  the tray goes gray → green within ~15 seconds.
- [ ] "Check for Updates" succeeds on the first invocation (either
  reports "up to date" or prompts for an update) with no unhandled
  exceptions.
- [ ] "Uninstall Tadaima…" removes the scheduled task, the tray
  startup registry entry, the install directory, and the
  `TadaimaTray` process. The agent config directory survives.
- [ ] After uninstall, `status.json` stays on disk — a reinstall picks
  up the same pairing.

## macOS (clean macOS 14 VM)

- [ ] `Tadaima-Setup.dmg` downloads from the latest prerelease.
- [ ] Mounting the DMG shows `Tadaima-Setup.pkg` and nothing else.
- [ ] Double-clicking the PKG hits Gatekeeper; right-click → Open
  → Open dismisses the warning.
- [ ] The first-run config GUI appears *before* any launchd plist is
  loaded (check `launchctl print gui/$(id -u)/com.tadaima.agent` —
  should not exist yet).
- [ ] Entering a valid relay URL, pairing code, and two existing
  directories succeeds and exits the GUI.
- [ ] After the PKG finishes, `~/Library/LaunchAgents/com.tadaima.agent.plist`
  exists and `launchctl list | grep tadaima` shows the agent running.
- [ ] The menu bar icon appears within 10 seconds, green.
- [ ] The menu bar dropdown shows device name, relay URL, and
  `Active downloads: 0`.
- [ ] `status.json` exists in the agent config directory and its
  `lastHeartbeat` field updates every 10 seconds.
- [ ] Settings opens, edits save correctly, the agent picks up a new
  relay URL without a manual restart.
- [ ] "Check for Updates" runs cleanly on first invocation.
- [ ] "View Logs…" opens `~/Library/Logs/Tadaima/agent.log` in the
  default text viewer.
- [ ] "Uninstall Tadaima…" unloads the LaunchAgent, deletes the plist
  from `~/Library/LaunchAgents/`, unregisters the Login Item (if
  registered), and moves `/Applications/Tadaima.app` to Trash. The
  agent config directory survives.

## Cross-platform sanity

- [ ] The tarball embedded in the installer is the pinned version in
  `installers/v2/shared/agent-version.json` (confirm by checking
  `tadaima --version` inside the installed agent).
- [ ] The bundled Node runtime version matches
  `installers/v2/shared/node-runtime-versions.json` (confirm by
  running `<install>/runtime/bin/node --version`).
- [ ] `checksums.sha256` in the release matches the downloaded
  artifacts on both platforms.
