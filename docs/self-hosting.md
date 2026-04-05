# Self-Hosting Guide

Run Tadaima entirely on your own hardware — no cloud services required.

## Docker Compose

### Requirements

- Docker and Docker Compose
- A machine that stays on (NAS, home server, VPS)

### Setup

```bash
# Download the compose file
curl -O https://raw.githubusercontent.com/psychout98/tadaima/main/docker-compose.prod.yml

# Generate and save your encryption key
export ENCRYPTION_MASTER_KEY=$(openssl rand -hex 32)
echo "ENCRYPTION_MASTER_KEY=$ENCRYPTION_MASTER_KEY" > .env

# Start
docker compose -f docker-compose.prod.yml up -d
```

The relay is now running at `http://your-server:3000`.

### Updating

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Agent via Docker

For running the agent as a Docker container (e.g., on a NAS):

```yaml
services:
  tadaima-agent:
    image: ghcr.io/psychout98/tadaima/agent:latest
    environment:
      - RELAY_URL=http://your-server:3000
      - DEVICE_TOKEN=your-device-token
    volumes:
      - /path/to/movies:/media/movies
      - /path/to/tv:/media/tv
    restart: unless-stopped
```

To get a device token: pair via the web UI, then use the token from the agent setup or extract from config.

## Remote Access

If you want to access Tadaima from outside your home network:

### Tailscale (Recommended)

Install [Tailscale](https://tailscale.com) on your server and devices. Access via your Tailscale IP.

### Cloudflare Tunnel

Set up a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for a custom domain without port forwarding.

### Reverse Proxy (nginx/Caddy)

If you have a domain and want HTTPS:

```
# Caddy example
tadaima.yourdomain.com {
    reverse_proxy localhost:3000
}
```

**Important**: WebSocket connections need to be proxied. Most reverse proxies handle this automatically, but check your config supports the `Upgrade` header.

## Data & Backups

- **Database**: PostgreSQL data stored in the `pgdata` Docker volume
- **Config**: Agent config at `~/.config/tadaima/config.json`
- **Encryption key**: Save your `ENCRYPTION_MASTER_KEY` — it's needed to decrypt API keys stored in the database

### Backup the Database

```bash
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U tadaima tadaima > backup.sql
```

### Restore

```bash
docker compose -f docker-compose.prod.yml exec -i postgres psql -U tadaima tadaima < backup.sql
```
