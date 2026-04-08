#!/usr/bin/env bash
set -euo pipefail

# ─── Release script for @psychout98/tadaima ──────────────────────────
# Bumps version, commits, tags, and pushes. GitHub Actions handles
# the rest: build, npm publish, binary compilation, GitHub release.
#
# Usage:
#   ./release.sh           # prompts for bump type
#   ./release.sh patch     # skip prompt
#   ./release.sh minor
#   ./release.sh major
# ─────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")"

# ─── Preflight checks ───────────────────────────────────────────────

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

# ─── Determine bump type ────────────────────────────────────────────

BUMP="${1:-}"

if [ -z "$BUMP" ]; then
  echo "Select version bump type:"
  echo "  1) patch  (bug fixes)"
  echo "  2) minor  (new features)"
  echo "  3) major  (breaking changes)"
  read -rp "Choice [1/2/3]: " choice
  case "$choice" in
    1) BUMP="patch" ;;
    2) BUMP="minor" ;;
    3) BUMP="major" ;;
    *) echo "Invalid choice." >&2; exit 1 ;;
  esac
fi

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Error: Invalid bump type '$BUMP'. Use patch, minor, or major." >&2
  exit 1
fi

OLD_VERSION=$(node -p "require('./packages/agent/package.json').version")

# ─── Bump version ───────────────────────────────────────────────────

cd packages/agent && npm version "$BUMP" --no-git-tag-version && cd ../..
NEW_VERSION=$(node -p "require('./packages/agent/package.json').version")

echo ""
echo "Version: $OLD_VERSION → $NEW_VERSION"

# ─── Commit, tag, push ──────────────────────────────────────────────

git add packages/agent/package.json
git commit -m "release: v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push
git push origin "v$NEW_VERSION"

echo ""
echo "Pushed v$NEW_VERSION. GitHub Actions will now:"
echo "  • Build and publish to npm"
echo "  • Compile standalone binaries"
echo "  • Create GitHub release with assets"
echo "  • Push Docker images"
echo ""
echo "Track progress: https://github.com/psychout98/tadaima/actions"
