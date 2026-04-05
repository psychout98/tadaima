#!/bin/sh
set -e

# Auto-generate ENCRYPTION_MASTER_KEY if not set
if [ -z "$ENCRYPTION_MASTER_KEY" ]; then
  export ENCRYPTION_MASTER_KEY=$(openssl rand -hex 32)
  echo "WARNING: ENCRYPTION_MASTER_KEY auto-generated. Save this for persistence:"
  echo "  $ENCRYPTION_MASTER_KEY"
fi

# Auto-generate JWT_SECRET as env var (relay will use it if instance_settings doesn't have one)
if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET=$(openssl rand -hex 64)
fi

# Run database migrations
echo "Running database migrations..."
node packages/relay/dist/migrate.js 2>/dev/null || echo "Migrations skipped (will run on first setup)"

# Start the relay server
exec node packages/relay/dist/index.js
