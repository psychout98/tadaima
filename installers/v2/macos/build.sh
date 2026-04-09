#!/bin/bash
# installers/v2/macos/build.sh — entry point for the macOS installer build.
#
# Produces (unsigned, beta-grade):
#   dist/Tadaima-Setup.pkg
#   dist/Tadaima-Setup.dmg
#
# All signing calls (codesign, productsign, notarytool, stapler) are
# intentionally omitted. Adding them is a pipeline-only change tracked in
# specs/CODE_SIGNING_INSTRUCTIONS.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
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

# Copy bundled Node runtimes (both archs) + agent tarball + config GUI +
# launchd plist template into Contents/Resources.
cp -R "$ARM64_NODE" "$APP/Contents/Resources/runtime-arm64"
cp -R "$X64_NODE"   "$APP/Contents/Resources/runtime-x64"
cp "$TARBALL" "$APP/Contents/Resources/agent-tarball.tgz"
cp -R "$CONFIG_APP" "$APP/Contents/Resources/TadaimaConfig.app"
cp "$ROOT/pkg/com.tadaima.agent.plist.template" "$APP/Contents/Resources/"

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

# Build the .pkg. We use pkgbuild for the component (Tadaima.app under
# /Applications) + productbuild for the distribution wrapper.
COMPONENT_PKG="$STAGING/Tadaima.pkg"
pkgbuild \
    --identifier com.tadaima.app \
    --version 0.1.0 \
    --install-location /Applications \
    --component "$APP" \
    --scripts "$ROOT/pkg/scripts" \
    "$COMPONENT_PKG"

PKG="$DIST/Tadaima-Setup.pkg"
productbuild \
    --distribution "$ROOT/pkg/distribution.xml" \
    --package-path "$STAGING" \
    "$PKG"

# Wrap the pkg in a dmg. hdiutil create with -srcfolder creates a
# read-only compressed image.
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

echo "[build.sh] done"
echo "  pkg: $PKG"
echo "  dmg: $DMG"
