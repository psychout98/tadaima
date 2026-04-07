#!/bin/bash
# Run menu bar app unit tests
# Usage: bash tests/run-tests.sh

set -e
cd "$(dirname "$0")/.."

echo "Compiling tests..."
swiftc -o /tmp/tadaima-menubar-tests \
  StatusReader.swift \
  tests/StatusReaderTests.swift \
  -framework Foundation \
  -O

echo "Running tests..."
echo ""
/tmp/tadaima-menubar-tests
