#!/bin/bash
# Build macOS installer (.pkg + .dmg) from the repo root.
# Usage: ./build-installers.sh

set -e

echo "=== Building Tadaima installers ==="
echo ""

cd "$(dirname "$0")/installers/macos"
bash build-pkg.sh

echo ""
echo "=== Done ==="
echo "  installers/macos/Tadaima-Setup.pkg"
echo "  installers/macos/Tadaima-Setup.dmg"
