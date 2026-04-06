#!/bin/sh
set -e

# Require ENCRYPTION_MASTER_KEY — refuse to start without it
if [ -z "$ENCRYPTION_MASTER_KEY" ]; then
  echo "FATAL: ENCRYPTION_MASTER_KEY is not set." >&2
  echo "  Generate one with: openssl rand -hex 32" >&2
  exit 1
fi

# Require JWT_SECRET — refuse to start without it
if [ -z "$JWT_SECRET" ]; then
  echo "FATAL: JWT_SECRET is not set." >&2
  echo "  Generate one with: openssl rand -hex 64" >&2
  exit 1
fi

# Run database migrations
echo "Running database migrations..."
node packages/relay/dist/migrate.js 2>/dev/null || echo "Migrations skipped (will run on first setup)"

# Start the relay server
exec node packages/relay/dist/index.js
