#!/bin/bash
# Tadaima Agent — macOS .pkg + .dmg build script
# Run from the installers/macos/ directory.

set -e

cd "$(dirname "$0")"

VERSION="${1:-1.0.0}"

echo "Building Tadaima Agent installer v${VERSION}..."

# Clean previous builds
rm -f component.pkg Tadaima-Setup.pkg Tadaima-Setup.dmg

# Build the component package (no payload — binary is downloaded at install time)
pkgbuild --nopayload \
  --scripts scripts/ \
  --identifier com.tadaima.agent \
  --version "${VERSION}" \
  component.pkg

# Build the product archive with the distribution descriptor
productbuild --distribution distribution.xml \
  --resources resources/ \
  --package-path . \
  Tadaima-Setup.pkg

echo "Built Tadaima-Setup.pkg"

# Wrap in a DMG for distribution
hdiutil create -volname "Tadaima Agent" \
  -srcfolder Tadaima-Setup.pkg \
  -ov \
  -format UDZO \
  Tadaima-Setup.dmg

echo "Built Tadaima-Setup.dmg"

# Clean intermediate
rm -f component.pkg

echo "Done. Output: Tadaima-Setup.pkg, Tadaima-Setup.dmg"
