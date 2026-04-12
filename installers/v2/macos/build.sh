#!/bin/bash
# installers/v2/macos/build.sh — entry point for the macOS installer build.
#
# Produces:
#   dist/Tadaima-Setup.pkg   (signed + notarized if certs are available)
#   dist/Tadaima-Setup.dmg   (signed + notarized if certs are available)
#
# The .pkg is a pure payload installer — no postinstall scripts. All
# setup (config GUI, launchd, login item) is handled by the menu bar
# app's first-launch flow (FirstRunSetup.swift).
#
# Signing + notarization are enabled when these env vars are set:
#   DEVELOPER_ID_APP        — "Developer ID Application: Name (TEAMID)"
#   DEVELOPER_ID_INSTALLER  — "Developer ID Installer: Name (TEAMID)"
#   APPLE_ID                — Apple ID email for notarization
#   APPLE_APP_PASSWORD      — App-specific password for notarization
#   APPLE_TEAM_ID           — 10-char Apple Team ID

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# ROOT is installers/v2/macos; go up three levels to reach the repo root.
REPO_ROOT="$(cd "$ROOT/../../.." && pwd)"
SHARED="$REPO_ROOT/installers/v2/shared"
DIST="$ROOT/dist"
STAGING="$ROOT/.build"

rm -rf "$DIST" "$STAGING"
mkdir -p "$DIST" "$STAGING"

echo "[build.sh] fetching pinned Node runtimes"
ARM64_NODE=$(node "$SHARED/fetch-node-runtime.mjs" darwin-arm64 --out "$STAGING/node-darwin-arm64")
X64_NODE=$(node "$SHARED/fetch-node-runtime.mjs" darwin-x64 --out "$STAGING/node-darwin-x64")
echo "  arm64: $ARM64_NODE"
echo "  x64:   $X64_NODE"

echo "[build.sh] packing agent tarball"
TARBALL=$(node "$SHARED/pack-agent.mjs" --out "$STAGING/agent-tarball")
echo "  tarball: $TARBALL"

echo "[build.sh] building TadaimaConfig.app (config GUI)"
(
    cd "$ROOT/config-gui"
    swift build -c release --arch arm64 --arch x86_64
)
CONFIG_BIN="$ROOT/config-gui/.build/apple/Products/Release/TadaimaConfig"

# Assemble a minimal .app bundle for the config GUI. SwiftPM produces a
# plain executable; we wrap it in a bundle so `open -W` can launch it.
CONFIG_APP="$STAGING/TadaimaConfig.app"
mkdir -p "$CONFIG_APP/Contents/MacOS"
mkdir -p "$CONFIG_APP/Contents/Resources"
cp "$CONFIG_BIN" "$CONFIG_APP/Contents/MacOS/TadaimaConfig"
cat > "$CONFIG_APP/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>TadaimaConfig</string>
    <key>CFBundleIdentifier</key>
    <string>com.tadaima.config</string>
    <key>CFBundleName</key>
    <string>TadaimaConfig</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF

echo "[build.sh] building TadaimaMenuBar (Tadaima.app)"
(
    cd "$ROOT/menubar-app"
    swift build -c release --arch arm64 --arch x86_64
)
MENUBAR_BIN="$ROOT/menubar-app/.build/apple/Products/Release/TadaimaMenuBar"

# Assemble Tadaima.app with all bundled resources inside it.
APP="$STAGING/Tadaima.app"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"
cp "$MENUBAR_BIN" "$APP/Contents/MacOS/TadaimaMenuBar"
cat > "$APP/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>TadaimaMenuBar</string>
    <key>CFBundleIdentifier</key>
    <string>com.tadaima.menubar</string>
    <key>CFBundleName</key>
    <string>Tadaima</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key>
        <false/>
    </dict>
</dict>
</plist>
EOF

# Copy bundled Node runtimes (both archs) + config GUI +
# launchd plist template into Contents/Resources.
cp -R "$ARM64_NODE" "$APP/Contents/Resources/runtime-arm64"
cp -R "$X64_NODE"   "$APP/Contents/Resources/runtime-x64"
cp -R "$CONFIG_APP" "$APP/Contents/Resources/TadaimaConfig.app"
cp "$ROOT/pkg/com.tadaima.agent.plist.template" "$APP/Contents/Resources/"

# ── Build-time agent install ────────────────────────────────────────
# Install the agent from the bundled tarball at build time so that
# dependencies are fetched on CI (reliable network) rather than at
# install time on the user's machine. The result is fully self-contained.
echo "[build.sh] installing agent from tarball (build-time npm install)"
AGENT_DIR="$APP/Contents/Resources/agent"
mkdir -p "$AGENT_DIR"
"$ARM64_NODE/bin/node" \
    "$ARM64_NODE/lib/node_modules/npm/bin/npm-cli.js" \
    install -g \
    --prefix "$AGENT_DIR" \
    "$TARBALL"

# The tarball is no longer needed in the bundle.
# (It was copied earlier but we only need the installed result.)

# Verify the agent installed correctly.
if [ ! -f "$AGENT_DIR/bin/tadaima" ]; then
    echo "[build.sh] FATAL: agent binary not found after npm install" >&2
    echo "  expected: $AGENT_DIR/bin/tadaima" >&2
    ls -la "$AGENT_DIR/bin/" 2>/dev/null || echo "  (bin/ does not exist)" >&2
    exit 1
fi
echo "[build.sh] agent installed: $AGENT_DIR/bin/tadaima"

# Write tray-config.json with the heartbeat interval so the menu bar app
# can compute its staleness threshold. We read the canonical value from
# the pinned agent source to keep the tray and agent in sync.
HEARTBEAT=$(grep -oE 'STATUS_HEARTBEAT_INTERVAL_MS = [0-9_]+' \
    "$REPO_ROOT/packages/agent/src/status-file.ts" \
    | head -1 | awk -F' = ' '{ gsub("_","",$2); print $2 }')
if [ -z "$HEARTBEAT" ]; then
    echo "[build.sh] failed to read STATUS_HEARTBEAT_INTERVAL_MS from agent" >&2
    exit 1
fi
cat > "$APP/Contents/Resources/tray-config.json" << EOF
{
  "statusHeartbeatIntervalMs": $HEARTBEAT
}
EOF

# ── Code signing ────────────────────────────────────────────────────
# Sign all binaries inside-out when Developer ID certs are available.
# Without these env vars, the build produces unsigned artifacts (fine
# for local testing).
ENTITLEMENTS="$ROOT/entitlements.plist"
if [ -n "${DEVELOPER_ID_APP:-}" ]; then
    echo "[build.sh] signing binaries with: $DEVELOPER_ID_APP"

    # 1. Sign each Node runtime binary (needs entitlements for V8 JIT)
    find "$APP/Contents/Resources/runtime-arm64" "$APP/Contents/Resources/runtime-x64" \
        -type f -perm +111 -name 'node' | while read -r bin; do
        echo "  signing: $bin"
        codesign --force --options runtime --timestamp \
            --entitlements "$ENTITLEMENTS" \
            --sign "$DEVELOPER_ID_APP" \
            "$bin"
    done

    # 2. Sign the config GUI app bundle
    echo "  signing: TadaimaConfig.app"
    codesign --force --options runtime --timestamp --deep \
        --sign "$DEVELOPER_ID_APP" \
        "$APP/Contents/Resources/TadaimaConfig.app"

    # 3. Sign the outer Tadaima.app bundle (deep catches remaining files)
    echo "  signing: Tadaima.app"
    codesign --force --options runtime --timestamp --deep \
        --entitlements "$ENTITLEMENTS" \
        --sign "$DEVELOPER_ID_APP" \
        "$APP"

    echo "[build.sh] signing complete"
else
    echo "[build.sh] DEVELOPER_ID_APP not set — skipping code signing"
fi

# ── Build the .pkg ──────────────────────────────────────────────────
# Pure payload package — no scripts. Tadaima.app is installed to
# /Applications; all setup happens in the app's first-launch flow.
COMPONENT_PKG="$STAGING/Tadaima.pkg"
pkgbuild \
    --identifier com.tadaima.app \
    --version 0.1.0 \
    --install-location /Applications \
    --component "$APP" \
    "$COMPONENT_PKG"

PKG="$DIST/Tadaima-Setup.pkg"
productbuild \
    --distribution "$ROOT/pkg/distribution.xml" \
    --package-path "$STAGING" \
    "$PKG"

# Sign the .pkg with the Developer ID Installer cert.
if [ -n "${DEVELOPER_ID_INSTALLER:-}" ]; then
    echo "[build.sh] signing pkg with: $DEVELOPER_ID_INSTALLER"
    SIGNED_PKG="$DIST/Tadaima-Setup-signed.pkg"
    productsign --sign "$DEVELOPER_ID_INSTALLER" --timestamp "$PKG" "$SIGNED_PKG"
    mv "$SIGNED_PKG" "$PKG"
fi

# ── Notarization ────────────────────────────────────────────────────
# Submit to Apple for notarization when credentials are available.
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    echo "[build.sh] notarizing pkg"
    xcrun notarytool submit "$PKG" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_APP_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait

    echo "[build.sh] stapling notarization ticket to pkg"
    xcrun stapler staple "$PKG"
else
    echo "[build.sh] APPLE_ID/APPLE_APP_PASSWORD/APPLE_TEAM_ID not set — skipping notarization"
fi

# ── Wrap in DMG ─────────────────────────────────────────────────────
DMG="$DIST/Tadaima-Setup.dmg"
DMG_STAGING="$STAGING/dmg-root"
mkdir -p "$DMG_STAGING"
cp "$PKG" "$DMG_STAGING/"
hdiutil create \
    -volname "Tadaima Setup" \
    -srcfolder "$DMG_STAGING" \
    -ov \
    -format UDZO \
    "$DMG"

# Notarize the DMG separately (it's a different format than the pkg).
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    echo "[build.sh] notarizing dmg"
    xcrun notarytool submit "$DMG" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_APP_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait

    echo "[build.sh] stapling notarization ticket to dmg"
    xcrun stapler staple "$DMG"
fi

echo "[build.sh] done"
echo "  pkg: $PKG"
echo "  dmg: $DMG"
