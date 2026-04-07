#!/bin/bash
# Build the Tadaima menu bar app
# Output: TadaimaMenu.app bundle

set -e
cd "$(dirname "$0")"

APP_NAME="TadaimaMenu"
APP_BUNDLE="${APP_NAME}.app"
CONTENTS="${APP_BUNDLE}/Contents"
MACOS="${CONTENTS}/MacOS"

# Clean
rm -rf "${APP_BUNDLE}"

# Compile
swiftc -o "${APP_NAME}" \
  TadaimaMenu.swift \
  SettingsWindow.swift \
  StatusReader.swift \
  Uninstaller.swift \
  -framework Cocoa \
  -O

# Create .app bundle structure
mkdir -p "${MACOS}"
mv "${APP_NAME}" "${MACOS}/"
cp Info.plist "${CONTENTS}/"

echo "Built: ${APP_BUNDLE}"
