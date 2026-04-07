#!/bin/bash
# Tadaima Agent — macOS .pkg + .dmg build script
# Run from the installers/macos/ directory.

set -e

cd "$(dirname "$0")"

echo "Building Tadaima Agent installer..."

# Clean previous builds
rm -f component.pkg menubar.pkg Tadaima-Setup.pkg Tadaima-Setup.dmg

# Build the menu bar app
echo "Building menu bar app..."
cd menubar && bash build.sh && cd ..

# Build the agent component package (no payload — binary is downloaded at install time)
pkgbuild --nopayload \
  --scripts scripts/ \
  --identifier com.tadaima.agent \
  --version "1.0.0" \
  component.pkg

# Build the menu bar app component package (has payload — the .app bundle)
pkgbuild --root menubar/TadaimaMenu.app \
  --install-location "/Applications/Tadaima Menu.app" \
  --identifier com.tadaima.menu \
  --version "1.0.0" \
  menubar.pkg

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
rm -f component.pkg menubar.pkg

echo "Done. Output: Tadaima-Setup.pkg, Tadaima-Setup.dmg"
