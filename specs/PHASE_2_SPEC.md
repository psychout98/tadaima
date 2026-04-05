# Phase 2: Admin Auth & Profiles — Detailed Spec

> **Goal**: The admin can create an account, log in, and configure instance settings (RD key, TMDB key). Users can pick a profile from a Netflix-style picker. The web app has a first-run setup wizard, admin panel, and profile picker. Auth is JWT-based with short-lived access tokens and long-lived refresh tokens.

---

## 1. Overview

Phase 2 builds the auth layer for both admin (who configures the instance) and profiles (who select media). The relay serves HTTP endpoints for setup, login, profile CRUD, and instance settings. The web app provides a guided first-run wizard, admin login page, admin management panel, and profile picker.

**Key principles:**
- Passwords hashed with bcrypt (12 rounds) at rest
- JWT tokens signed with HS256; secret auto-generated on first run and stored encrypted
- Instance settings (RD key, TMDB key) stored encrypted in the database
- Setup is one-time-only; once admin is created, setup endpoints are locked
- Profile selection is low-friction (name + optional PIN)

---

## 2. Relay Service Layer

### 2.1 File Structure

```
packages/relay/src/
├── index.ts                          # Hono app entry point
├── middleware/
│   ├── auth.ts                       # JWT verification middleware
│   └── errorHandler.ts               # Centralized error handling
├── routes/
│   ├── setup.ts                      # GET /api/setup/status, POST /api/setup/complete
│   ├── auth.ts                       # POST /api/auth/login, refresh, logout
│   ├── profiles.ts                   # GET/POST/PATCH/DELETE /api/profiles, POST /api/profiles/:id/select
│   └── admin.ts                      # GET/PATCH /api/admin/settings, test endpoints
├── services/
│   ├── auth.service.ts               # Login, token generation, refresh, logout
│   ├── profile.service.ts            # Create, read, update, delete profiles
│   ├── settings.service.ts           # Get/update instance settings, encryption/decryption
│   ├── crypto.service.ts             # Bcrypt hashing, JWT signing/verify, settings encryption
│   └── validation.service.ts         # Test RD/TMDB API keys
├── db/
│   └── migrations/                   # Phase 1 already sets up schema; this phase adds:
│       ├── 002_create_admin.sql
│       ├── 003_create_instance_settings.sql
│       ├── 004_create_profiles.sql
│       ├── 005_create_refresh_tokens.sql
│       └── 006_create_recently_viewed.sql
└── types/
    ├── auth.ts                       # AuthPayload, TokenPair, LoginRequest
    ├── profile.ts                    # Profile, CreateProfileRequest
    └── settings.ts                   # InstanceSettings, SettingsUpdateRequest
```

### 2.2 Database Migrations

These tables are created in Phase 2. (Phase 1 creates base `profiles` stub; Phase 2 expands it.)

#### 002_create_admin.sql

```sql
CREATE TABLE admin (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_username ON admin(username);
```

#### 003_create_instance_settings.sql

```sql
CREATE TABLE instance_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  encrypted BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed default entries (values can be empty initially)
INSERT INTO instance_settings (key, value, encrypted) VALUES
  ('jwt_secret', '', TRUE),
  ('rd_api_key', '', TRUE),
  ('tmdb_api_key', '', TRUE),
  ('setup_complete', 'false', FALSE)
ON CONFLICT (key) DO NOTHING;
```

#### 004_create_profiles.sql

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  avatar TEXT DEFAULT 'blue',  -- color/emoji identifier
  pin_hash TEXT,               -- bcrypt hash of 4-6 digit PIN (nullable)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_profiles_name ON profiles(name);
```

#### 005_create_refresh_tokens.sql

```sql
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admin(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),

  -- Ensure exactly one of admin_id or profile_id is set
  CONSTRAINT exactly_one_subject CHECK (
    (admin_id IS NOT NULL AND profile_id IS NULL) OR
    (admin_id IS NULL AND profile_id IS NOT NULL)
  )
);

CREATE INDEX idx_refresh_tokens_admin ON refresh_tokens(admin_id);
CREATE INDEX idx_refresh_tokens_profile ON refresh_tokens(profile_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);
```

#### 006_create_recently_viewed.sql

```sql
CREATE TABLE recently_viewed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tmdb_id INT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  title TEXT NOT NULL,
  year INT,
  poster_path TEXT,
  imdb_id TEXT,
  viewed_at TIMESTAMP DEFAULT NOW(),

  -- Keep at most 20 per profile; oldest evicted on insert
  UNIQUE(profile_id, tmdb_id)
);

CREATE INDEX idx_recently_viewed_profile ON recently_viewed(profile_id, viewed_at DESC);
```

---

## 3. HTTP Endpoints

### 3.1 Setup Endpoints

#### GET /api/setup/status

**Public endpoint** — always callable.

**Response (200 OK):**
```typescript
{
  needsSetup: boolean
}
```

**Logic:**
- Query `instance_settings` table for key `setup_complete`
- If value is `"false"` or entry missing, return `{ needsSetup: true }`
- If value is `"true"`, return `{ needsSetup: false }`

**Error cases:**
- None; this endpoint always succeeds

---

#### POST /api/setup/complete

**Public endpoint**, but only callable once. Creates admin account, stores instance settings.

**Request body:**
```typescript
{
  username: string         // 3-20 chars, alphanumeric + underscore
  password: string         // min 8 chars
  tmdbApiKey: string       // TMDB API key (validated with GET /configuration)
  rdApiKey: string         // Real-Debrid API key (validated with GET /user)
  firstProfileName: string // 1-20 chars
  firstProfileAvatar: string // e.g., "blue", "red", ":smile:"
}
```

**Response (201 Created):**
```typescript
{
  adminId: string
  profileId: string
  message: "Setup complete"
}
```

**Logic:**
1. Check if `setup_complete` == `"true"`. If so, return 409 Conflict with message "Setup already complete".
2. Validate request:
   - `username`: 3-20 chars, alphanumeric + underscore. If invalid, 400 "Invalid username format".
   - `password`: min 8 chars. If invalid, 400 "Password too short".
   - `tmdbApiKey` and `rdApiKey`: call validation service (see **3.5**). If invalid, return 400 "Invalid API key".
   - `firstProfileName`: 1-20 chars. If invalid, 400 "Invalid profile name".
3. Hash password with bcrypt (12 rounds).
4. Generate JWT secret (43-byte random string, base64-encoded).
5. Insert into `admin` table: id, username, password_hash.
6. Insert into `instance_settings`:
   - `jwt_secret` → encrypted secret
   - `rd_api_key` → encrypted RD key
   - `tmdb_api_key` → encrypted TMDB key
   - `setup_complete` → `"true"`
7. Insert into `profiles`: first profile with given name and avatar.
8. Return 201 with `adminId` and `profileId`.

**Error cases:**
- 409: Setup already complete
- 400: Invalid input (username, password, profile name, or API keys)
- 500: Database error (username conflict if somehow duplicated)

---

### 3.2 Auth Endpoints

#### POST /api/auth/login

**Public endpoint** — admin login.

**Request body:**
```typescript
{
  username: string
  password: string
}
```

**Response (200 OK):**
```typescript
{
  accessToken: string      // JWT, 15m expiry
  refreshToken: string     // JWT, 7d expiry
  adminId: string
  expiresIn: number        // seconds (900 for access token)
}
```

**Logic:**
1. Query `admin` table by username. If not found, return 401 "Invalid credentials".
2. Compare request password with stored password_hash using bcrypt. If mismatch, return 401 "Invalid credentials".
3. Generate access token:
   ```typescript
   {
     sub: adminId,
     type: "admin",
     iat: now,
     exp: now + 900  // 15 minutes
   }
   ```
   Sign with HS256 using JWT secret from settings.
4. Generate refresh token:
   ```typescript
   {
     sub: adminId,
     type: "admin_refresh",
     iat: now,
     exp: now + 604800  // 7 days
   }
   ```
5. Hash refresh token with SHA-256; store in `refresh_tokens` table with `admin_id` and expiry.
6. Return 200 with both tokens and `expiresIn: 900`.

**Error cases:**
- 401: Invalid credentials (user not found or password mismatch)
- 500: Database or crypto error

---

#### POST /api/auth/refresh

**Authenticated endpoint** — requires valid refresh token (not access token).

**Request headers:**
```
Authorization: Bearer <refreshToken>
```

**Response (200 OK):**
```typescript
{
  accessToken: string
  refreshToken: string     // new refresh token
  expiresIn: number
}
```

**Logic:**
1. Extract token from Authorization header.
2. Verify token is valid JWT and `type === "admin_refresh"`.
3. Query `refresh_tokens` table by SHA-256 hash of token. If not found or expired, return 401 "Invalid or expired refresh token".
4. Delete old refresh token entry.
5. Generate new access + refresh token pair (same as login).
6. Insert new refresh token hash in database.
7. Return 200 with new pair.

**Error cases:**
- 401: Invalid, expired, or missing refresh token
- 500: Database or crypto error

---

#### POST /api/auth/logout

**Authenticated endpoint** — requires access token.

**Request headers:**
```
Authorization: Bearer <accessToken>
```

**Response (204 No Content)**

**Logic:**
1. Extract token; verify it's valid and `type === "admin"`.
2. Extract `sub` (adminId).
3. Delete all refresh token entries for that admin from database.
4. Return 204.

**Error cases:**
- 401: Invalid or missing token
- 500: Database error

---

### 3.3 Profile Endpoints

#### GET /api/profiles

**Public endpoint** — profile picker needs the list without auth.

**Response (200 OK):**
```typescript
[
  {
    id: string
    name: string
    avatar: string
    hasPin: boolean  // true if pin_hash is not null
  },
  ...
]
```

**Logic:**
1. Query all profiles from `profiles` table.
2. Return list with id, name, avatar, hasPin (pin_hash != null).
3. Ordered by created_at ASC.

**Error cases:**
- None; returns empty array if no profiles

---

#### POST /api/profiles

**Admin-only endpoint** — requires valid admin access token.

**Request headers:**
```
Authorization: Bearer <accessToken>
```

**Request body:**
```typescript
{
  name: string           // 1-20 chars
  avatar: string         // color or emoji
  pin?: string           // optional; 4-6 digits as string
}
```

**Response (201 Created):**
```typescript
{
  id: string
  name: string
  avatar: string
  hasPin: boolean
}
```

**Logic:**
1. Verify admin access token (middleware).
2. Validate:
   - `name`: 1-20 chars, not empty. If invalid, 400.
   - `avatar`: regex match (e.g., `^[a-z]+$|^:[a-z_]+:$`). If invalid, 400.
   - `pin` (if provided): exactly 4-6 digits. If invalid, 400.
3. If pin provided, hash with bcrypt (12 rounds).
4. Insert into `profiles`: id (auto-uuid), name, avatar, pin_hash (or null).
5. Return 201 with profile details.

**Error cases:**
- 400: Invalid input
- 401: Missing or invalid token
- 403: Token is not admin type
- 500: Database error

---

#### PATCH /api/profiles/:id

**Admin-only endpoint** — update name, avatar, or PIN.

**Request headers:**
```
Authorization: Bearer <accessToken>
```

**Request body (any combination):**
```typescript
{
  name?: string
  avatar?: string
  pin?: string | null  // null to remove PIN
}
```

**Response (200 OK):**
```typescript
{
  id: string
  name: string
  avatar: string
  hasPin: boolean
}
```

**Logic:**
1. Verify admin access token.
2. Query profile by id. If not found, return 404 "Profile not found".
3. Validate provided fields (same rules as POST).
4. If pin provided:
   - If pin is null, set pin_hash to null
   - Otherwise, hash with bcrypt
5. Update profile in database. Set `updated_at` to NOW().
6. Return 200 with updated profile.

**Error cases:**
- 400: Invalid input
- 401/403: Auth failure
- 404: Profile not found
- 500: Database error

---

#### DELETE /api/profiles/:id

**Admin-only endpoint** — delete profile and all associated data.

**Request headers:**
```
Authorization: Bearer <accessToken>
```

**Response (204 No Content)**

**Logic:**
1. Verify admin access token.
2. Query profile by id. If not found, return 404.
3. Delete from `profiles` (cascades to `recently_viewed`).
4. Return 204.

**Error cases:**
- 401/403: Auth failure
- 404: Profile not found
- 500: Database error

---

#### POST /api/profiles/:id/select

**Public endpoint** — select a profile and get a profile session token. Validates PIN if profile has one.

**Request body:**
```typescript
{
  pin?: string  // optional; required if profile has PIN
}
```

**Response (200 OK):**
```typescript
{
  profileSessionToken: string  // JWT, 24h expiry
  profileId: string
  profileName: string
  expiresIn: number            // 86400
}
```

**Logic:**
1. Query profile by id. If not found, return 404 "Profile not found".
2. If profile has pin_hash (pin_hash IS NOT NULL):
   - If no pin provided in request, return 400 "PIN required".
   - Compare request pin (as plaintext string) with pin_hash using bcrypt. If mismatch, return 401 "Invalid PIN".
3. Generate profile session token:
   ```typescript
   {
     sub: profileId,
     type: "profile",
     iat: now,
     exp: now + 86400  // 24 hours
   }
   ```
   Sign with HS256.
4. Return 200 with token, profileId, profileName, expiresIn.

**Error cases:**
- 400: PIN required but not provided
- 401: Invalid PIN (if profile has PIN)
- 404: Profile not found
- 500: Crypto error

---

### 3.4 Admin Settings Endpoints

#### GET /api/admin/settings

**Admin-only endpoint** — retrieve instance settings with sensitive values masked.

**Request headers:**
```
Authorization: Bearer <accessToken>
```

**Response (200 OK):**
```typescript
{
  rdApiKey: string       // masked: "••••••••" + last 4 chars
  tmdbApiKey: string     // masked
  setupComplete: boolean
}
```

**Logic:**
1. Verify admin access token.
2. Query `instance_settings` for keys: `rd_api_key`, `tmdb_api_key`, `setup_complete`.
3. Decrypt encrypted values (see **crypto.service.ts**).
4. Mask sensitive values: show only last 4 characters, rest as bullet points.
5. Return 200.

**Error cases:**
- 401/403: Auth failure
- 500: Decryption error

---

#### PATCH /api/admin/settings

**Admin-only endpoint** — update API keys.

**Request headers:**
```
Authorization: Bearer <accessToken>
```

**Request body (any combination):**
```typescript
{
  rdApiKey?: string
  tmdbApiKey?: string
}
```

**Response (200 OK):**
```typescript
{
  rdApiKey: string  // masked
  tmdbApiKey: string
  setupComplete: boolean
}
```

**Logic:**
1. Verify admin access token.
2. If `rdApiKey` provided:
   - Validate against RD API (see **3.5**). If invalid, return 400.
   - Encrypt and store in `instance_settings`.
3. If `tmdbApiKey` provided:
   - Validate against TMDB API. If invalid, return 400.
   - Encrypt and store.
4. Return 200 with masked values.

**Error cases:**
- 400: Invalid API key (validation failed)
- 401/403: Auth failure
- 500: Encryption or database error

---

#### POST /api/admin/settings/test-rd

**Admin-only endpoint** — validate RD API key.

**Request headers:**
```
Authorization: Bearer <accessToken>
```

**Request body:**
```typescript
{
  rdApiKey: string
}
```

**Response (200 OK):**
```typescript
{
  valid: boolean
  message: string
}
```

**Logic:**
1. Verify admin access token.
2. Call validation service with RD key (see **3.5**).
3. Return 200 with valid: true/false and message.

**Error cases:**
- 401/403: Auth failure
- 500: Network or crypto error

---

#### POST /api/admin/settings/test-tmdb

**Admin-only endpoint** — validate TMDB API key.

**Request headers:**
```
Authorization: Bearer <accessToken>
```

**Request body:**
```typescript
{
  tmdbApiKey: string
}
```

**Response (200 OK):**
```typescript
{
  valid: boolean
  message: string
}
```

**Logic:**
1. Verify admin access token.
2. Call validation service with TMDB key.
3. Return 200 with valid and message.

**Error cases:**
- 401/403: Auth failure
- 500: Network error

---

### 3.5 Validation Service

Create `packages/relay/src/services/validation.service.ts`:

#### testRdApiKey(key: string): Promise<boolean>

```typescript
export async function testRdApiKey(key: string): Promise<boolean> {
  try {
    const response = await fetch("https://api.real-debrid.com/rest/1.0/user", {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });
    // RD returns 200 if key is valid, 401 if invalid
    return response.status === 200;
  } catch (error) {
    return false;
  }
}
```

#### testTmdbApiKey(key: string): Promise<boolean>

```typescript
export async function testTmdbApiKey(key: string): Promise<boolean> {
  try {
    const response = await fetch("https://api.themoviedb.org/3/configuration", {
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}
```

---

## 4. JWT & Crypto Implementation

### 4.1 Dependencies

Add to `packages/relay/package.json`:

```jsonc
{
  "dependencies": {
    "jose": "~6.2.0",
    "bcryptjs": "~3.0.0"  // pure JS, no native deps
  }
}
```

### 4.2 JWT Secret Generation & Storage

On first run (when setup is completed):

1. Generate 43 random bytes: `crypto.randomBytes(43).toString("base64")`
2. Encrypt the secret using AES-256-GCM (see below)
3. Store encrypted secret in `instance_settings` with key `jwt_secret` and `encrypted: true`

**Secret retrieval** (on app startup):
1. Load encrypted secret from `instance_settings`
2. Decrypt using AES-256-GCM with a fixed encryption key derived from environment

> **✅ RESOLVED**: The encryption master key is stored as an `ENCRYPTION_MASTER_KEY` environment variable. Auto-generated on first run if missing, with a warning to save it. For development, set it in `.env`. For production (Railway), set as a secret.

### 4.3 Token Structure

**Access Token (15-minute expiry):**
```typescript
{
  sub: string                  // adminId or profileId
  type: "admin" | "profile"    // scope
  iat: number                  // issued at (seconds)
  exp: number                  // expiration (seconds)
}
```

**Refresh Token (7-day expiry for admin, N/A for profile):**
```typescript
{
  sub: string                  // adminId
  type: "admin_refresh"
  iat: number
  exp: number
}
```

**Profile Session Token (24-hour expiry):**
```typescript
{
  sub: string                  // profileId
  type: "profile"
  iat: number
  exp: number
}
```

### 4.4 Crypto Service

Create `packages/relay/src/services/crypto.service.ts`:

```typescript
import * as jose from "jose";
import bcryptjs from "bcryptjs";
import crypto from "node:crypto";

const BCRYPT_ROUNDS = 12;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;

// Master encryption key from environment (or derived value)
const getMasterKey = (): Buffer => {
  const envKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!envKey) {
    throw new Error("ENCRYPTION_MASTER_KEY not set");
  }
  // Expect 32-byte hex string (64 hex chars)
  if (envKey.length !== 64) {
    throw new Error("ENCRYPTION_MASTER_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(envKey, "hex");
};

export class CryptoService {
  /**
   * Hash a plaintext value with bcrypt (12 rounds)
   */
  static async hashPassword(plaintext: string): Promise<string> {
    return bcryptjs.hash(plaintext, BCRYPT_ROUNDS);
  }

  /**
   * Compare plaintext with bcrypt hash
   */
  static async comparePassword(plaintext: string, hash: string): Promise<boolean> {
    return bcryptjs.compare(plaintext, hash);
  }

  /**
   * Generate a JWT access token
   */
  static async generateAccessToken(
    secret: string,
    subject: string,
    type: "admin" | "profile",
    expirySeconds: number = 900
  ): Promise<string> {
    const jwtSecret = new TextEncoder().encode(secret);
    return new jose.SignJWT({
      sub: subject,
      type,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expirySeconds)
      .sign(jwtSecret);
  }

  /**
   * Verify and decode a JWT
   */
  static async verifyToken(
    secret: string,
    token: string
  ): Promise<{
    sub: string;
    type: string;
    iat: number;
    exp: number;
  }> {
    const jwtSecret = new TextEncoder().encode(secret);
    const verified = await jose.jwtVerify(token, jwtSecret);
    return verified.payload as any;
  }

  /**
   * Encrypt a value using AES-256-GCM
   * Returns: base64(salt + iv + ciphertext + tag)
   */
  static encryptValue(plaintext: string): string {
    const masterKey = getMasterKey();
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(16);

    // Derive a key from master key + salt
    const derivedKey = crypto.pbkdf2Sync(masterKey, salt, 100000, 32, "sha256");

    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, derivedKey, iv);
    const encrypted = cipher.update(plaintext, "utf8", "hex") + cipher.final("hex");
    const tag = cipher.getAuthTag();

    // Combine: salt (16) + iv (16) + encrypted (variable) + tag (16)
    const combined = Buffer.concat([salt, iv, Buffer.from(encrypted, "hex"), tag]);
    return combined.toString("base64");
  }

  /**
   * Decrypt a value
   */
  static decryptValue(encrypted: string): string {
    const masterKey = getMasterKey();
    const combined = Buffer.from(encrypted, "base64");

    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + 16);
    const tag = combined.slice(combined.length - TAG_LENGTH);
    const ciphertext = combined.slice(SALT_LENGTH + 16, combined.length - TAG_LENGTH);

    const derivedKey = crypto.pbkdf2Sync(masterKey, salt, 100000, 32, "sha256");

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(tag);

    const decrypted = decipher.update(ciphertext, "hex", "utf8") + decipher.final("utf8");
    return decrypted;
  }

  /**
   * Generate a random JWT secret (43 bytes, base64-encoded)
   */
  static generateJwtSecret(): string {
    return crypto.randomBytes(43).toString("base64");
  }

  /**
   * SHA-256 hash of a token (for storage)
   */
  static hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
```

---

## 5. Service Layer

### 5.1 Auth Service

Create `packages/relay/src/services/auth.service.ts`:

```typescript
import type { Database } from "@tadaima/shared";  // from Phase 1
import { CryptoService } from "./crypto.service";
import { SettingsService } from "./settings.service";

export interface AuthPayload {
  sub: string;
  type: "admin" | "profile" | "admin_refresh";
  iat: number;
  exp: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class AuthService {
  constructor(private db: Database) {}

  /**
   * Admin login: verify credentials, issue token pair
   */
  async login(username: string, password: string): Promise<TokenPair & { adminId: string }> {
    const admin = await this.db.query.admin.findFirst({
      where: (admin, { eq }) => eq(admin.username, username),
    });

    if (!admin) {
      throw new Error("Invalid credentials");
    }

    const isValid = await CryptoService.comparePassword(password, admin.password_hash);
    if (!isValid) {
      throw new Error("Invalid credentials");
    }

    const jwtSecret = await SettingsService.getJwtSecret(this.db);
    const accessToken = await CryptoService.generateAccessToken(
      jwtSecret,
      admin.id,
      "admin",
      900
    );
    const refreshToken = await CryptoService.generateAccessToken(
      jwtSecret,
      admin.id,
      "admin_refresh",
      604800
    );

    // Store refresh token hash
    const refreshTokenHash = CryptoService.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 604800 * 1000);
    await this.db.insert(this.db.schema.refreshTokens).values({
      adminId: admin.id,
      profileId: null,
      tokenHash: refreshTokenHash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      adminId: admin.id,
      expiresIn: 900,
    };
  }

  /**
   * Refresh: validate refresh token, issue new pair
   */
  async refresh(refreshToken: string): Promise<TokenPair & { adminId: string }> {
    const jwtSecret = await SettingsService.getJwtSecret(this.db);

    let payload: AuthPayload;
    try {
      payload = (await CryptoService.verifyToken(jwtSecret, refreshToken)) as AuthPayload;
    } catch {
      throw new Error("Invalid or expired refresh token");
    }

    if (payload.type !== "admin_refresh") {
      throw new Error("Invalid token type");
    }

    // Check if token exists in database and is not expired
    const refreshTokenHash = CryptoService.hashToken(refreshToken);
    const storedToken = await this.db.query.refreshTokens.findFirst({
      where: (rt, { eq, and }) =>
        and(eq(rt.tokenHash, refreshTokenHash), eq(rt.adminId, payload.sub)),
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      throw new Error("Invalid or expired refresh token");
    }

    // Delete old token
    await this.db.delete(this.db.schema.refreshTokens).where((rt) =>
      this.db.schema.eq(rt.id, storedToken.id)
    );

    // Issue new pair
    const newAccessToken = await CryptoService.generateAccessToken(
      jwtSecret,
      payload.sub,
      "admin",
      900
    );
    const newRefreshToken = await CryptoService.generateAccessToken(
      jwtSecret,
      payload.sub,
      "admin_refresh",
      604800
    );

    const newRefreshTokenHash = CryptoService.hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + 604800 * 1000);
    await this.db.insert(this.db.schema.refreshTokens).values({
      adminId: payload.sub,
      profileId: null,
      tokenHash: newRefreshTokenHash,
      expiresAt,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      adminId: payload.sub,
      expiresIn: 900,
    };
  }

  /**
   * Logout: revoke all refresh tokens for admin
   */
  async logout(adminId: string): Promise<void> {
    await this.db.delete(this.db.schema.refreshTokens).where((rt) =>
      this.db.schema.eq(rt.adminId, adminId)
    );
  }
}
```

### 5.2 Profile Service

Create `packages/relay/src/services/profile.service.ts`:

```typescript
import type { Database } from "@tadaima/shared";
import { CryptoService } from "./crypto.service";

export interface Profile {
  id: string;
  name: string;
  avatar: string;
  hasPin: boolean;
}

export class ProfileService {
  constructor(private db: Database) {}

  /**
   * List all profiles
   */
  async listProfiles(): Promise<Profile[]> {
    const profiles = await this.db.query.profiles.findMany();
    return profiles.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      hasPin: !!p.pinHash,
    }));
  }

  /**
   * Create profile
   */
  async createProfile(
    name: string,
    avatar: string,
    pin?: string
  ): Promise<Profile> {
    const pinHash = pin ? await CryptoService.hashPassword(pin) : null;
    const profile = await this.db.insert(this.db.schema.profiles).values({
      name,
      avatar,
      pinHash,
    });

    return {
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar,
      hasPin: !!pinHash,
    };
  }

  /**
   * Update profile
   */
  async updateProfile(
    id: string,
    updates: { name?: string; avatar?: string; pin?: string | null }
  ): Promise<Profile> {
    const existingProfile = await this.db.query.profiles.findFirst({
      where: (p, { eq }) => eq(p.id, id),
    });

    if (!existingProfile) {
      throw new Error("Profile not found");
    }

    const pinHash = updates.pin === null ? null : updates.pin ? await CryptoService.hashPassword(updates.pin) : existingProfile.pinHash;

    const updated = await this.db.update(this.db.schema.profiles)
      .set({
        name: updates.name || existingProfile.name,
        avatar: updates.avatar || existingProfile.avatar,
        pinHash,
        updatedAt: new Date(),
      })
      .where((p) => this.db.schema.eq(p.id, id));

    return {
      id: updated.id,
      name: updated.name,
      avatar: updated.avatar,
      hasPin: !!updated.pinHash,
    };
  }

  /**
   * Delete profile
   */
  async deleteProfile(id: string): Promise<void> {
    await this.db.delete(this.db.schema.profiles).where((p) =>
      this.db.schema.eq(p.id, id)
    );
  }

  /**
   * Verify PIN for profile
   */
  async verifyPin(profileId: string, pin: string): Promise<boolean> {
    const profile = await this.db.query.profiles.findFirst({
      where: (p, { eq }) => eq(p.id, profileId),
    });

    if (!profile) {
      return false;
    }

    if (!profile.pinHash) {
      return true; // No PIN required
    }

    return CryptoService.comparePassword(pin, profile.pinHash);
  }
}
```

### 5.3 Settings Service

Create `packages/relay/src/services/settings.service.ts`:

```typescript
import type { Database } from "@tadaima/shared";
import { CryptoService } from "./crypto.service";

export interface InstanceSettings {
  rdApiKey: string;
  tmdbApiKey: string;
  setupComplete: boolean;
}

export class SettingsService {
  /**
   * Get JWT secret (decrypt from storage)
   */
  static async getJwtSecret(db: Database): Promise<string> {
    const setting = await db.query.instanceSettings.findFirst({
      where: (s, { eq }) => eq(s.key, "jwt_secret"),
    });

    if (!setting || !setting.value) {
      throw new Error("JWT secret not found");
    }

    return CryptoService.decryptValue(setting.value);
  }

  /**
   * Get all settings (masked)
   */
  async getSettings(): Promise<InstanceSettings> {
    const rdKeySetting = await this.db.query.instanceSettings.findFirst({
      where: (s, { eq }) => eq(s.key, "rd_api_key"),
    });

    const tmdbKeySetting = await this.db.query.instanceSettings.findFirst({
      where: (s, { eq }) => eq(s.key, "tmdb_api_key"),
    });

    const setupSetting = await this.db.query.instanceSettings.findFirst({
      where: (s, { eq }) => eq(s.key, "setup_complete"),
    });

    const decryptedRd = rdKeySetting?.value ? CryptoService.decryptValue(rdKeySetting.value) : "";
    const decryptedTmdb = tmdbKeySetting?.value ? CryptoService.decryptValue(tmdbKeySetting.value) : "";

    return {
      rdApiKey: this.maskValue(decryptedRd),
      tmdbApiKey: this.maskValue(decryptedTmdb),
      setupComplete: setupSetting?.value === "true",
    };
  }

  /**
   * Update API keys (encrypted storage)
   */
  async updateSettings(rdApiKey?: string, tmdbApiKey?: string): Promise<void> {
    if (rdApiKey) {
      const encrypted = CryptoService.encryptValue(rdApiKey);
      await this.db
        .update(this.db.schema.instanceSettings)
        .set({ value: encrypted, updatedAt: new Date() })
        .where((s) => this.db.schema.eq(s.key, "rd_api_key"));
    }

    if (tmdbApiKey) {
      const encrypted = CryptoService.encryptValue(tmdbApiKey);
      await this.db
        .update(this.db.schema.instanceSettings)
        .set({ value: encrypted, updatedAt: new Date() })
        .where((s) => this.db.schema.eq(s.key, "tmdb_api_key"));
    }
  }

  /**
   * Mask a sensitive value: show only last 4 chars
   */
  private maskValue(value: string): string {
    if (value.length <= 4) {
      return "••••";
    }
    return "•".repeat(value.length - 4) + value.slice(-4);
  }

  /**
   * Check if setup is complete
   */
  async isSetupComplete(): Promise<boolean> {
    const setting = await this.db.query.instanceSettings.findFirst({
      where: (s, { eq }) => eq(s.key, "setup_complete"),
    });
    return setting?.value === "true";
  }
}
```

### 5.4 Auth Middleware

Create `packages/relay/src/middleware/auth.ts`:

```typescript
import type { Context } from "hono";
import { CryptoService } from "../services/crypto.service";
import { SettingsService } from "../services/settings.service";

export interface AuthContext {
  adminId?: string;
  profileId?: string;
  tokenType?: "admin" | "profile" | "admin_refresh";
}

/**
 * Extract and verify JWT from Authorization header
 */
export async function verifyAuth(c: Context, db: Database): Promise<AuthContext> {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return {};
  }

  const token = header.slice(7);

  try {
    const jwtSecret = await SettingsService.getJwtSecret(db);
    const payload = await CryptoService.verifyToken(jwtSecret, token);

    if (payload.type === "admin" || payload.type === "admin_refresh") {
      return {
        adminId: payload.sub,
        tokenType: payload.type,
      };
    } else if (payload.type === "profile") {
      return {
        profileId: payload.sub,
        tokenType: payload.type,
      };
    }
  } catch {
    // Invalid or expired token
  }

  return {};
}

/**
 * Middleware: require admin token
 */
export async function requireAdmin(c: Context, next: () => Promise<void>, db: Database) {
  const auth = await verifyAuth(c, db);
  if (!auth.adminId || auth.tokenType !== "admin") {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("adminId", auth.adminId);
  await next();
}

/**
 * Middleware: require valid token (admin or profile)
 */
export async function requireAuth(c: Context, next: () => Promise<void>, db: Database) {
  const auth = await verifyAuth(c, db);
  if (!auth.adminId && !auth.profileId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (auth.adminId) {
    c.set("adminId", auth.adminId);
  }
  if (auth.profileId) {
    c.set("profileId", auth.profileId);
  }
  await next();
}
```

---

## 6. Web App Layer

### 6.1 File Structure

```
packages/web/src/
├── pages/
│   ├── SetupWizard.tsx             # First-run wizard (5 steps)
│   ├── Login.tsx                   # Admin login form
│   ├── ProfilePicker.tsx           # Netflix-style profile grid
│   ├── AdminPanel.tsx              # Admin management interface
│   ├── Search.tsx                  # Main search page (placeholder)
│   ├── Downloads.tsx               # Downloads page (placeholder)
│   └── NotFound.tsx                # 404 page
├── components/
│   ├── AppShell.tsx                # Layout with sidebar
│   ├── Sidebar.tsx                 # Navigation sidebar
│   ├── ProfileHeader.tsx           # Profile avatar + name in sidebar
│   ├── ConnectionStatus.tsx        # Green/yellow/red dot (placeholder)
│   ├── SetupStepCard.tsx           # Wizard step container
│   ├── ApiKeyInput.tsx             # Masked input with reveal toggle
│   ├── PinModal.tsx                # PIN entry modal for profile picker
│   ├── ProfileGrid.tsx             # Grid of profile avatars
│   ├── ProfileForm.tsx             # Create/edit profile form
│   ├── SettingsSection.tsx         # Settings editor UI
│   └── Loading.tsx                 # Loading spinner
├── stores/
│   ├── authStore.ts                # zustand store: admin token, profile token
│   ├── profileStore.ts             # zustand store: current profile, list of profiles
│   └── wsStore.ts                  # zustand store: WebSocket connection state (placeholder)
├── lib/
│   ├── api.ts                      # Fetch wrapper with auth headers
│   ├── validation.ts               # Input validation helpers
│   └── constants.ts                # URLs, timeouts, etc.
├── Router.tsx                      # react-router-dom routes
├── App.tsx                         # Root component (route check)
├── main.tsx                        # Entry point
└── index.css                       # Tailwind + dark theme CSS vars
```

### 6.2 New Dependencies

Add to `packages/web/package.json`:

```jsonc
{
  "dependencies": {
    "react-router-dom": "~7.5.0",
    "zustand": "~5.0.0",
    "@tanstack/react-query": "~5.96.0"
  }
}
```

### 6.3 Dark Theme Setup

Update `packages/web/index.css`:

```css
@import "tailwindcss";

:root {
  --color-bg-primary: #0f0f0f;
  --color-bg-secondary: #1a1a1a;
  --color-bg-tertiary: #262626;
  --color-accent: #6366f1;
  --color-accent-dark: #4f46e5;
  --color-text-primary: #ffffff;
  --color-text-secondary: #a1a1a1;
  --color-border: #333333;
}

body {
  @apply bg-[#0f0f0f] text-white;
}

/* Card styling */
.card {
  @apply bg-[#1a1a1a] rounded-lg border border-[#333333] p-4;
}

/* Button styling */
.btn-primary {
  @apply px-4 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] text-white font-medium transition-colors;
}

.btn-secondary {
  @apply px-4 py-2 rounded-lg bg-[#262626] hover:bg-[#333333] text-white font-medium border border-[#333333] transition-colors;
}

/* Input styling */
.input-field {
  @apply w-full px-3 py-2 rounded-lg bg-[#262626] border border-[#333333] text-white placeholder-gray-500 focus:border-[#6366f1] focus:outline-none;
}
```

### 6.4 Auth Store

Create `packages/web/src/stores/authStore.ts`:

```typescript
import { create } from "zustand";

interface AuthStore {
  adminAccessToken: string | null;
  adminRefreshToken: string | null;
  profileAccessToken: string | null;
  adminId: string | null;
  profileId: string | null;

  setAdminTokens: (access: string, refresh: string, adminId: string) => void;
  setProfileToken: (token: string, profileId: string) => void;
  clearAdmin: () => void;
  clearProfile: () => void;
  clearAll: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  adminAccessToken: null,
  adminRefreshToken: null,
  profileAccessToken: null,
  adminId: null,
  profileId: null,

  setAdminTokens: (access, refresh, adminId) =>
    set({
      adminAccessToken: access,
      adminRefreshToken: refresh,
      adminId,
    }),

  setProfileToken: (token, profileId) =>
    set({
      profileAccessToken: token,
      profileId,
    }),

  clearAdmin: () =>
    set({
      adminAccessToken: null,
      adminRefreshToken: null,
      adminId: null,
    }),

  clearProfile: () =>
    set({
      profileAccessToken: null,
      profileId: null,
    }),

  clearAll: () =>
    set({
      adminAccessToken: null,
      adminRefreshToken: null,
      profileAccessToken: null,
      adminId: null,
      profileId: null,
    }),
}));
```

### 6.5 Profile Store

Create `packages/web/src/stores/profileStore.ts`:

```typescript
import { create } from "zustand";

export interface Profile {
  id: string;
  name: string;
  avatar: string;
  hasPin: boolean;
}

interface ProfileStore {
  profiles: Profile[];
  currentProfile: Profile | null;
  setProfiles: (profiles: Profile[]) => void;
  setCurrentProfile: (profile: Profile) => void;
  clearCurrentProfile: () => void;
}

export const useProfileStore = create<ProfileStore>((set) => ({
  profiles: [],
  currentProfile: null,

  setProfiles: (profiles) => set({ profiles }),

  setCurrentProfile: (profile) => set({ currentProfile: profile }),

  clearCurrentProfile: () => set({ currentProfile: null }),
}));
```

### 6.6 API Wrapper

Create `packages/web/src/lib/api.ts`:

```typescript
import { useAuthStore } from "../stores/authStore";

const API_BASE = "/api";

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

export async function apiFetch(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { skipAuth = false, ...fetchOptions } = options;

  const headers = new Headers(fetchOptions.headers || {});

  if (!skipAuth) {
    const authStore = useAuthStore.getState();
    const token = authStore.adminAccessToken || authStore.profileAccessToken;

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  return response;
}

export async function apiGet<T>(
  endpoint: string,
  skipAuth = false
): Promise<T> {
  const response = await apiFetch(endpoint, { skipAuth });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export async function apiPost<T>(
  endpoint: string,
  body: unknown,
  skipAuth = false
): Promise<T> {
  const response = await apiFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    skipAuth,
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export async function apiPatch<T>(
  endpoint: string,
  body: unknown
): Promise<T> {
  const response = await apiFetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export async function apiDelete(endpoint: string): Promise<void> {
  const response = await apiFetch(endpoint, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
}
```

### 6.7 Page: SetupWizard.tsx

5-step wizard for first-run setup:

```typescript
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../lib/api";
import { useAuthStore } from "../stores/authStore";

enum SetupStep {
  Admin = 0,
  Tmdb = 1,
  RealDebrid = 2,
  FirstProfile = 3,
  Complete = 4,
}

export function SetupWizard() {
  const navigate = useNavigate();
  const setAdminTokens = useAuthStore((s) => s.setAdminTokens);
  const [step, setStep] = useState<SetupStep>(SetupStep.Admin);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tmdbKey, setTmdbKey] = useState("");
  const [rdKey, setRdKey] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("blue");

  const handleAdminCreate = async () => {
    if (!username || !password || password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setStep(SetupStep.Tmdb);
    setError("");
  };

  const handleTmdbTest = async () => {
    if (!tmdbKey) {
      setError("Enter a TMDB API key");
      return;
    }
    setLoading(true);
    try {
      const result = await apiPost<{ valid: boolean }>(
        "/admin/settings/test-tmdb",
        { tmdbApiKey: tmdbKey },
        true
      );
      if (!result.valid) {
        setError("Invalid TMDB API key");
      } else {
        setError("");
        setStep(SetupStep.RealDebrid);
      }
    } catch (e) {
      setError(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRdTest = async () => {
    if (!rdKey) {
      setError("Enter a Real-Debrid API key");
      return;
    }
    setLoading(true);
    try {
      const result = await apiPost<{ valid: boolean }>(
        "/admin/settings/test-rd",
        { rdApiKey: rdKey },
        true
      );
      if (!result.valid) {
        setError("Invalid Real-Debrid API key");
      } else {
        setError("");
        setStep(SetupStep.FirstProfile);
      }
    } catch (e) {
      setError(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteSetup = async () => {
    if (!profileName) {
      setError("Profile name is required");
      return;
    }
    setLoading(true);
    try {
      const result = await apiPost<{
        adminId: string;
        profileId: string;
      }>(
        "/setup/complete",
        {
          username,
          password,
          tmdbApiKey: tmdbKey,
          rdApiKey: rdKey,
          firstProfileName: profileName,
          firstProfileAvatar: profileAvatar,
        },
        true
      );
      setError("");
      setStep(SetupStep.Complete);
      // Optionally log in admin automatically
      // For now, just redirect to profile picker
      navigate("/profiles");
    } catch (e) {
      setError(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {step === SetupStep.Admin && (
          <StepCard
            title="Create Admin Account"
            description="Set up your admin credentials"
            onNext={handleAdminCreate}
            loading={loading}
            error={error}
          >
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-field mb-4"
            />
            <input
              type="password"
              placeholder="Password (min 8 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
            />
          </StepCard>
        )}

        {step === SetupStep.Tmdb && (
          <StepCard
            title="Enter TMDB API Key"
            description="Get a free key at themoviedb.org/settings/api"
            onNext={handleTmdbTest}
            loading={loading}
            error={error}
            canGoBack={() => setStep(SetupStep.Admin)}
          >
            <input
              type="password"
              placeholder="TMDB API Key"
              value={tmdbKey}
              onChange={(e) => setTmdbKey(e.target.value)}
              className="input-field"
            />
          </StepCard>
        )}

        {step === SetupStep.RealDebrid && (
          <StepCard
            title="Enter Real-Debrid API Key"
            description="Get it from real-debrid.com/account"
            onNext={handleRdTest}
            loading={loading}
            error={error}
            canGoBack={() => setStep(SetupStep.Tmdb)}
          >
            <input
              type="password"
              placeholder="Real-Debrid API Key"
              value={rdKey}
              onChange={(e) => setRdKey(e.target.value)}
              className="input-field"
            />
          </StepCard>
        )}

        {step === SetupStep.FirstProfile && (
          <StepCard
            title="Create First Profile"
            description="Name your first profile"
            onNext={handleCompleteSetup}
            loading={loading}
            error={error}
            canGoBack={() => setStep(SetupStep.RealDebrid)}
          >
            <input
              type="text"
              placeholder="Profile Name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="input-field mb-4"
            />
            <select
              value={profileAvatar}
              onChange={(e) => setProfileAvatar(e.target.value)}
              className="input-field"
            >
              <option value="blue">Blue</option>
              <option value="red">Red</option>
              <option value="green">Green</option>
              <option value="purple">Purple</option>
            </select>
          </StepCard>
        )}

        {step === SetupStep.Complete && (
          <StepCard title="Setup Complete!" description="You're all set!">
            <p>Redirecting to profile picker...</p>
          </StepCard>
        )}
      </div>
    </div>
  );
}

interface StepCardProps {
  title: string;
  description: string;
  onNext?: () => Promise<void>;
  loading?: boolean;
  error?: string;
  children: React.ReactNode;
  canGoBack?: () => void;
}

function StepCard({
  title,
  description,
  onNext,
  loading = false,
  error = "",
  children,
  canGoBack,
}: StepCardProps) {
  return (
    <div className="card">
      <h2 className="text-2xl font-bold mb-2">{title}</h2>
      <p className="text-gray-400 mb-6">{description}</p>
      {children}
      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
      <div className="flex gap-2 mt-6">
        {canGoBack && (
          <button onClick={canGoBack} className="btn-secondary flex-1">
            Back
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            disabled={loading}
            className="btn-primary flex-1"
          >
            {loading ? "Loading..." : "Next"}
          </button>
        )}
      </div>
    </div>
  );
}
```

### 6.8 Page: Login.tsx

Admin login page:

```typescript
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../lib/api";
import { useAuthStore } from "../stores/authStore";

export function Login() {
  const navigate = useNavigate();
  const setAdminTokens = useAuthStore((s) => s.setAdminTokens);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await apiPost<{
        accessToken: string;
        refreshToken: string;
        adminId: string;
      }>(
        "/auth/login",
        { username, password },
        true
      );

      setAdminTokens(
        result.accessToken,
        result.refreshToken,
        result.adminId
      );
      navigate("/admin");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-4">
      <div className="w-full max-w-md card">
        <h1 className="text-3xl font-bold mb-6 text-center">
          <span className="text-[#6366f1]">tadaima</span> Admin
        </h1>

        <form onSubmit={handleLogin}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input-field mb-4"
            disabled={loading}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field mb-4"
            disabled={loading}
          />

          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

### 6.9 Page: ProfilePicker.tsx

Netflix-style profile grid:

```typescript
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";
import { useAuthStore, useProfileStore } from "../stores";

export interface Profile {
  id: string;
  name: string;
  avatar: string;
  hasPin: boolean;
}

export function ProfilePicker() {
  const navigate = useNavigate();
  const adminId = useAuthStore((s) => s.adminId);
  const setCurrentProfile = useProfileStore((s) => s.setCurrentProfile);
  const setProfileToken = useAuthStore((s) => s.setProfileToken);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinModal, setPinModal] = useState<{ profileId: string; name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const list = await apiGet<Profile[]>("/profiles", true);
        setProfiles(list);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelectProfile = async (profile: Profile) => {
    if (profile.hasPin) {
      setPinModal({ profileId: profile.id, name: profile.name });
    } else {
      await completeSelection(profile.id);
    }
  };

  const handlePinSubmit = async () => {
    if (!pinModal) return;
    try {
      const result = await apiPost<{
        profileSessionToken: string;
        profileId: string;
      }>(
        `/profiles/${pinModal.profileId}/select`,
        { pin },
        true
      );
      setProfileToken(result.profileSessionToken, result.profileId);
      setCurrentProfile(
        profiles.find((p) => p.id === result.profileId) || null
      );
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const completeSelection = async (profileId: string) => {
    try {
      const result = await apiPost<{
        profileSessionToken: string;
        profileId: string;
      }>(
        `/profiles/${profileId}/select`,
        {},
        true
      );
      setProfileToken(result.profileSessionToken, result.profileId);
      setCurrentProfile(
        profiles.find((p) => p.id === result.profileId) || null
      );
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">
        <p>Loading profiles...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-12 text-center">
          <span className="text-[#6366f1]">tadaima</span>
        </h1>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 justify-center">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex flex-col items-center cursor-pointer group"
              onClick={() => handleSelectProfile(profile)}
            >
              <div
                className={`w-24 h-24 rounded-lg bg-[#${profile.avatar === "blue" ? "3b82f6" : profile.avatar === "red" ? "ef4444" : profile.avatar === "green" ? "10b981" : "a855f7"}] flex items-center justify-center mb-4 group-hover:opacity-80 transition-opacity`}
              >
                <span className="text-4xl">👤</span>
              </div>
              <p className="text-center font-medium">{profile.name}</p>
            </div>
          ))}
        </div>

        {adminId && (
          <div className="text-center mt-12">
            <button
              onClick={() => navigate("/login")}
              className="btn-secondary"
            >
              Manage Profiles
            </button>
          </div>
        )}

        {error && <p className="text-red-500 text-center mt-4">{error}</p>}

        {pinModal && (
          <PinModal
            profileName={pinModal.name}
            onSubmit={handlePinSubmit}
            onCancel={() => {
              setPinModal(null);
              setPin("");
            }}
          />
        )}
      </div>
    </div>
  );
}

interface PinModalProps {
  profileName: string;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}

function PinModal({ profileName, onSubmit, onCancel }: PinModalProps) {
  const [pin, setPin] = useState("");

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="card w-96">
        <h2 className="text-2xl font-bold mb-4">Enter PIN for {profileName}</h2>
        <input
          type="password"
          maxLength={6}
          placeholder="4-6 digits"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="input-field mb-4 text-center text-2xl tracking-widest"
        />
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={() => {
              onSubmit();
              setPin("");
            }}
            className="btn-primary flex-1"
          >
            Enter
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 6.10 Page: AdminPanel.tsx

Admin management interface (profiles + settings):

```typescript
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api";

interface Profile {
  id: string;
  name: string;
  avatar: string;
  hasPin: boolean;
}

interface Settings {
  rdApiKey: string;
  tmdbApiKey: string;
  setupComplete: boolean;
}

export function AdminPanel() {
  const navigate = useNavigate();
  const adminId = useAuthStore((s) => s.adminId);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!adminId) {
      navigate("/login");
      return;
    }

    (async () => {
      try {
        const [profilesData, settingsData] = await Promise.all([
          apiGet<Profile[]>("/profiles", true),
          apiGet<Settings>("/admin/settings"),
        ]);
        setProfiles(profilesData);
        setSettings(settingsData);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [adminId, navigate]);

  if (loading) {
    return <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Admin Panel</h1>

        {error && <p className="text-red-500 mb-4">{error}</p>}

        {/* Profiles Section */}
        <div className="card mb-8">
          <h2 className="text-2xl font-bold mb-4">Profiles</h2>
          <div className="space-y-4">
            {profiles.map((profile) => (
              <ProfileRow key={profile.id} profile={profile} />
            ))}
          </div>
          <button className="btn-primary mt-4">Add Profile</button>
        </div>

        {/* Settings Section */}
        {settings && (
          <div className="card">
            <h2 className="text-2xl font-bold mb-4">Instance Settings</h2>
            <div className="space-y-4">
              <SettingRow
                label="Real-Debrid API Key"
                value={settings.rdApiKey}
                onChange={(value) =>
                  setSettings({ ...settings, rdApiKey: value })
                }
              />
              <SettingRow
                label="TMDB API Key"
                value={settings.tmdbApiKey}
                onChange={(value) =>
                  setSettings({ ...settings, tmdbApiKey: value })
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ProfileRowProps {
  profile: Profile;
}

function ProfileRow({ profile }: ProfileRowProps) {
  return (
    <div className="flex items-center justify-between bg-[#262626] p-4 rounded-lg">
      <div>
        <p className="font-medium">{profile.name}</p>
        {profile.hasPin && <p className="text-sm text-gray-400">PIN protected</p>}
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary text-sm">Edit</button>
        <button className="btn-secondary text-sm text-red-500">Delete</button>
      </div>
    </div>
  );
}

interface SettingRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function SettingRow({ label, value, onChange }: SettingRowProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      <div className="flex gap-2">
        <input
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field flex-1"
        />
        <button
          onClick={() => setRevealed(!revealed)}
          className="btn-secondary"
        >
          {revealed ? "Hide" : "Show"}
        </button>
        <button className="btn-secondary">Test</button>
      </div>
    </div>
  );
}
```

### 6.11 Page: Search.tsx (Placeholder)

```typescript
export function Search() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Search</h1>
      <input
        type="text"
        placeholder="Search for a movie or show..."
        className="input-field w-full max-w-lg mb-6"
      />
      <p className="text-gray-400">Coming in Phase 3...</p>
    </div>
  );
}
```

### 6.12 Router.tsx

```typescript
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { apiGet } from "./lib/api";
import { SetupWizard } from "./pages/SetupWizard";
import { Login } from "./pages/Login";
import { ProfilePicker } from "./pages/ProfilePicker";
import { AdminPanel } from "./pages/AdminPanel";
import { Search } from "./pages/Search";
import { AppShell } from "./components/AppShell";

export function Router() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const status = await apiGet<{ needsSetup: boolean }>(
          "/setup/status",
          true
        );
        setNeedsSetup(status.needsSetup);
      } catch {
        setNeedsSetup(false);
      }
    })();
  }, []);

  if (needsSetup === null) {
    return <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">Loading...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        {needsSetup ? (
          <Route path="*" element={<SetupWizard />} />
        ) : (
          <>
            <Route path="/setup" element={<Navigate to="/profiles" />} />
            <Route path="/login" element={<Login />} />
            <Route path="/profiles" element={<ProfilePicker />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route
              path="/*"
              element={
                <AppShell>
                  <Routes>
                    <Route path="/" element={<Search />} />
                    <Route path="/downloads" element={<div>Downloads - Coming soon</div>} />
                    <Route path="/devices" element={<div>Devices - Coming soon</div>} />
                  </Routes>
                </AppShell>
              }
            />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
```

### 6.13 Component: AppShell.tsx

```typescript
import { Sidebar } from "./Sidebar";
import { ConnectionStatus } from "./ConnectionStatus";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen bg-[#0f0f0f]">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-12 bg-[#1a1a1a] border-b border-[#333333] flex items-center px-6 gap-2">
          <ConnectionStatus />
          <p className="text-sm text-gray-400">Connection status</p>
        </div>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
```

### 6.14 Component: Sidebar.tsx

```typescript
import { useNavigate } from "react-router-dom";
import { useAuthStore, useProfileStore } from "../stores";

export function Sidebar() {
  const navigate = useNavigate();
  const clearProfile = useAuthStore((s) => s.clearProfile);
  const currentProfile = useProfileStore((s) => s.currentProfile);

  const handleSwitchProfile = () => {
    clearProfile();
    navigate("/profiles");
  };

  return (
    <div className="w-64 bg-[#1a1a1a] border-r border-[#333333] flex flex-col">
      {/* Profile Header */}
      <div className="p-6 border-b border-[#333333]">
        {currentProfile && (
          <button
            onClick={handleSwitchProfile}
            className="w-full text-left hover:opacity-80 transition"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-[#6366f1] flex items-center justify-center">
                👤
              </div>
              <div>
                <p className="font-medium">{currentProfile.name}</p>
                <p className="text-xs text-gray-400">Switch profile</p>
              </div>
            </div>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-6 space-y-2">
        <NavLink
          label="Search"
          onClick={() => navigate("/")}
        />
        <NavLink
          label="Downloads"
          onClick={() => navigate("/downloads")}
        />
        <NavLink
          label="Devices"
          onClick={() => navigate("/devices")}
        />
      </nav>

      {/* Footer */}
      <div className="p-6 border-t border-[#333333]">
        <button
          onClick={() => navigate("/login")}
          className="w-full btn-secondary text-sm"
        >
          Manage
        </button>
      </div>
    </div>
  );
}

interface NavLinkProps {
  label: string;
  onClick: () => void;
}

function NavLink({ label, onClick }: NavLinkProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-2 rounded-lg hover:bg-[#262626] transition text-gray-300 hover:text-white"
    >
      {label}
    </button>
  );
}
```

### 6.15 Component: ConnectionStatus.tsx

Placeholder for Phase 4+ (WebSocket connection):

```typescript
export function ConnectionStatus() {
  // Placeholder: always show green for now
  return (
    <div className="w-3 h-3 rounded-full bg-green-500" title="Connected" />
  );
}
```

### 6.16 App.tsx

```typescript
import { Router } from "./Router";

export function App() {
  return <Router />;
}
```

---

## 7. Testing Strategy

### 7.1 Relay Tests

Create `packages/relay/src/__tests__/` with test files:

#### auth.service.test.ts

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { CryptoService } from "../services/crypto.service";
import { AuthService } from "../services/auth.service";

describe("AuthService", () => {
  it("should hash passwords correctly", async () => {
    const password = "testPassword123";
    const hash = await CryptoService.hashPassword(password);
    expect(await CryptoService.comparePassword(password, hash)).toBe(true);
    expect(await CryptoService.comparePassword("wrongPassword", hash)).toBe(
      false
    );
  });

  it("should generate and verify JWT tokens", async () => {
    const secret = CryptoService.generateJwtSecret();
    const token = await CryptoService.generateAccessToken(
      secret,
      "test-admin-id",
      "admin"
    );
    const payload = await CryptoService.verifyToken(secret, token);
    expect(payload.sub).toBe("test-admin-id");
    expect(payload.type).toBe("admin");
  });
});
```

#### crypto.service.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { CryptoService } from "../services/crypto.service";

describe("CryptoService", () => {
  it("should encrypt and decrypt values", () => {
    process.env.ENCRYPTION_MASTER_KEY = "a".repeat(64);
    const plaintext = "sensitive-api-key-12345";
    const encrypted = CryptoService.encryptValue(plaintext);
    const decrypted = CryptoService.decryptValue(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should hash tokens for storage", () => {
    const token = "jwt-token-abc-123";
    const hash = CryptoService.hashToken(token);
    expect(hash).toHaveLength(64); // SHA-256 hex
  });
});
```

#### profile.service.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { ProfileService } from "../services/profile.service";

describe("ProfileService", () => {
  it("should create profile with PIN", async () => {
    // Mock DB
    const service = new ProfileService({} as any);
    // Implementation would require mocking database
  });
});
```

### 7.2 Execution Order

Claude Code should run tests after implementation:

```bash
pnpm --filter @tadaima/relay test
```

---

## 8. Execution Order

Claude Code should execute these steps in this exact order:

### Phase 2A: Database & Backend Services

1. **Create migration files**: `002_create_admin.sql` through `006_create_recently_viewed.sql`
2. **Run migrations** via Drizzle (setup in Phase 1)
3. **Create crypto service**: `packages/relay/src/services/crypto.service.ts`
4. **Create validation service**: `packages/relay/src/services/validation.service.ts`
5. **Create auth service**: `packages/relay/src/services/auth.service.ts`
6. **Create profile service**: `packages/relay/src/services/profile.service.ts`
7. **Create settings service**: `packages/relay/src/services/settings.service.ts`
8. **Create auth middleware**: `packages/relay/src/middleware/auth.ts`
9. **Create types**: `packages/relay/src/types/auth.ts`, `profile.ts`, `settings.ts`
10. **Create route handlers**: `packages/relay/src/routes/setup.ts`, `auth.ts`, `profiles.ts`, `admin.ts`
11. **Wire routes into main app**: Update `packages/relay/src/index.ts` to register routes
12. **Update relay package.json**: Add jose, bcryptjs dependencies
13. **Create test files**: Auth, crypto, profile, settings tests
14. **Run `pnpm --filter @tadaima/relay install`** → verify dependencies
15. **Run `pnpm --filter @tadaima/relay typecheck`** → verify zero type errors
16. **Run `pnpm --filter @tadaima/relay test`** → verify tests pass

### Phase 2B: Web App Frontend

17. **Update web package.json**: Add react-router-dom, zustand, @tanstack/react-query
18. **Create stores**: `packages/web/src/stores/authStore.ts`, `profileStore.ts`, `wsStore.ts`
19. **Create lib files**: `packages/web/src/lib/api.ts`, `validation.ts`, `constants.ts`
20. **Update dark theme CSS**: `packages/web/src/index.css`
21. **Create page components**:
    - `packages/web/src/pages/SetupWizard.tsx`
    - `packages/web/src/pages/Login.tsx`
    - `packages/web/src/pages/ProfilePicker.tsx`
    - `packages/web/src/pages/AdminPanel.tsx`
    - `packages/web/src/pages/Search.tsx`
    - `packages/web/src/pages/NotFound.tsx`
22. **Create layout components**:
    - `packages/web/src/components/AppShell.tsx`
    - `packages/web/src/components/Sidebar.tsx`
    - `packages/web/src/components/ProfileHeader.tsx`
    - `packages/web/src/components/ConnectionStatus.tsx`
23. **Create shared components**: Various UI components (inputs, modals, cards)
24. **Create Router.tsx**: Main routing logic
25. **Update App.tsx**: Call Router
26. **Run `pnpm --filter @tadaima/web install`**
27. **Run `pnpm --filter @tadaima/web typecheck`**
28. **Run `pnpm build`** → verify all packages build
29. **Run `pnpm lint`** → verify zero lint errors
30. **Start dev servers**: `pnpm dev`
31. **Manual testing** (see verification checklist below)

---

## 9. Verification Checklist

Every item must pass before Phase 2 is considered complete:

| # | Check | How to verify |
|---|-------|---------------|
| 1 | All migrations run without error | `docker compose logs postgres` shows no errors |
| 2 | Relay endpoints compile | `pnpm --filter @tadaima/relay build` exits 0 |
| 3 | Web app compiles | `pnpm --filter @tadaima/web build` exits 0 |
| 4 | All tests pass | `pnpm test` exits 0 |
| 5 | Setup status endpoint responds | `curl http://localhost:3000/api/setup/status` → `{"needsSetup": true}` on fresh DB |
| 6 | Setup wizard loads on web | Open `http://localhost:5173` → see wizard |
| 7 | Admin account can be created via API | POST to `/setup/complete` with valid data → 201 |
| 8 | Setup is locked after admin created | Second call to `/setup/complete` → 409 |
| 9 | Admin login works | POST `/api/auth/login` with correct credentials → JWT tokens |
| 10 | Invalid login fails | POST `/api/auth/login` with wrong password → 401 |
| 11 | JWT token can be verified | Access token decodes and validates |
| 12 | Refresh token rotation works | POST `/api/auth/refresh` with old token → new pair, old revoked |
| 13 | Profiles CRUD works | Create, read, update, delete via admin endpoints |
| 14 | Profile list is public | GET `/api/profiles` with no auth → works |
| 15 | Profile selection without PIN | POST `/api/profiles/:id/select` → profile session token |
| 16 | Profile selection with PIN | POST with PIN → validates, returns token or 401 |
| 17 | Instance settings are masked | GET `/api/admin/settings` → keys show only last 4 chars |
| 18 | API key validation works | POST `/api/admin/settings/test-rd` validates RD key |
| 19 | Web app first-run flow | Complete setup wizard end-to-end on fresh instance |
| 20 | Profile picker displays | Profiles appear in grid, clickable |
| 21 | Admin panel requires auth | Accessing `/admin` with no token redirects to login |
| 22 | Admin login page works | Can enter credentials, submit, get redirected to admin panel |
| 23 | Sidebar navigation works | Clicking links navigates to pages |
| 24 | Dark theme is applied | Background is #0f0f0f, accent is #6366f1 |
| 25 | Type safety | Zero TypeScript errors in all packages |
| 26 | Linting passes | Zero ESLint errors |

---

## 10. Common Pitfalls

1. **Do NOT store JWT secret in plaintext** in settings. Encrypt it with AES-256-GCM. Requires `ENCRYPTION_MASTER_KEY` env var.

2. **Do NOT use `auth/token` endpoint** for public data (like profile list). The setup wizard needs to fetch profiles before logging in.

3. **Do NOT allow profile selection to issue admin tokens**. Profile session tokens (`type: "profile"`) are strictly scoped to non-admin operations.

4. **Do NOT skip PIN validation**. Even though PIN is 4-6 digits (weak), some users will set it for parental controls. Validate bcrypt hash correctly.

5. **Do NOT forget to revoke old refresh tokens** when issuing new ones. Otherwise old tokens can still be used until expiry.

6. **Do NOT hash refresh token plaintext** directly to the database. Hash it with SHA-256 so a DB breach doesn't leak tokens.

7. **Do NOT expose full error messages from API key validation**. Return generic "Invalid key" to prevent leaking whether a username exists.

8. **Do NOT cache instance settings** in memory without a TTL. If an admin updates API keys, the change should take effect within ~30 seconds.

9. **Do NOT allow profile deletion if it's the only profile**. This would leave the app in an invalid state.

10. **Do NOT use localStorage for profile session tokens** in web app. Use zustand in-memory only, so tokens are cleared on refresh.

11. **Setup wizard validation must match API validation**. If relay requires password min 8 chars, web form must also enforce it.

12. **ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex chars)**. Validate on app startup and fail fast if missing or incorrect length.

13. **Test data in dev**: Use `.env` with `ENCRYPTION_MASTER_KEY=aaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkkkllllmmmmnnnnoooopppp` (64 'a's, 'b's, etc.).

---

## 11. Decision Points

> **✅ RESOLVED**: Encryption master key → `ENCRYPTION_MASTER_KEY` environment variable. For development, set in `.env`. For production (Railway), set as a secret.

> **✅ RESOLVED**: Profile selection does NOT require admin login. The profile picker is open to anyone. Admin login is only needed for managing profiles and settings.

> **✅ RESOLVED**: First profile creation is mandatory in the setup wizard. The app is useless without at least one profile.

---

## 12. Environment Variables Reference

**Relay `.env` (in addition to Phase 0)**:

```env
PORT=3000
DATABASE_URL=postgres://tadaima:tadaima@localhost:5432/tadaima_dev
ENCRYPTION_MASTER_KEY=aaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkkkllllmmmmnnnnoooopppp
```

**Web** (no .env needed; proxies through Vite)

---

## 13. API Key Test Values

For manual testing, use:

- **TMDB API Key**: Request free key at themoviedb.org/settings/api (real key)
- **Real-Debrid API Key**: Request from real-debrid.com/account (real key)

In test environments, you can mock these endpoints to return 200 OK:

```typescript
// Mock RD endpoint
if (process.env.NODE_ENV === "test") {
  // Return 200 for any key
}
```

---

## 14. Summary

Phase 2 builds the complete auth and profile management system. The relay provides REST endpoints for setup, login, and profile CRUD. The web app provides a polished first-run wizard, login page, profile picker, and admin panel. All sensitive data (passwords, API keys, JWT secrets) is encrypted at rest. Tokens are short-lived for security and implement proper refresh rotation.

After Phase 2:
- Admin can set up the instance and manage profiles
- Users can pick a profile and enter the app shell
- The sidebar is wired and placeholders are in place for search/downloads/devices
- Phase 3 can focus on the search API and download flow without worrying about auth
