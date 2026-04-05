# Getting Started

This guide walks you through deploying Tadaima and downloading your first file.

## Step 1: Deploy the Relay

### Option A: Railway (Recommended)

1. Click **Deploy on Railway** from the [GitHub README](https://github.com/psychout98/tadaima)
2. Railway provisions the relay server and PostgreSQL automatically
3. Once deployed, open your Railway app URL

### Option B: Docker Compose (Self-Hosted)

```bash
curl -O https://raw.githubusercontent.com/psychout98/tadaima/main/docker-compose.prod.yml

# Generate an encryption key
export ENCRYPTION_MASTER_KEY=$(openssl rand -hex 32)
echo "Save this key: $ENCRYPTION_MASTER_KEY"

docker compose -f docker-compose.prod.yml up -d
```

Access at `http://your-server:3000`.

## Step 2: Setup Wizard

Open the relay URL. The setup wizard guides you through:

1. **Admin Account** — Pick a username and password (min 8 characters)
2. **TMDB API Key** — Get a free key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
3. **Real-Debrid API Key** — Get yours at [real-debrid.com/apitoken](https://real-debrid.com/apitoken)
4. **First Profile** — Create your profile (name + avatar color)

## Step 3: Install the Agent

The agent runs on the machine where you want files downloaded.

### npm (All Platforms)

```bash
npm install -g @tadaima/agent
```

### Docker

See [Self-Hosting Guide](self-hosting.md) for Docker agent setup.

## Step 4: Pair Your Device

1. In the web app, go to **Devices** and click **Pair New Device**
2. A 6-character code appears
3. On your machine, run:

```bash
tadaima-agent setup
```

4. Enter the relay URL and pairing code when prompted
5. Choose your Movies and TV Shows directories
6. Done! Your device appears on the Devices page.

## Step 5: Start the Agent

```bash
tadaima-agent start
```

The connection indicator in the web app sidebar turns green.

## Step 6: Download Something

1. Go to **Search** in the web app
2. Search for a movie or TV show
3. Click a result to see available streams
4. Use filters (resolution, HDR, audio) to find what you want
5. Click **Download**
6. Watch progress in real-time on the **Downloads** page

When the download completes, you'll see a toast notification.

## Running as a Background Service

To keep the agent running after you close the terminal:

```bash
# Daemon mode
tadaima-agent start -d

# Or install as a system service (auto-starts on boot)
tadaima-agent install-service
```
