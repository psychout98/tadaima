# Phase 3: Device Pairing — Detailed Spec

> **Goal**: Agents pair to profiles using a short-code flow. The web app shows a devices page with pair/rename/revoke controls. The agent CLI has `tadaima setup` that walks through pairing and automatically receives the RD API key.

---

## 1. Database Schema

### 1.1 New Tables

#### `pairing_codes`

Temporary codes used to claim devices without pre-sharing credentials.

```sql
CREATE TABLE pairing_codes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,              -- 6 alphanumeric, no ambiguous chars
  rd_api_key TEXT NOT NULL,               -- RD key from instance settings (copied at code generation time)
  claimed_at TIMESTAMPTZ,                 -- NULL until claimed
  claimed_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (claimed_at IS NULL OR claimed_device_id IS NOT NULL)
);

CREATE INDEX idx_pairing_codes_profile_id ON pairing_codes(profile_id);
CREATE INDEX idx_pairing_codes_code ON pairing_codes(code);
CREATE INDEX idx_pairing_codes_expires_at ON pairing_codes(expires_at);
```

#### `devices`

Paired agents/clients for a profile.

```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                      -- e.g., "noah-macbook", "nas-server"
  device_name_canonical TEXT NOT NULL,     -- lowercase normalized for deduplication
  platform TEXT NOT NULL,                  -- "windows", "macos", "linux", "docker"
  token_hash TEXT NOT NULL UNIQUE,         -- SHA-256 of JWT token
  is_default BOOLEAN NOT NULL DEFAULT false,
  paired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT max_five_devices_per_profile
    CHECK ((SELECT COUNT(*) FROM devices WHERE profile_id = devices.profile_id) <= 5)
);

CREATE UNIQUE INDEX idx_devices_profile_default
  ON devices(profile_id)
  WHERE is_default = true;
CREATE INDEX idx_devices_profile_id ON devices(profile_id);
CREATE INDEX idx_devices_paired_at ON devices(paired_at);
```

---

## 2. Relay Pairing Service

### 2.1 Pairing Code Generation

**Function**: `generatePairingCode(charset?: string): string`

**Charset rules**:
- Default charset: `"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"`
  - Excludes: `I, O, 0 (zero), 1 (one)` to avoid visual ambiguity
  - Include: uppercase letters + digits 2-9
- Length: 6 characters
- Randomness: use `crypto.getRandomValues()` (no bias, uniform distribution)

**Algorithm**:
```typescript
function generatePairingCode(charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += charset[bytes[i] % charset.length];
  }
  return code;
}
```

**Storage**:
- Insert into `pairing_codes` table with:
  - `code`: generated 6-char string
  - `profile_id`: from authenticated session
  - `rd_api_key`: copy of `instance_settings.rd_api_key` (captured at code generation time — this snapshot prevents key rotation race conditions)
  - `expires_at`: `now() + 10 minutes`
  - `claimed_at`: NULL
  - `claimed_device_id`: NULL

**One active code per profile**:
- On code generation, delete all expired codes for this profile: `DELETE FROM pairing_codes WHERE profile_id = ? AND expires_at < now()`
- Allow ONE unclaimed code per profile at a time:
  - If a profile already has an unclaimed code, return 409 Conflict with message `"Code already requested. Use or wait for expiry."`
  - Otherwise, generate and insert new code

**Expiry check**:
- When claiming (see 2.3), verify `expires_at > now()` — if not, return 404 (code not found / expired)
- Optionally, add a background task (Phase 4+) to clean up expired codes

### 2.2 Pairing Code Claim Logic

**Endpoint**: `POST /api/devices/pair/claim`

**Request**:
```json
{
  "code": "A7X9K2",
  "deviceName": "noah-macbook",
  "platform": "macos"
}
```

**Validation**:
1. Check code exists and is not expired: `SELECT * FROM pairing_codes WHERE code = ? AND expires_at > now()`
   - If not found or expired: return **404** with message `"Invalid or expired pairing code"`
2. Check if code already claimed (`claimed_at IS NOT NULL`)
   - If so: return **409** with message `"Code has already been claimed"`
3. Check device count for profile: `SELECT COUNT(*) FROM devices WHERE profile_id = (SELECT profile_id FROM pairing_codes WHERE code = ?)`
   - If count >= 5: return **400** with message `"Maximum 5 devices per profile reached"`
4. Normalize `deviceName` (trim, convert to lowercase, replace spaces with `-`) and check for duplicate within profile
   - If exists: return **409** with message `"Device name already exists on this profile"`

**Claim process**:
1. Fetch the pairing code row (with profile_id and rd_api_key snapshot)
2. Generate device token (see 2.4)
3. Hash the token (SHA-256)
4. Insert into `devices` table:
   - `id`: auto UUID
   - `profile_id`: from pairing code
   - `name`: from request (preserved case for display)
   - `device_name_canonical`: normalized (lowercase, hyphens)
   - `platform`: from request
   - `token_hash`: SHA-256 hash
   - `is_default`: true if this is the first device for the profile, false otherwise
5. Update pairing code: `claimed_at = now()`, `claimed_device_id = <new device id>`
6. Return **200** with response (see 2.5)

### 2.3 Device Token Generation

**Structure**: JWT with no expiry (long-lived, revocable via token hash deletion).

**JWT Payload**:
```json
{
  "sub": "profile-uuid",
  "type": "device",
  "deviceId": "device-uuid",
  "iat": <unix seconds>,
  "jti": "random-uuid"
}
```

**Details**:
- `sub`: profile ID (subject — who owns this device)
- `type`: "device" (distinguishes from other token types, e.g., "admin")
- `deviceId`: device UUID (identifies this specific device)
- `iat`: issued-at timestamp (UNIX seconds)
- `jti`: JWT ID (random UUID, one per token — used for revocation lookups in `token_hash`)
- **No `exp` field**: tokens are revocable via the `devices` table, not time-based

**Signing**:
- Use relay instance's private key (established in Phase 1)
- Algorithm: HS256 (secret-based, simple)
- The token must be verifiable by the agent using the same secret or public key

**Storage**:
- Compute SHA-256 hash of the token: `hash = sha256(token)`
- Store hash in `devices.token_hash` (not the token itself)
- Return the plain token in the claim response — the agent receives it and includes it in future requests as `Authorization: Bearer <token>`

**Verification** (for protected endpoints):
- Extract token from `Authorization: Bearer <token>` header
- Verify JWT signature
- Check `devices.token_hash` contains sha256(token) to confirm the device exists and hasn't been revoked
- Proceed if both checks pass

### 2.4 RD Key Distribution

**Current behavior**:
- At code generation time (`POST /api/devices/pair/request`), snapshot the current `instance_settings.rd_api_key` into the `pairing_codes` row
- At code claim time, retrieve that snapshot and include it in the response

**Response** (from claim endpoint):
```json
{
  "deviceId": "uuid",
  "deviceToken": "eyJ...",
  "rdApiKey": "captured-snapshot-from-code-generation",
  "wsUrl": "wss://your-instance.up.railway.app/ws",
  "relayUrl": "https://your-instance.up.railway.app"
}
```

**RD Key Rotation Recovery**:
- When an agent's RD call (via relay or direct) returns **401** or **403**, the agent fetches the current key via:
  ```
  GET /api/agent/config
  Authorization: Bearer <device-token>
  ```
- Response:
  ```json
  {
    "rdApiKey": "new-key-from-instance-settings",
    "relayVersion": "1.0.0"
  }
  ```
- Agent updates its local config and retries the RD call

---

## 3. Relay Device Management Endpoints

### 3.1 GET /api/devices

List all devices for the authenticated profile.

**Authentication**: Session cookie (profile session from web app)

**Response** (200 OK):
```json
{
  "devices": [
    {
      "id": "uuid",
      "name": "noah-macbook",
      "platform": "macos",
      "isDefault": true,
      "pairedAt": "2026-04-04T10:30:00Z",
      "lastSeenAt": "2026-04-04T15:45:23Z",
      "isOnline": false
    },
    {
      "id": "uuid2",
      "name": "nas-server",
      "platform": "linux",
      "isDefault": false,
      "pairedAt": "2026-04-04T11:00:00Z",
      "lastSeenAt": null,
      "isOnline": false
    }
  ]
}
```

**Notes**:
- `isOnline` is computed from `lastSeenAt` (true if within last 5 minutes; see Phase 4 for WebSocket heartbeat)
- `lastSeenAt` is updated when agent connects/sends data (Phase 4)
- Sorted by `pairedAt` ascending (oldest first)

### 3.2 PATCH /api/devices/:id

Update device name or default status.

**Authentication**: Session cookie

**Request**:
```json
{
  "name": "new-name",
  "isDefault": true
}
```

**Validations**:
- Device must belong to authenticated profile
- If `name` is provided:
  - Normalize (trim, lowercase, hyphens)
  - Check for duplicates in profile (return 409 if found)
  - Update `devices.name` (preserve case) and `device_name_canonical`
- If `isDefault` is true:
  - Set all other devices for profile to `is_default = false`
  - Set this device to `is_default = true`

**Response** (200 OK):
```json
{
  "id": "uuid",
  "name": "updated-name",
  "platform": "macos",
  "isDefault": true,
  "pairedAt": "2026-04-04T10:30:00Z",
  "lastSeenAt": "2026-04-04T15:45:23Z"
}
```

**Errors**:
- **404** if device not found or belongs to another profile
- **409** if name already exists on this profile

### 3.3 DELETE /api/devices/:id

Revoke a device (permanent, cannot be undone).

**Authentication**: Session cookie

**Validations**:
- Device must belong to authenticated profile

**Process**:
1. Delete row from `devices` table
2. In Phase 4 (WebSocket), close the device's connection if connected
3. If device was default and other devices exist, set first remaining device as default

**Response** (204 No Content)

**Errors**:
- **404** if device not found or belongs to another profile

### 3.4 POST /api/devices/pair/request

Generate a new pairing code for the authenticated profile.

**Authentication**: Session cookie

**Response** (200 OK):
```json
{
  "code": "A7X9K2",
  "expiresAt": "2026-04-04T10:10:00Z"
}
```

**Errors**:
- **409** if profile already has an active unclaimed code:
  ```json
  {
    "error": "Code already requested. Use or wait for expiry.",
    "expiresAt": "2026-04-04T10:05:00Z"
  }
  ```

### 3.5 POST /api/devices/pair/claim

Claim a pairing code. Returns device credentials.

**Authentication**: None (public endpoint)

**Request**:
```json
{
  "code": "A7X9K2",
  "deviceName": "noah-macbook",
  "platform": "macos"
}
```

**Response** (200 OK):
```json
{
  "deviceId": "uuid",
  "deviceToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "rdApiKey": "captured-from-pairing-code-generation",
  "wsUrl": "wss://your-instance.up.railway.app/ws",
  "relayUrl": "https://your-instance.up.railway.app"
}
```

**Errors**:
- **400**: `"Invalid or expired pairing code"` (code not found, expired, or invalid format)
- **409**: `"Code has already been claimed"` (claimed_at is not NULL)
- **409**: `"Device name already exists on this profile"` (duplicate name)
- **400**: `"Maximum 5 devices per profile reached"`

### 3.6 GET /api/agent/config

Fetch current relay config (used for RD key rotation recovery). Authenticated via device token.

**Authentication**: `Authorization: Bearer <device-token>`

**Request**: None (GET)

**Response** (200 OK):
```json
{
  "rdApiKey": "current-rd-key-from-instance-settings",
  "relayVersion": "1.0.0",
  "wsUrl": "wss://your-instance.up.railway.app/ws"
}
```

**Errors**:
- **401**: `"Invalid or expired device token"`
- **404**: `"Device not found or has been revoked"`

---

## 4. Agent CLI Setup Flow

### 4.1 CLI Entry Point: `tadaima setup`

**Command structure**:
```
tadaima setup [--relay-url <url>] [--pairing-code <code>] [--interactive]
```

**Flags**:
- `--relay-url`: skip prompt, use this relay URL (useful for scripting)
- `--pairing-code`: skip prompt, use this code (useful for scripting)
- `--interactive`: force interactive mode (default if no flags provided)

**Exit codes**:
- 0: success
- 1: user cancelled
- 2: validation error (invalid URL, code rejected by server, etc.)
- 3: network error (cannot reach relay)

### 4.2 Interactive Flow (using `prompts` library)

The agent uses **`prompts@~2.4.0`** for terminal UI (not `inquirer` — prompts is lighter-weight and ESM-native).

**Step-by-step flow**:

```
✓ Tadaima Setup
──────────────────────────────────────────

? Relay server URL: ›

? Pairing code (from web app): ›

Connecting to relay...
✓ Code validated (expires in 7 minutes)

? Device name (auto-detected "noah-macbook"): ›
? Platform (auto-detected "macos"): ›

? Movies directory: ›

? TV shows directory: ›

✓ Connected! Device "noah-macbook" is now paired to profile "Noah".
✓ Config written to ~/.config/tadaima/config.json

Use 'tadaima start' to begin syncing.
```

**Step 1: Relay URL**

- Prompt: `"Relay server URL"`
- Validation:
  - Must be a valid HTTPS URL (for production) or HTTP (for localhost dev)
  - Format: `https://your-instance.up.railway.app` (or similar)
  - If user enters URL without protocol, prepend `https://`
  - If user enters just a domain, prepend `https://`
- On enter, make a test request to `GET <relay>/api/health` to verify connectivity
- If fails: show error, allow retry (up to 3 times, then exit with code 3)

**Step 2: Pairing Code**

- Prompt: `"Pairing code (from web app)"`
- Validation:
  - Must be 6 alphanumeric characters
  - Accept any case (normalize to uppercase when sent to server)
  - If invalid format: show error, allow retry
- Don't claim yet — just validate format locally

**Step 3: Validate Code on Server**

- Call `POST /api/devices/pair/request` is NOT needed here
- Instead, prepare to claim: fetch auto-detected values first, then claim

**Step 4: Platform Auto-Detection**

- Prompt: `"Platform (auto-detected '...')"`
- Auto-detect logic (see 4.3):
  - Windows: `process.platform === "win32"` → "windows"
  - macOS: `process.platform === "darwin"` → "macos"
  - Linux: `process.platform === "linux"` → "linux"
  - Docker: check for `/.dockerenv` file → "docker"
- Show auto-detected value as default
- Allow user to override (dropdown or text input)
- Options: `["windows", "macos", "linux", "docker"]`

**Step 5: Device Name Auto-Detection**

- Prompt: `"Device name (auto-detected '...')"`
- Auto-detect logic (see 4.4):
  - Try: `os.hostname()` (Node.js built-in)
  - Normalize: lowercase, replace spaces with `-`, keep alphanumeric + hyphens only
  - Example: `"Noah's MacBook Pro"` → `"noahs-macbook-pro"`
  - If hostname is too generic (e.g., "localhost", "raspberrypi", "VM"), suggest something better
- Show auto-detected value as default
- Allow user to override (text input)

**Step 6: Claim Pairing Code**

- Call `POST /api/devices/pair/claim` with:
  ```json
  {
    "code": "<uppercase code>",
    "deviceName": "<auto-detected or user input>",
    "platform": "<auto-detected or user input>"
  }
  ```
- Handle responses:
  - **200**: store credentials, proceed to step 7
  - **400 / 409**: show error (expired code, duplicate device name, max devices, etc.), exit with code 2
  - **Network error**: show error, exit with code 3

**Step 7: Movies Directory**

- Prompt: `"Movies directory"`
- Validation:
  - Must be an absolute path
  - If on Windows, accept both `/path` and `C:\path` formats
  - Normalize path (resolve `.` and `..`, remove trailing slashes)
  - Don't check if directory exists yet (it might be created later)
- Default suggestion: OS-specific media paths:
  - macOS: `~/Movies`, `~/Media`, or `/Volumes/Media/Movies`
  - Linux: `/mnt/media/Movies` or `/home/<user>/Movies`
  - Windows: `D:\Media\Movies` or `C:\Users\<user>\Videos`
  - Docker: `/mnt/media/Movies`

**Step 8: TV Shows Directory**

- Same as step 7, but for TV shows
- Default: same base as movies but with `TV` or `TV Shows`

**Step 9: Write Config**

- Create directories if they don't exist: `~/.config/tadaima/` and `~/.config/tadaima/cache/`
- Write config JSON to `~/.config/tadaima/config.json`
- Set permissions: `0600` (user read/write only) — this file contains the device token
- Show success message with device name and profile name (extracted from token)

**Step 10: Success**

- Print: `"✓ Connected! Device 'noah-macbook' is now paired to profile 'Noah'."`
- Print: `"Config written to ~/.config/tadaima/config.json"`
- Print: `"Use 'tadaima start' to begin syncing."`

### 4.3 Platform Auto-Detection

**Function**: `detectPlatform(): "windows" | "macos" | "linux" | "docker"`

```typescript
import { platform } from "os";
import { existsSync } from "fs";

function detectPlatform(): "windows" | "macos" | "linux" | "docker" {
  const nodePlatform = platform();

  // Check for Docker first
  if (existsSync("/.dockerenv")) {
    return "docker";
  }

  switch (nodePlatform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      return "linux"; // fallback
  }
}
```

### 4.4 Device Name Auto-Detection

**Function**: `detectDeviceName(): string`

```typescript
import { hostname } from "os";

function detectDeviceName(): string {
  const host = hostname().toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-") // remove non-alphanumeric (except . and -)
    .replace(/^[.-]+|[.-]+$/g, "") // trim leading/trailing . and -
    .replace(/\.+/g, "-")           // replace . with -
    .replace(/-+/g, "-")            // collapse multiple hyphens
    .substring(0, 63);              // max 63 chars

  // Avoid generic names
  if (["localhost", "raspberrypi", "vm", "docker"].includes(host)) {
    return "device-" + Math.random().toString(36).substring(2, 8);
  }

  return host || "tadaima-device";
}
```

---

## 5. Agent Config File Manager

### 5.1 Config File Location

**Path**: `~/.config/tadaima/config.json`

**Directory structure**:
```
~/.config/
└── tadaima/
    ├── config.json       # Main config (R/W, mode 0600)
    ├── cache/            # Cache dir for logs, temp files
    │   ├── logs/
    │   └── temp/
    └── state.json        # Runtime state (last sync time, etc.) — optional, Phase 4+
```

### 5.2 Config File Schema

```json
{
  "relay": "https://your-instance.up.railway.app",
  "deviceToken": "eyJ...",
  "deviceId": "device-uuid",
  "deviceName": "noah-macbook",
  "profileName": "Noah",
  "directories": {
    "movies": "/home/noah/Movies",
    "tv": "/home/noah/TV",
    "staging": "/tmp/tadaima/staging"
  },
  "realDebrid": {
    "apiKey": "received-during-pairing-setup"
  },
  "maxConcurrentDownloads": 2,
  "rdPollInterval": 30
}
```

**Schema validation** (strict):
- `relay`: string, must be valid HTTPS URL
- `deviceToken`: string, non-empty
- `deviceId`: string, valid UUID format
- `deviceName`: string, 1-63 characters
- `profileName`: string, 1-255 characters
- `directories.movies`: string, absolute path
- `directories.tv`: string, absolute path
- `directories.staging`: string, absolute path
- `realDebrid.apiKey`: string, non-empty
- `maxConcurrentDownloads`: number, 1-10
- `rdPollInterval`: number, 5-300 (seconds)

### 5.3 Config File Manager Class

Use **`conf@~13.0.0`** for the config manager (lightweight, ESM, no async needed).

**Implementation**:

```typescript
import Conf from "conf";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve, homedir } from "path";
import { strict as assert } from "assert";

interface ConfigSchema {
  relay: string;
  deviceToken: string;
  deviceId: string;
  deviceName: string;
  profileName: string;
  directories: {
    movies: string;
    tv: string;
    staging: string;
  };
  realDebrid: {
    apiKey: string;
  };
  maxConcurrentDownloads: number;
  rdPollInterval: number;
}

export class ConfigManager {
  private conf: Conf<ConfigSchema>;

  constructor() {
    const configDir = resolve(homedir(), ".config", "tadaima");
    const cacheDir = resolve(configDir, "cache");

    // Ensure directories exist
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    }

    this.conf = new Conf<ConfigSchema>({
      cwd: configDir,
      configName: "config",
      fileMode: 0o600, // user read/write only
      defaults: {
        relay: "",
        deviceToken: "",
        deviceId: "",
        deviceName: "",
        profileName: "",
        directories: {
          movies: "",
          tv: "",
          staging: "",
        },
        realDebrid: {
          apiKey: "",
        },
        maxConcurrentDownloads: 2,
        rdPollInterval: 30,
      },
    });
  }

  /**
   * Load and validate existing config
   * Throws if config file doesn't exist or is invalid
   */
  load(): ConfigSchema {
    try {
      const data = this.conf.store;
      this.validate(data);
      return data;
    } catch (error) {
      throw new Error(`Failed to load config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if config exists
   */
  exists(): boolean {
    return this.conf.has("relay") && Boolean(this.conf.get("relay"));
  }

  /**
   * Save config from pairing response
   */
  savePairingResponse(options: {
    relay: string;
    deviceToken: string;
    deviceId: string;
    deviceName: string;
    profileName: string;
    rdApiKey: string;
    moviesDir: string;
    tvDir: string;
  }): void {
    const stagingDir = resolve(homedir(), ".config", "tadaima", "staging");
    if (!existsSync(stagingDir)) {
      mkdirSync(stagingDir, { recursive: true, mode: 0o755 });
    }

    const config: ConfigSchema = {
      relay: options.relay,
      deviceToken: options.deviceToken,
      deviceId: options.deviceId,
      deviceName: options.deviceName,
      profileName: options.profileName,
      directories: {
        movies: options.moviesDir,
        tv: options.tvDir,
        staging: stagingDir,
      },
      realDebrid: {
        apiKey: options.rdApiKey,
      },
      maxConcurrentDownloads: 2,
      rdPollInterval: 30,
    };

    this.validate(config);
    this.conf.store = config;
  }

  /**
   * Get a single config value
   */
  get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] {
    return this.conf.get(key);
  }

  /**
   * Set a single config value
   */
  set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
    this.conf.set(key, value);
  }

  /**
   * Validate config schema
   */
  private validate(data: any): void {
    assert(typeof data.relay === "string" && data.relay.length > 0, "relay must be a non-empty string");
    assert(typeof data.deviceToken === "string" && data.deviceToken.length > 0, "deviceToken is required");
    assert(typeof data.deviceId === "string" && data.deviceId.length > 0, "deviceId is required");
    assert(typeof data.deviceName === "string" && data.deviceName.length > 0, "deviceName is required");
    assert(typeof data.profileName === "string" && data.profileName.length > 0, "profileName is required");
    assert(data.directories && typeof data.directories === "object", "directories is required");
    assert(typeof data.directories.movies === "string", "directories.movies must be a string");
    assert(typeof data.directories.tv === "string", "directories.tv must be a string");
    assert(typeof data.directories.staging === "string", "directories.staging must be a string");
    assert(data.realDebrid && typeof data.realDebrid === "object", "realDebrid config is required");
    assert(typeof data.realDebrid.apiKey === "string" && data.realDebrid.apiKey.length > 0, "realDebrid.apiKey is required");
    assert(typeof data.maxConcurrentDownloads === "number" && data.maxConcurrentDownloads >= 1 && data.maxConcurrentDownloads <= 10, "maxConcurrentDownloads must be 1-10");
    assert(typeof data.rdPollInterval === "number" && data.rdPollInterval >= 5 && data.rdPollInterval <= 300, "rdPollInterval must be 5-300 seconds");
  }
}
```

### 5.4 Usage in Setup Flow

In the setup command:

```typescript
import { ConfigManager } from "./lib/ConfigManager";

async function setupCommand() {
  const configManager = new ConfigManager();

  // Check if already configured
  if (configManager.exists()) {
    console.log("Already configured. Use 'tadaima config set' to update.");
    process.exit(0);
  }

  // ... prompt flow (steps 1-8) ...

  const claimResponse = await fetch(
    `${relayUrl}/api/devices/pair/claim`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: pairingCode.toUpperCase(),
        deviceName: deviceName,
        platform: platformValue,
      }),
    },
  ).then((r) => r.json());

  configManager.savePairingResponse({
    relay: relayUrl,
    deviceToken: claimResponse.deviceToken,
    deviceId: claimResponse.deviceId,
    deviceName: deviceName,
    profileName: extractProfileFromToken(claimResponse.deviceToken),
    rdApiKey: claimResponse.rdApiKey,
    moviesDir: moviesPath,
    tvDir: tvPath,
  });

  console.log(`✓ Config written to ~/.config/tadaima/config.json`);
}
```

---

## 6. Web Devices Page

### 6.1 Component Structure

**File layout**:
```
packages/web/src/
├── components/
│   ├── DevicesPage/
│   │   ├── DevicesPage.tsx          # Main page wrapper
│   │   ├── DeviceList.tsx           # List of device cards
│   │   ├── DeviceCard.tsx           # Single device card
│   │   ├── PairingModal.tsx         # Modal for pairing new device
│   │   ├── RenameDialog.tsx         # Inline rename input
│   │   ├── RevokeConfirmDialog.tsx  # Confirm revoke dialog
│   │   └── styles.css               # Component styles (optional, can be inline Tailwind)
│   └── ...
└── ...
```

### 6.2 DevicesPage Component

Main page that fetches and manages devices.

```typescript
import { useState, useEffect } from "react";
import { DeviceList } from "./DeviceList";
import { PairingModal } from "./PairingModal";

export function DevicesPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPairingModal, setShowPairingModal] = useState(false);

  // Fetch devices on mount
  useEffect(() => {
    fetchDevices();
  }, []);

  async function fetchDevices() {
    try {
      setLoading(true);
      const res = await fetch("/api/devices");
      if (!res.ok) throw new Error("Failed to fetch devices");
      const data = await res.json();
      setDevices(data.devices);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="p-4">Loading devices...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-500">Error: {error}</div>;
  }

  if (devices.length === 0) {
    return (
      <div className="p-4 text-center">
        <h2 className="text-lg font-semibold">No devices paired yet</h2>
        <p className="text-gray-400">Install the agent on your machine to get started.</p>
        <button
          onClick={() => setShowPairingModal(true)}
          className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded"
        >
          Pair new device
        </button>
        {showPairingModal && (
          <PairingModal
            onClose={() => {
              setShowPairingModal(false);
              fetchDevices();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Devices</h2>
        <button
          onClick={() => setShowPairingModal(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-sm"
        >
          + Pair new device
        </button>
      </div>

      <DeviceList devices={devices} onDeviceUpdate={fetchDevices} />

      {showPairingModal && (
        <PairingModal
          onClose={() => {
            setShowPairingModal(false);
            fetchDevices();
          }}
        />
      )}
    </div>
  );
}
```

### 6.3 PairingModal Component

Modal that displays pairing code and countdown timer.

```typescript
import { useState, useEffect } from "react";

interface PairingModalProps {
  onClose: () => void;
}

export function PairingModal({ onClose }: PairingModalProps) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Request pairing code
  useEffect(() => {
    async function requestCode() {
      try {
        const res = await fetch("/api/devices/pair/request", { method: "POST" });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed to generate code");
        }
        const data = await res.json();
        setCode(data.code);
        setExpiresAt(new Date(data.expiresAt));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    requestCode();
  }, []);

  // Update countdown timer
  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const now = new Date();
      const diff = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
      setTimeRemaining(diff);

      if (diff === 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-gray-900 p-6 rounded-lg max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Pair new device</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {loading && (
          <div className="text-center text-gray-400">
            Generating code...
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700 p-3 rounded text-red-200">
            {error}
          </div>
        )}

        {code && (
          <div>
            <p className="text-sm text-gray-400 mb-4">
              Enter this code in the agent CLI:
            </p>

            <div className="bg-gray-800 p-6 rounded text-center mb-4">
              <div className="text-4xl font-bold font-mono tracking-widest">
                {code}
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="mt-2 text-sm text-indigo-400 hover:text-indigo-300"
              >
                Copy
              </button>
            </div>

            {timeRemaining !== null && (
              <div className="text-center text-sm text-gray-400 mb-4">
                Expires in {formatTime(timeRemaining)}
              </div>
            )}

            <div className="bg-gray-800 p-4 rounded text-sm text-gray-300">
              <p className="font-semibold mb-2">On your machine, run:</p>
              <code className="block bg-black p-2 rounded mt-2">
                $ tadaima setup
              </code>
              <p className="mt-2">Paste the code when prompted.</p>
            </div>

            {code && (
              <div className="mt-4 text-xs text-gray-500 text-center">
                The code will be automatically marked as claimed when the agent connects.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

### 6.4 DeviceCard Component

Individual device display with edit/rename/revoke actions.

```typescript
import { useState } from "react";
import { RenameDialog } from "./RenameDialog";
import { RevokeConfirmDialog } from "./RevokeConfirmDialog";

interface Device {
  id: string;
  name: string;
  platform: "windows" | "macos" | "linux" | "docker";
  isDefault: boolean;
  pairedAt: string;
  lastSeenAt: string | null;
  isOnline: boolean;
}

interface DeviceCardProps {
  device: Device;
  onUpdate: () => void;
}

export function DeviceCard({ device, onUpdate }: DeviceCardProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [updating, setUpdating] = useState(false);

  const platformIcon: Record<string, string> = {
    windows: "🪟",
    macos: "🍎",
    linux: "🐧",
    docker: "🐳",
  };

  const handleSetDefault = async () => {
    if (device.isDefault) return;
    setUpdating(true);
    try {
      await fetch(`/api/devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      onUpdate();
    } finally {
      setUpdating(false);
    }
  };

  const handleRevoke = async () => {
    setUpdating(true);
    try {
      await fetch(`/api/devices/${device.id}`, { method: "DELETE" });
      onUpdate();
    } finally {
      setUpdating(false);
    }
  };

  const lastSeen = device.lastSeenAt
    ? new Date(device.lastSeenAt).toLocaleString()
    : "Never";

  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 flex-1">
          <span className="text-2xl">{platformIcon[device.platform] || "💻"}</span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-lg font-semibold">{device.name}</h4>
              {device.isDefault && (
                <span className="text-yellow-400 text-sm">★ Default</span>
              )}
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  device.isOnline ? "bg-green-500" : "bg-gray-500"
                }`}
              />
            </div>
            <p className="text-sm text-gray-400">
              Paired {new Date(device.pairedAt).toLocaleDateString()} • Last seen {lastSeen}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {!device.isDefault && (
            <button
              onClick={handleSetDefault}
              disabled={updating}
              className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
            >
              Set default
            </button>
          )}
          <button
            onClick={() => setIsRenaming(true)}
            disabled={updating}
            className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            Rename
          </button>
          <button
            onClick={() => setIsRevoking(true)}
            disabled={updating}
            className="px-3 py-1 text-sm bg-red-900/50 hover:bg-red-900 rounded disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>

      {isRenaming && (
        <RenameDialog
          device={device}
          onClose={() => setIsRenaming(false)}
          onSave={onUpdate}
        />
      )}

      {isRevoking && (
        <RevokeConfirmDialog
          deviceName={device.name}
          onConfirm={handleRevoke}
          onCancel={() => setIsRevoking(false)}
        />
      )}
    </div>
  );
}
```

### 6.5 Supporting Components

**RenameDialog.tsx**:
```typescript
import { useState } from "react";

interface RenamDialogProps {
  device: { id: string; name: string };
  onClose: () => void;
  onSave: () => void;
}

export function RenameDialog({ device, onClose, onSave }: RenamDialogProps) {
  const [newName, setNewName] = useState(device.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to rename");
      }
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-gray-900 p-6 rounded-lg max-w-sm w-full">
        <h3 className="text-lg font-semibold mb-4">Rename device</h3>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white mb-4"
          autoFocus
        />
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !newName}
            className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

**RevokeConfirmDialog.tsx**:
```typescript
interface RevokeConfirmDialogProps {
  deviceName: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function RevokeConfirmDialog({
  deviceName,
  onConfirm,
  onCancel,
}: RevokeConfirmDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-gray-900 p-6 rounded-lg max-w-sm w-full">
        <h3 className="text-lg font-semibold mb-2">Remove device?</h3>
        <p className="text-gray-400 mb-6">
          This will revoke {deviceName}. It cannot be undone.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 bg-red-900 hover:bg-red-800 rounded"
          >
            Remove
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

**DeviceList.tsx**:
```typescript
import { DeviceCard } from "./DeviceCard";

interface Device {
  id: string;
  name: string;
  platform: string;
  isDefault: boolean;
  pairedAt: string;
  lastSeenAt: string | null;
  isOnline: boolean;
}

interface DeviceListProps {
  devices: Device[];
  onDeviceUpdate: () => void;
}

export function DeviceList({ devices, onDeviceUpdate }: DeviceListProps) {
  return (
    <div className="space-y-4">
      {devices.map((device) => (
        <DeviceCard key={device.id} device={device} onUpdate={onDeviceUpdate} />
      ))}
    </div>
  );
}
```

---

## 7. New Dependencies

### 7.1 Agent Package

Add to `packages/agent/package.json`:

```jsonc
{
  "dependencies": {
    "@tadaima/shared": "workspace:*",
    "conf": "~13.0.0",
    "prompts": "~2.4.0"
  }
}
```

> **✅ RESOLVED**: Use `conf@~13.0.0` — lightweight, ESM-native, file-based, atomic writes, good TypeScript support.

> **✅ RESOLVED**: Use `prompts@~2.4.0` — lightweight, ESM-native, async/await friendly. Sufficient for the setup flow.

### 7.2 Relay Package

No new production dependencies. The relay already has Hono with full middleware support.

Testing will use `vitest` (already installed).

---

## 8. Implementation Files

### 8.1 Relay Files to Create

**`packages/relay/src/services/PairingService.ts`**

Core pairing logic (code generation, claim, etc.).

```typescript
import { crypto } from "node:crypto";
import { db } from "../db";

const PAIRING_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_EXPIRY_MINUTES = 10;

export class PairingService {
  static generateCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH));
    let code = "";
    for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
      code += PAIRING_CODE_CHARSET[bytes[i] % PAIRING_CODE_CHARSET.length];
    }
    return code;
  }

  static async requestCode(profileId: string, rdApiKey: string) {
    // Delete expired codes for this profile
    await db.query(
      "DELETE FROM pairing_codes WHERE profile_id = $1 AND expires_at < now()",
      [profileId],
    );

    // Check for existing unclaimed code
    const existing = await db.query(
      "SELECT code, expires_at FROM pairing_codes WHERE profile_id = $1 AND claimed_at IS NULL",
      [profileId],
    );

    if (existing.rows.length > 0) {
      return {
        error: "Code already requested. Use or wait for expiry.",
        expiresAt: existing.rows[0].expires_at,
      };
    }

    // Generate and insert new code
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_EXPIRY_MINUTES * 60 * 1000);

    await db.query(
      `INSERT INTO pairing_codes (profile_id, code, rd_api_key, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [profileId, code, rdApiKey, expiresAt],
    );

    return { code, expiresAt };
  }

  static async claimCode(code: string, deviceName: string, platform: string) {
    // Fetch code row
    const codeRow = await db.query(
      `SELECT id, profile_id, rd_api_key, claimed_at, expires_at
       FROM pairing_codes
       WHERE code = $1`,
      [code.toUpperCase()],
    );

    if (codeRow.rows.length === 0 || codeRow.rows[0].expires_at < new Date()) {
      return { error: "Invalid or expired pairing code", status: 404 };
    }

    const row = codeRow.rows[0];

    if (row.claimed_at !== null) {
      return { error: "Code has already been claimed", status: 409 };
    }

    // Check device count
    const deviceCount = await db.query(
      "SELECT COUNT(*) FROM devices WHERE profile_id = $1",
      [row.profile_id],
    );

    if (parseInt(deviceCount.rows[0].count, 10) >= 5) {
      return { error: "Maximum 5 devices per profile reached", status: 400 };
    }

    // Check for duplicate device name
    const normalizedName = deviceName.toLowerCase().replace(/\s+/g, "-");
    const duplicate = await db.query(
      `SELECT id FROM devices
       WHERE profile_id = $1 AND device_name_canonical = $2`,
      [row.profile_id, normalizedName],
    );

    if (duplicate.rows.length > 0) {
      return { error: "Device name already exists on this profile", status: 409 };
    }

    // Generate device token
    const token = await this.generateDeviceToken(row.profile_id);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Insert device
    const isFirst =
      parseInt(deviceCount.rows[0].count, 10) === 0;
    const deviceResult = await db.query(
      `INSERT INTO devices (profile_id, name, device_name_canonical, platform, token_hash, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [row.profile_id, deviceName, normalizedName, platform, tokenHash, isFirst],
    );

    const deviceId = deviceResult.rows[0].id;

    // Update pairing code
    await db.query(
      `UPDATE pairing_codes
       SET claimed_at = now(), claimed_device_id = $1
       WHERE id = $2`,
      [deviceId, row.id],
    );

    return {
      deviceId,
      deviceToken: token,
      rdApiKey: row.rd_api_key,
      wsUrl: process.env.WS_URL || "wss://your-instance.up.railway.app/ws",
      relayUrl: process.env.RELAY_URL || "https://your-instance.up.railway.app",
    };
  }

  private static async generateDeviceToken(profileId: string): Promise<string> {
    // JWT payload
    const payload = {
      sub: profileId,
      type: "device",
      deviceId: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID(),
    };

    // Sign JWT (using relay's signing key from Phase 1)
    // Note: exact implementation depends on JWT library used in Phase 1
    // Assuming `jsonwebtoken` is available
    const jwt = require("jsonwebtoken");
    const token = jwt.sign(payload, process.env.JWT_SECRET || "dev-secret");
    return token;
  }
}
```

**`packages/relay/src/routes/devices.ts`**

Device management endpoints.

```typescript
import { Hono } from "hono";
import { PairingService } from "../services/PairingService";

export const devicesRouter = new Hono()
  // GET /api/devices — list devices for authenticated profile
  .get("/", async (c) => {
    const profileId = c.get("profileId"); // from session middleware
    if (!profileId) return c.json({ error: "Unauthorized" }, 401);

    const result = await db.query(
      `SELECT id, name, platform, is_default, paired_at, last_seen_at
       FROM devices
       WHERE profile_id = $1
       ORDER BY paired_at ASC`,
      [profileId],
    );

    return c.json({
      devices: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        platform: row.platform,
        isDefault: row.is_default,
        pairedAt: row.paired_at.toISOString(),
        lastSeenAt: row.last_seen_at?.toISOString() || null,
        isOnline: row.last_seen_at && Date.now() - row.last_seen_at.getTime() < 5 * 60 * 1000,
      })),
    });
  })

  // PATCH /api/devices/:id — update device name or default
  .patch("/:id", async (c) => {
    const profileId = c.get("profileId");
    if (!profileId) return c.json({ error: "Unauthorized" }, 401);

    const deviceId = c.req.param("id");
    const { name, isDefault } = await c.req.json();

    // Verify device belongs to profile
    const device = await db.query(
      "SELECT * FROM devices WHERE id = $1 AND profile_id = $2",
      [deviceId, profileId],
    );

    if (device.rows.length === 0) {
      return c.json({ error: "Device not found" }, 404);
    }

    // Handle name update
    if (name) {
      const normalized = name.toLowerCase().replace(/\s+/g, "-");
      const duplicate = await db.query(
        `SELECT id FROM devices
         WHERE profile_id = $1 AND device_name_canonical = $2 AND id != $3`,
        [profileId, normalized, deviceId],
      );
      if (duplicate.rows.length > 0) {
        return c.json({ error: "Device name already exists" }, 409);
      }
      await db.query(
        `UPDATE devices SET name = $1, device_name_canonical = $2, updated_at = now()
         WHERE id = $3`,
        [name, normalized, deviceId],
      );
    }

    // Handle default flag
    if (isDefault) {
      await db.query(
        "UPDATE devices SET is_default = false WHERE profile_id = $1",
        [profileId],
      );
      await db.query(
        "UPDATE devices SET is_default = true WHERE id = $1",
        [deviceId],
      );
    }

    // Fetch updated device
    const updated = await db.query(
      "SELECT * FROM devices WHERE id = $1",
      [deviceId],
    );

    return c.json({
      id: updated.rows[0].id,
      name: updated.rows[0].name,
      platform: updated.rows[0].platform,
      isDefault: updated.rows[0].is_default,
      pairedAt: updated.rows[0].paired_at.toISOString(),
      lastSeenAt: updated.rows[0].last_seen_at?.toISOString() || null,
    });
  })

  // DELETE /api/devices/:id — revoke device
  .delete("/:id", async (c) => {
    const profileId = c.get("profileId");
    if (!profileId) return c.json({ error: "Unauthorized" }, 401);

    const deviceId = c.req.param("id");

    const device = await db.query(
      "SELECT * FROM devices WHERE id = $1 AND profile_id = $2",
      [deviceId, profileId],
    );

    if (device.rows.length === 0) {
      return c.json({ error: "Device not found" }, 404);
    }

    // Delete device
    await db.query("DELETE FROM devices WHERE id = $1", [deviceId]);

    // If deleted device was default, set another as default
    const remaining = await db.query(
      "SELECT id FROM devices WHERE profile_id = $1 ORDER BY paired_at ASC LIMIT 1",
      [profileId],
    );

    if (remaining.rows.length > 0) {
      await db.query(
        "UPDATE devices SET is_default = true WHERE id = $1",
        [remaining.rows[0].id],
      );
    }

    return c.json(null, 204);
  });

// Pairing endpoints (not under /devices/:id)
export const pairingRouter = new Hono()
  // POST /api/devices/pair/request — generate code
  .post("/request", async (c) => {
    const profileId = c.get("profileId");
    if (!profileId) return c.json({ error: "Unauthorized" }, 401);

    // Get RD API key from instance settings
    const instanceSettings = await db.query(
      "SELECT rd_api_key FROM instance_settings LIMIT 1",
    );

    if (instanceSettings.rows.length === 0 || !instanceSettings.rows[0].rd_api_key) {
      return c.json({ error: "RD API key not configured" }, 500);
    }

    const result = await PairingService.requestCode(
      profileId,
      instanceSettings.rows[0].rd_api_key,
    );

    if (result.error) {
      return c.json(result, 409);
    }

    return c.json({
      code: result.code,
      expiresAt: result.expiresAt.toISOString(),
    });
  })

  // POST /api/devices/pair/claim — claim code
  .post("/claim", async (c) => {
    const { code, deviceName, platform } = await c.req.json();

    const result = await PairingService.claimCode(code, deviceName, platform);

    if (result.error) {
      return c.json({ error: result.error }, result.status);
    }

    return c.json(result);
  });

// GET /api/agent/config — fetch current config (for RD key rotation recovery)
export const agentConfigRouter = new Hono()
  .get("/", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    // Verify device token
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const device = await db.query(
      "SELECT profile_id FROM devices WHERE token_hash = $1",
      [tokenHash],
    );

    if (device.rows.length === 0) {
      return c.json({ error: "Invalid or expired device token" }, 401);
    }

    const instanceSettings = await db.query(
      "SELECT rd_api_key FROM instance_settings LIMIT 1",
    );

    return c.json({
      rdApiKey: instanceSettings.rows[0].rd_api_key,
      relayVersion: "1.0.0",
      wsUrl: process.env.WS_URL || "wss://...",
    });
  });
```

### 8.2 Agent Files to Create

**`packages/agent/src/commands/setup.ts`**

Interactive setup command.

```typescript
import { readFileSync } from "fs";
import prompts from "prompts";
import { ConfigManager } from "../lib/ConfigManager";
import { detectPlatform } from "../lib/platform";
import { detectDeviceName } from "../lib/deviceName";
import { validateUrl, normalizeUrl } from "../lib/validation";

export async function setupCommand() {
  const configManager = new ConfigManager();

  if (configManager.exists()) {
    console.log("Already configured. Use 'tadaima config set' to update.");
    process.exit(0);
  }

  console.log("\n✓ Tadaima Setup");
  console.log("──────────────────────────────────────────\n");

  // Step 1: Relay URL
  const relayUrl = await prompts({
    type: "text",
    name: "value",
    message: "Relay server URL",
    validate: (value) => validateUrl(value) || "Invalid HTTPS URL",
  });

  const normalizedUrl = normalizeUrl(relayUrl.value);

  // Test connectivity
  try {
    const healthRes = await fetch(`${normalizedUrl}/api/health`);
    if (!healthRes.ok) throw new Error("Health check failed");
  } catch (err) {
    console.error(`✗ Cannot reach relay at ${normalizedUrl}`);
    process.exit(3);
  }

  // Step 2: Pairing Code
  const pairingCode = await prompts({
    type: "text",
    name: "value",
    message: "Pairing code (from web app)",
    validate: (value) => /^[A-Za-z0-9]{6}$/.test(value) || "Must be 6 alphanumeric characters",
  });

  // Step 3: Platform
  const autoPlatform = detectPlatform();
  const platform = await prompts({
    type: "select",
    name: "value",
    message: `Platform (auto-detected '${autoPlatform}')`,
    choices: [
      { title: "Windows", value: "windows" },
      { title: "macOS", value: "macos" },
      { title: "Linux", value: "linux" },
      { title: "Docker", value: "docker" },
    ],
    initial: ["windows", "macos", "linux", "docker"].indexOf(autoPlatform),
  });

  // Step 4: Device Name
  const autoDeviceName = detectDeviceName();
  const deviceName = await prompts({
    type: "text",
    name: "value",
    message: `Device name (auto-detected '${autoDeviceName}')`,
    initial: autoDeviceName,
  });

  // Step 5: Claim Code
  console.log("\nConnecting to relay...");
  const claimRes = await fetch(`${normalizedUrl}/api/devices/pair/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: pairingCode.value.toUpperCase(),
      deviceName: deviceName.value,
      platform: platform.value,
    }),
  });

  if (!claimRes.ok) {
    const errData = await claimRes.json();
    console.error(`✗ ${errData.error}`);
    process.exit(2);
  }

  const claimData = await claimRes.json();
  console.log(`✓ Code validated`);

  // Step 6: Movies Directory
  const moviesDir = await prompts({
    type: "text",
    name: "value",
    message: "Movies directory",
    initial: suggestMoviesDir(),
  });

  // Step 7: TV Directory
  const tvDir = await prompts({
    type: "text",
    name: "value",
    message: "TV shows directory",
    initial: suggestTvDir(),
  });

  // Step 8: Save config
  configManager.savePairingResponse({
    relay: normalizedUrl,
    deviceToken: claimData.deviceToken,
    deviceId: claimData.deviceId,
    deviceName: deviceName.value,
    profileName: extractProfileName(claimData.deviceToken),
    rdApiKey: claimData.rdApiKey,
    moviesDir: moviesDir.value,
    tvDir: tvDir.value,
  });

  console.log(`\n✓ Connected! Device '${deviceName.value}' is now paired.`);
  console.log("✓ Config written to ~/.config/tadaima/config.json");
  console.log("\nUse 'tadaima start' to begin syncing.");
}

function suggestMoviesDir(): string {
  const platform = detectPlatform();
  switch (platform) {
    case "windows":
      return "D:\\Media\\Movies";
    case "macos":
      return `${process.env.HOME}/Movies`;
    case "docker":
      return "/mnt/media/Movies";
    default:
      return `${process.env.HOME}/Movies`;
  }
}

function suggestTvDir(): string {
  const platform = detectPlatform();
  switch (platform) {
    case "windows":
      return "D:\\Media\\TV";
    case "macos":
      return `${process.env.HOME}/TV`;
    case "docker":
      return "/mnt/media/TV";
    default:
      return `${process.env.HOME}/TV`;
  }
}

function extractProfileName(token: string): string {
  // Decode JWT payload (simple base64 decode, no verification needed)
  const payload = token.split(".")[1];
  const decoded = JSON.parse(Buffer.from(payload, "base64").toString());
  return decoded.profileName || "Unknown";
}
```

**`packages/agent/src/lib/platform.ts`**

```typescript
import { platform } from "os";
import { existsSync } from "fs";

export function detectPlatform(): "windows" | "macos" | "linux" | "docker" {
  if (existsSync("/.dockerenv")) {
    return "docker";
  }

  const nodePlatform = platform();
  switch (nodePlatform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      return "linux";
  }
}
```

**`packages/agent/src/lib/deviceName.ts`**

```typescript
import { hostname } from "os";

export function detectDeviceName(): string {
  const host = hostname()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/\.+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 63);

  if (["localhost", "raspberrypi", "vm", "docker"].includes(host)) {
    return "device-" + Math.random().toString(36).substring(2, 8);
  }

  return host || "tadaima-device";
}
```

**`packages/agent/src/lib/validation.ts`**

```typescript
export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname.startsWith("127.");
  } catch {
    return false;
  }
}

export function normalizeUrl(url: string): string {
  if (url.startsWith("http")) {
    return url.endsWith("/") ? url.slice(0, -1) : url;
  }
  return `https://${url}`;
}
```

---

## 9. Test Files

### 9.1 Relay Tests

**`packages/relay/src/__tests__/PairingService.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PairingService } from "../services/PairingService";

describe("PairingService", () => {
  it("generates 6-character code with valid charset", () => {
    const code = PairingService.generateCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
  });

  it("excludes ambiguous characters (I, O, 0, 1)", () => {
    for (let i = 0; i < 100; i++) {
      const code = PairingService.generateCode();
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it("returns error if code already requested", async () => {
    // Mock DB and test duplicate prevention
  });

  it("rejects expired codes", async () => {
    // Mock an expired code and verify claim fails
  });

  it("rejects already-claimed codes", async () => {
    // Mock a claimed code and verify second claim fails
  });

  it("enforces max 5 devices per profile", async () => {
    // Create 5 devices, verify 6th claim fails
  });
});
```

### 9.2 Agent Tests

**`packages/agent/src/__tests__/platform.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { detectPlatform } from "../lib/platform";

describe("detectPlatform", () => {
  it("returns 'docker' if /.dockerenv exists", () => {
    // Mock filesystem
    const platform = detectPlatform();
    expect(["windows", "macos", "linux", "docker"]).toContain(platform);
  });

  it("returns 'windows' on Windows", () => {
    // Mock process.platform
  });

  it("returns 'macos' on macOS", () => {
    // Mock process.platform
  });
});
```

**`packages/agent/src/__tests__/deviceName.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { detectDeviceName } from "../lib/deviceName";

describe("detectDeviceName", () => {
  it("normalizes hostname to lowercase with hyphens", () => {
    // Mock os.hostname()
    const name = detectDeviceName();
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it("replaces spaces with hyphens", () => {
    // Mock hostname with spaces
    // Verify conversion to hyphenated form
  });

  it("avoids generic names like 'localhost'", () => {
    // Mock hostname as 'localhost'
    // Verify it returns something like 'device-xxxxx'
  });
});
```

---

## 10. Execution Order

Execute these steps in order:

### Step 1: Database Setup

1. Write and execute migration file:
   - `packages/relay/migrations/004_pairing_and_devices.sql`
   - Creates `pairing_codes` and `devices` tables

### Step 2: Relay Service Implementation

2. Create `packages/relay/src/services/PairingService.ts`
3. Create `packages/relay/src/routes/devices.ts`
4. Wire routes into main app in `packages/relay/src/index.ts`:
   ```typescript
   app.route("/api/devices", devicesRouter);
   app.route("/api/devices/pair", pairingRouter);
   app.route("/api/agent/config", agentConfigRouter);
   ```

### Step 3: Agent Dependencies

5. Update `packages/agent/package.json` with new dependencies
6. Run `pnpm install`

### Step 4: Agent Implementation

7. Create `packages/agent/src/lib/ConfigManager.ts`
8. Create `packages/agent/src/lib/platform.ts`
9. Create `packages/agent/src/lib/deviceName.ts`
10. Create `packages/agent/src/lib/validation.ts`
11. Create `packages/agent/src/commands/setup.ts`
12. Update `packages/agent/src/index.ts` to call setup flow

### Step 5: Web Components

13. Create `packages/web/src/components/DevicesPage/DevicesPage.tsx`
14. Create `packages/web/src/components/DevicesPage/PairingModal.tsx`
15. Create `packages/web/src/components/DevicesPage/DeviceCard.tsx`
16. Create `packages/web/src/components/DevicesPage/DeviceList.tsx`
17. Create `packages/web/src/components/DevicesPage/RenameDialog.tsx`
18. Create `packages/web/src/components/DevicesPage/RevokeConfirmDialog.tsx`
19. Wire DevicesPage into main app (routing, TBD based on Phase 2 routing setup)

### Step 6: Testing

20. Create `packages/relay/src/__tests__/PairingService.test.ts`
21. Create `packages/agent/src/__tests__/platform.test.ts`
22. Create `packages/agent/src/__tests__/deviceName.test.ts`
23. Run `pnpm test`

### Step 7: Build & Verify

24. Run `pnpm build`
25. Run `pnpm typecheck`
26. Run `pnpm lint`

---

## 11. Verification Checklist

| # | Criterion | How to verify |
|---|-----------|---|
| 3.1 | Pairing code is 6 alphanumeric chars, no I/O/0/1 | Generate 100 codes via `POST /api/devices/pair/request`, verify all match regex `^[A-Z2-9]{6}$` |
| 3.2 | Code expires after 10 minutes | Generate code, wait 10 minutes, attempt claim → 404 |
| 3.3 | Claiming valid code returns deviceId, deviceToken, rdApiKey | Call `POST /api/devices/pair/claim` with valid code → verify all three fields in response |
| 3.4 | Claiming expired code returns 404 | Generate code, manually set `expires_at` in DB to past, attempt claim → 404 |
| 3.5 | Claiming already-claimed code returns 409 | Generate code, claim once (success), attempt second claim → 409 |
| 3.6 | Max 5 devices per profile enforced | Pair 5 devices to a profile, attempt 6th pair → 400 |
| 3.7 | First paired device is default | Create new profile, pair first device → check `is_default = true`. Pair second device → verify second has `is_default = false` |
| 3.8 | Device renamed via PATCH | Update device name via `PATCH /api/devices/:id` → verify name changes in `GET /api/devices` |
| 3.9 | Device revoked via DELETE | Delete device via `DELETE /api/devices/:id` → verify removed from list and 404 on fetch |
| 3.10 | Agent config file written to ~/.config/tadaima/config.json | Run `tadaima setup` → verify file exists and contains all required keys |
| 3.11 | Config file has file mode 0600 | Run `tadaima setup` → check `ls -la ~/.config/tadaima/config.json | grep rw-------` |
| 3.12 | Agent config contains RD API key from pairing | Run `tadaima setup` → parse config.json → verify `realDebrid.apiKey` is non-empty |
| 3.13 | RD key NOT prompted during setup | Run `tadaima setup` → verify no prompt for "RD API key" (should come from code snapshot) |
| 3.14 | GET /api/agent/config returns current RD key | Authenticate with device token → fetch `/api/agent/config` → verify `rdApiKey` field present |
| 3.15 | Devices page renders empty state | Open web app with no paired devices → verify empty state message and "Pair new device" button |
| 3.16 | Devices page shows paired devices list | Pair 2 devices → open devices page → verify both appear as cards |
| 3.17 | Device card shows name, platform icon, last seen, default star | View device card → verify all fields visible |
| 3.18 | Inline rename works | Click rename on device card → enter new name → verify name updates |
| 3.19 | Set default button works | Click "Set default" on non-default device → verify star moves to it |
| 3.20 | Remove button deletes device | Click remove → confirm → verify device disappears from list and API returns 404 |
| 3.21 | Pairing modal shows 6-char code | Click "Pair new device" → modal appears → verify code is 6 characters |
| 3.22 | Pairing modal countdown timer works | Generate code, watch timer → verify it counts down to 0 over 10 minutes |
| 3.23 | Code copy button works | Click copy button → verify code in clipboard |
| 3.24 | First device auto-set as default | Run full pairing flow end-to-end → verify first device has default star |
| 3.25 | Platform auto-detection works | Run `tadaima setup` on each platform → verify correct platform in config |
| 3.26 | Device name auto-detection works | Run `tadaima setup` → verify device name matches hostname (normalized) |

---

## 12. Common Pitfalls to Avoid

1. **Don't use time-based token expiry for device tokens** — they should be revocable only (no `exp` claim). Expiry is checked via the hash lookup, not the token itself.

2. **Don't prompt for RD key during agent setup** — it's snapshots from the pairing code and must not be entered by users. If a user accidentally enters their RD key, reject it.

3. **Don't allow duplicate pairing codes for the same profile** — delete expired ones and reject if one is already pending.

4. **Don't hash the token immediately before storing** — hash it only when storing in the database. The agent receives the plain token and must be able to use it immediately.

5. **Don't trust device token expiry on the client side** — always verify the token hash against the database. The token has no `exp`, so it could theoretically be used forever if revocation isn't checked.

6. **Don't allow multiple devices with the same name on a profile** — normalize and check for duplicates before inserting.

7. **Don't set file permissions incorrectly** — the agent config file must be mode 0600 (user read/write only) to protect the device token.

8. **Don't forget to normalize platform names** — user input must be one of `["windows", "macos", "linux", "docker"]` exactly.

9. **Don't allow the relay URL without a protocol** — prepend `https://` if missing (except for localhost, which can be `http://`).

10. **Don't send the RD key in logs or console output** — it's sensitive and must be redacted.

11. **Don't forget to create the staging directory** — it's required for temporary file handling in Phase 4+. Create it in setup if it doesn't exist.

12. **Don't use hardcoded hostnames for WebSocket/relay URLs** — they must come from environment variables and be returned in the claim response so the agent uses the same base URL.

13. **If a device is revoked, close its WebSocket** — this requires Phase 4 integration. For Phase 3, just delete the row; Phase 4 will handle connection cleanup.

14. **Don't allow more than ONE unclaimed code per profile** — enforce this constraint at the database or application level.

15. **Validate all input strictly** — device names, codes, URLs, paths. Use regex for codes, URL parsing for relay URLs, path normalization for directories.

---

## 13. Decision Points for Clarification

> **✅ RESOLVED**: Use HS256 with `process.env.JWT_SECRET` (shared secret). Simpler, sufficient for a single-instance self-hosted app. The JWT secret is established during the Phase 2 setup wizard.

> **✅ RESOLVED**: Synchronous `conf` is acceptable. The config file is small, the setup flow is interactive, and the user is already waiting. No need for async file handling.

> **✅ RESOLVED**: Automatic with random suffix. Generic hostnames (localhost, raspberrypi, vm) get a random 4-char suffix appended automatically (e.g., "raspberrypi-7k3m"). No extra prompt.

> **✅ RESOLVED**: Keep `deviceId` in the JWT payload. It's redundant with the DB lookup but useful for log inspection and debugging without requiring a decode step.

---

## 14. Post-Phase 3 Notes

- **Phase 4** will add WebSocket relay: connect agents, stream download commands, update `last_seen_at`.
- **Phase 5** will add agent RD pipeline: the agent receives commands and executes RD magnet → unrestrict → download flow.
- **RD key rotation** (Phase 7+): when admin rotates the RD key in instance settings, agents fetch it via `GET /api/agent/config` when their calls fail with 401/403.
- **Device online status** will be computed from `last_seen_at` during WebSocket connection (Phase 4).

---

End of Phase 3 Spec.
