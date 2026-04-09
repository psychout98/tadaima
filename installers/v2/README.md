# Tadaima Desktop Installers (v2)

This directory holds the **v2** desktop installers for Tadaima — the trusted
Windows MSI and macOS PKG/DMG wrappers that install a bundled Node runtime,
lay down the `@psychout98/tadaima` agent from npm, and run a native menu bar
/ tray app on top of it.

The authoritative design document is
[`specs/INSTALLER_V2_SPEC.md`](../../specs/INSTALLER_V2_SPEC.md). The ordered
implementation plan is
[`specs/INSTALLER_V2_DEV_PLAN.md`](../../specs/INSTALLER_V2_DEV_PLAN.md).
Code signing is tracked separately in
[`specs/CODE_SIGNING_INSTRUCTIONS.md`](../../specs/CODE_SIGNING_INSTRUCTIONS.md).

## Relationship to the old `installers/` tree

The older [`installers/`](../) directory remains in the repository **for
reference only**. None of the code in `installers/v2/` imports from it. If a
snippet is useful, copy it out — but do not introduce a dependency.

## Directory layout

```
installers/v2/
├── README.md                    — this file
├── shared/
│   ├── node-runtime-versions.json   — pinned Node.js LTS + SHA-256s
│   ├── agent-version.json           — pinned @psychout98/tadaima version
│   ├── fetch-node-runtime.mjs       — downloads + verifies the Node runtime
│   └── pack-agent.mjs               — runs `npm pack` to produce the offline tarball
├── windows/
│   ├── msi/                         — WiX v4 MSI project + native custom actions
│   ├── config-gui/                  — WinUI 3 first-run config GUI (.NET 8, C#)
│   ├── tray-app/                    — WinUI 3 tray app (.NET 8, C#)
│   └── build.ps1                    — CI entry point
└── macos/
    ├── pkg/                         — distribution.xml + postinstall scripts
    ├── config-gui/                  — SwiftUI first-run config GUI
    ├── menubar-app/                 — SwiftUI menu bar app (Tadaima.app)
    └── build.sh                     — CI entry point
```

## What these installers are

- A **delivery vehicle** for the existing `@psychout98/tadaima` npm package.
  The installer does not compile a standalone binary, does not fork the
  agent, and does not patch the agent at install time. The byte-identical
  code that runs for `npm i -g @psychout98/tadaima` users runs for desktop
  users.
- A **remote control** for the agent (the tray / menu bar app). The tray
  app only reads files the agent already writes (`config.json`,
  `status.json`, `tadaima.pid`) and spawns the agent's existing CLI entry
  point. It contains no agent logic of its own.

Everything else — the relay, the web app, the database schema, the
websocket protocol — is completely out of scope for this workstream.

## Building locally

> **Heads up:** these installers produce unsigned artifacts during beta.
> A freshly built MSI will trigger a SmartScreen warning on Windows, and a
> freshly built PKG/DMG will trigger a Gatekeeper warning on macOS. Both are
> expected; see the "Beta Testers" section below for the dismissal steps.
> Signing is added later as a pipeline-only change per
> [`CODE_SIGNING_INSTRUCTIONS.md`](../../specs/CODE_SIGNING_INSTRUCTIONS.md).

### macOS

Prerequisites: macOS 13 or newer, Xcode command-line tools, Node 20+ (only
used to run the shared JS helpers — the bundled runtime is downloaded by
the build script itself).

```sh
cd installers/v2/macos
./build.sh
```

The script downloads and verifies the pinned Node runtimes for both
`darwin-arm64` and `darwin-x64`, runs `npm pack` to embed the agent
tarball, builds the two SwiftUI apps, assembles `Tadaima.app` with
everything staged inside `Contents/Resources/`, and wraps the `.pkg` in a
`Tadaima-Setup.dmg`.

### Windows

Prerequisites: Windows 10/11 or Windows Server with Visual Studio 2022
Build Tools (including the .NET 8 SDK and the Windows App SDK workload),
PowerShell 7+, and the WiX v4 `wix` CLI on PATH. Node 20+ must be
installed to run the shared JS helpers.

```powershell
cd installers\v2\windows
.\build.ps1
```

The script downloads and verifies the pinned Node runtime for `win-x64`,
runs `npm pack`, builds `TadaimaConfig.exe`, `TadaimaTray.exe`, and the
native MSI custom-action helpers, and runs `wix build` to produce
`Tadaima-Setup.msi`.

## CI pipeline

Installer builds run in
[`.github/workflows/installers.yml`](../../.github/workflows/installers.yml),
completely separate from the existing agent `release.yml`. Triggers are a
manual `workflow_dispatch` and a `push` of tags matching `installer-v*`.
During beta the signing jobs are stubbed with `if: false`; activation is a
pipeline-only flip described in
[`CODE_SIGNING_INSTRUCTIONS.md`](../../specs/CODE_SIGNING_INSTRUCTIONS.md).

## Beta Testers

The installers shipped under the `installer-v*-beta*` tags on the
[Releases page](https://github.com/psychout98/tadaima/releases) are
**unsigned**. That is intentional for beta — see
[`CODE_SIGNING_INSTRUCTIONS.md`](../../specs/CODE_SIGNING_INSTRUCTIONS.md)
for the path to signed, warning-free builds at GA. Until then, you will
see a security warning on first run. Here is how to dismiss it safely:

### Windows (SmartScreen)

1. Download `Tadaima-Setup.msi` from the latest `installer-v*-beta*`
   release.
2. Double-click the MSI. Windows will show **"Windows protected your
   PC"**.
3. Click **"More info"**.
4. Click **"Run anyway"**.
5. The Tadaima first-run configuration window opens. Enter your relay
   URL, the 6-character pairing code from the Tadaima web app, and your
   Movies / TV directories.
6. Click **"Pair and Save"**. On success, the installer continues and
   registers the `Tadaima Agent` scheduled task. A green tray icon
   appears a few seconds later.

### macOS (Gatekeeper)

1. Download `Tadaima-Setup.dmg` from the latest `installer-v*-beta*`
   release.
2. Double-click the DMG to mount it.
3. **Right-click** (or Control-click) the `Tadaima-Setup.pkg` inside and
   choose **"Open"**.
4. Gatekeeper shows **"Tadaima-Setup.pkg cannot be opened because it is
   from an unidentified developer"**. Click **"Open"** in the
   confirmation dialog.
5. Walk through the standard macOS installer. Toward the end, the
   Tadaima first-run configuration window opens.
6. Enter your relay URL, pairing code, and media directories. Click
   **"Pair and Save"**. On success, the installer registers the launchd
   agent and a green menu bar icon appears.

### Verifying your download

Every release also ships `checksums.sha256` — run `sha256sum
Tadaima-Setup.msi` (Linux/macOS) or `certutil -hashfile Tadaima-Setup.msi
SHA256` (Windows) and confirm the hash matches before installing.

### Known beta limitations

- SmartScreen and Gatekeeper warnings on first install (intentional; GA
  fixes this via Azure Trusted Signing on Windows and Developer ID +
  notarization on macOS).
- Windows: the MSI is per-machine and requires UAC elevation to install.
- macOS: the installer does not automatically register Tadaima.app as a
  Login Item; the first time you open the Settings window, toggle
  "Start on login" to enable it.
- Any "Check for Updates" flow contacts the public npm registry; if your
  machine cannot reach `https://registry.npmjs.org/`, update checks will
  fail silently.
