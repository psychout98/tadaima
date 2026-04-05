# Phase 9: Testing & Hardening — Detailed Spec

> **Goal**: Comprehensive test coverage, error handling audit, and edge case hardening across all packages. After this phase, the system is resilient to bad input, network failures, stale state, and RD key rotation — with automated tests proving it.

---

## Table of Contents

1. [Overview](#overview)
2. [Testing Infrastructure](#testing-infrastructure)
3. [Shared Package Tests](#shared-package-tests)
4. [Relay Unit & Integration Tests](#relay-unit--integration-tests)
5. [Relay WebSocket Test Harness](#relay-websocket-test-harness)
6. [Web Component Tests](#web-component-tests)
7. [Web E2E Tests (Playwright)](#web-e2e-tests-playwright)
8. [Agent Unit Tests](#agent-unit-tests)
9. [Agent Integration Tests](#agent-integration-tests)
10. [RD Key Rotation Handling](#rd-key-rotation-handling)
11. [Error Handling Audit](#error-handling-audit)
12. [Edge Cases & Hardening](#edge-cases--hardening)
13. [Coverage Targets & Reporting](#coverage-targets--reporting)
14. [Implementation Order](#implementation-order)
15. [Common Pitfalls](#common-pitfalls)

---

## Overview

### Packages Under Test

| Package | Test Framework | Coverage Target | Focus Areas |
|---------|---------------|-----------------|-------------|
| `shared` | Vitest | 100% | Zod schemas, utility functions, path builders |
| `relay` | Vitest + Supertest | 90%+ (service logic) | HTTP endpoints, WebSocket routing, download queue, auth |
| `web` | Vitest + @testing-library/react + Playwright | Components: 80%+, E2E: all acceptance criteria | React components, zustand stores, WebSocket client, full user flows |
| `agent` | Vitest | 90%+ (download pipeline) | RD client, download handler, media organizer, WebSocket client |

### Key Principles

1. **Test behavior, not implementation** — assert on outputs, not internal state
2. **Mock at boundaries** — mock HTTP, WebSocket, filesystem, and database; never mock internal modules
3. **Fixtures over factories** — use shared fixture files for consistent test data across packages
4. **Fast by default** — unit tests run in-memory with no I/O; integration tests use real Postgres via Docker
5. **No flaky tests** — no `setTimeout` hacks, no retry loops, no network-dependent assertions

---

## Testing Infrastructure

### 1. Shared Test Configuration

**File**: `vitest.workspace.ts` (root)

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared/vitest.config.ts',
  'packages/relay/vitest.config.ts',
  'packages/web/vitest.config.ts',
  'packages/agent/vitest.config.ts',
]);
```

Each package has its own `vitest.config.ts` with package-specific settings (e.g., `jsdom` environment for web, `node` for relay/agent).

### 2. Test Database Setup (Relay)

**File**: `packages/relay/src/test/setup.ts`

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://tadaima:tadaima@localhost:5432/tadaima_test';

let pool: pg.Pool;
let db: ReturnType<typeof drizzle>;

export async function setupTestDb() {
  pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle' });
  return db;
}

export async function teardownTestDb() {
  await pool.end();
}

export async function cleanTestDb(db: Database) {
  // Truncate all tables in reverse dependency order
  await db.execute(sql`
    TRUNCATE download_history, download_queue, pairing_codes,
    devices, recently_viewed, refresh_tokens, profiles,
    instance_settings, admin CASCADE
  `);
}
```

**Docker Compose addition** (for test database):

```yaml
# docker-compose.test.yml
services:
  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: tadaima_test
      POSTGRES_USER: tadaima
      POSTGRES_PASSWORD: tadaima
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data  # RAM-backed for speed
```

### 3. Shared Test Fixtures

**Directory**: `packages/shared/src/test/fixtures/`

```typescript
// fixtures/profiles.ts
export const testProfile = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Noah',
  avatar: 'blue',
  pinHash: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

export const testProfileWithPin = {
  ...testProfile,
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Dad',
  pinHash: '$2b$10$...',  // bcrypt hash of "1234"
};

// fixtures/devices.ts
export const testDevice = {
  id: '660e8400-e29b-41d4-a716-446655440000',
  profileId: testProfile.id,
  name: 'noah-macbook',
  platform: 'macos' as const,
  tokenHash: 'sha256...',
  isOnline: false,
  isDefault: true,
  lastSeenAt: new Date('2025-01-01'),
  createdAt: new Date('2025-01-01'),
};

// fixtures/messages.ts
export const testDownloadRequest = {
  id: '01HQXYZ...',
  type: 'download:request' as const,
  timestamp: Date.now(),
  payload: {
    tmdbId: 157336,
    imdbId: 'tt0816692',
    title: 'Interstellar',
    year: 2014,
    mediaType: 'movie' as const,
    magnet: 'magnet:?xt=urn:btih:abc123...',
    torrentName: 'Interstellar.2014.2160p.UHD.BluRay.x265',
    expectedSize: 45_000_000_000,
  },
};

export const testDownloadRequestTv = {
  id: '01HQXYZ...',
  type: 'download:request' as const,
  timestamp: Date.now(),
  payload: {
    tmdbId: 1396,
    imdbId: 'tt0903747',
    title: 'Breaking Bad',
    year: 2008,
    mediaType: 'tv' as const,
    season: 5,
    episode: 16,
    episodeTitle: 'Felina',
    magnet: 'magnet:?xt=urn:btih:def456...',
    torrentName: 'Breaking.Bad.S05E16.1080p.BluRay',
    expectedSize: 1_800_000_000,
  },
};
```

### 4. Mock Utilities

**File**: `packages/agent/src/test/mocks/rd-api.ts`

```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const RD_BASE = 'https://api.real-debrid.com/rest/1.0';

export const rdHandlers = [
  http.post(`${RD_BASE}/torrents/addMagnet`, () => {
    return HttpResponse.json({ id: 'rd-torrent-123', uri: `${RD_BASE}/torrents/info/rd-torrent-123` });
  }),

  http.post(`${RD_BASE}/torrents/selectFiles/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${RD_BASE}/torrents/info/:id`, () => {
    return HttpResponse.json({
      id: 'rd-torrent-123',
      status: 'downloaded',
      links: ['https://real-debrid.com/d/abc123'],
    });
  }),

  http.post(`${RD_BASE}/unrestrict/link`, () => {
    return HttpResponse.json({
      download: 'https://download.real-debrid.com/d/abc123/Interstellar.mkv',
      filesize: 45_000_000_000,
      filename: 'Interstellar.2014.2160p.UHD.BluRay.x265.mkv',
    });
  }),

  http.get(`${RD_BASE}/torrents/instantAvailability/:hashes`, () => {
    return HttpResponse.json({
      abc123: { rd: [{ 1: { filename: 'movie.mkv', filesize: 45_000_000_000 } }] },
    });
  }),
];

export const rdServer = setupServer(...rdHandlers);
```

> **✅ RESOLVED**: Use `msw` (Mock Service Worker) for HTTP mocking. It intercepts at the network level and works with both `got` and native `fetch`. Framework-agnostic.

**File**: `packages/relay/src/test/mocks/ws-client.ts`

```typescript
import { EventEmitter } from 'events';

/**
 * Lightweight mock WebSocket for testing relay message routing.
 * Tracks sent messages for assertion.
 */
export class MockWebSocket extends EventEmitter {
  sent: unknown[] = [];
  readyState = 1; // OPEN

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string) {
    this.readyState = 3; // CLOSED
    this.emit('close', code, reason);
  }

  /** Simulate receiving a message from the client */
  simulateMessage(data: unknown) {
    this.emit('message', JSON.stringify(data));
  }
}
```

---

## Shared Package Tests

**Directory**: `packages/shared/src/__tests__/`

### 3.1 Zod Schema Tests

**File**: `schemas.test.ts`

Test every schema with valid and invalid fixtures. Pattern:

```typescript
import { describe, it, expect } from 'vitest';
import {
  downloadRequestSchema,
  downloadProgressSchema,
  downloadCompletedSchema,
  downloadFailedSchema,
  downloadQueuedSchema,
  downloadCancelSchema,
  agentHelloSchema,
  agentHeartbeatSchema,
  deviceStatusSchema,
  cacheCheckSchema,
  cacheResultSchema,
  errorMessageSchema,
} from '../schemas';
import { testDownloadRequest, testDownloadRequestTv } from '../test/fixtures/messages';

describe('downloadRequestSchema', () => {
  it('parses a valid movie download request', () => {
    const result = downloadRequestSchema.safeParse(testDownloadRequest);
    expect(result.success).toBe(true);
  });

  it('parses a valid TV download request with season/episode', () => {
    const result = downloadRequestSchema.safeParse(testDownloadRequestTv);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const invalid = { ...testDownloadRequest, payload: { tmdbId: 123 } };
    const result = downloadRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects invalid mediaType', () => {
    const invalid = {
      ...testDownloadRequest,
      payload: { ...testDownloadRequest.payload, mediaType: 'music' },
    };
    const result = downloadRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts TV request without optional episodeTitle', () => {
    const { episodeTitle, ...payloadWithout } = testDownloadRequestTv.payload;
    const result = downloadRequestSchema.safeParse({
      ...testDownloadRequestTv,
      payload: payloadWithout,
    });
    expect(result.success).toBe(true);
  });
});
```

**Coverage**: every schema gets the same treatment — valid fixture, invalid fixture (missing fields, wrong types, out-of-range values), optional field permutations.

**Schemas to test** (complete list):
- `downloadRequestSchema`
- `downloadCancelSchema`
- `downloadAcceptedSchema`
- `downloadProgressSchema`
- `downloadCompletedSchema`
- `downloadFailedSchema`
- `downloadRejectedSchema`
- `downloadQueuedSchema`
- `cacheCheckSchema`
- `cacheResultSchema`
- `agentHelloSchema`
- `agentHeartbeatSchema`
- `deviceStatusSchema`
- `errorMessageSchema`

### 3.2 Utility Function Tests

**File**: `utils.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { createMessageId, createTimestamp, sanitizeFilename, buildMoviePath, buildEpisodePath } from '../utils';

describe('createMessageId', () => {
  it('returns a ULID string', () => {
    const id = createMessageId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID regex
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createMessageId()));
    expect(ids.size).toBe(100);
  });
});

describe('createTimestamp', () => {
  it('returns a number close to Date.now()', () => {
    const ts = createTimestamp();
    expect(Math.abs(ts - Date.now())).toBeLessThan(100);
  });
});

describe('sanitizeFilename', () => {
  it('removes illegal characters', () => {
    expect(sanitizeFilename('Movie: The "Sequel"')).toBe('Movie - The Sequel');
  });

  it('replaces colons with dash', () => {
    expect(sanitizeFilename('Title: Part 2')).toBe('Title - Part 2');
  });

  it('collapses multiple spaces', () => {
    expect(sanitizeFilename('A   B   C')).toBe('A B C');
  });

  it('strips leading/trailing dots, spaces, dashes', () => {
    expect(sanitizeFilename('...hello---')).toBe('hello');
  });

  it('removes < > / \\ | ? *', () => {
    expect(sanitizeFilename('a<b>c/d\\e|f?g*h')).toBe('abcdefgh');
  });

  it('handles empty string', () => {
    expect(sanitizeFilename('')).toBe('');
  });

  it('handles string that becomes empty after sanitization', () => {
    expect(sanitizeFilename('...')).toBe('');
  });
});

describe('buildMoviePath', () => {
  it('builds Plex-compatible movie path', () => {
    const result = buildMoviePath('Interstellar', 2014, 157336, '.mkv');
    expect(result).toBe('Interstellar (2014) [tmdb-157336]/Interstellar (2014).mkv');
  });

  it('sanitizes title in path', () => {
    const result = buildMoviePath('Movie: The Sequel', 2020, 12345, '.mp4');
    expect(result).toBe('Movie - The Sequel (2020) [tmdb-12345]/Movie - The Sequel (2020).mp4');
  });
});

describe('buildEpisodePath', () => {
  it('builds Plex-compatible TV episode path', () => {
    const result = buildEpisodePath('Breaking Bad', 1396, 5, 16, 'Felina', '.mkv');
    expect(result).toBe('Breaking Bad [tmdb-1396]/Season 05/S05E16 - Felina.mkv');
  });

  it('handles missing episode title', () => {
    const result = buildEpisodePath('Show', 999, 1, 1, undefined, '.mkv');
    expect(result).toBe('Show [tmdb-999]/Season 01/S01E01.mkv');
  });

  it('zero-pads season and episode numbers', () => {
    const result = buildEpisodePath('Show', 999, 1, 3, 'Ep', '.mkv');
    expect(result).toContain('Season 01');
    expect(result).toContain('S01E03');
  });
});
```

**Target**: 100% line and branch coverage on shared package.

---

## Relay Unit & Integration Tests

**Directory**: `packages/relay/src/__tests__/`

### 4.1 Admin Auth Service Tests

**File**: `services/auth.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, cleanTestDb } from '../test/setup';

describe('Admin Auth Service', () => {
  let db: Database;

  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await teardownTestDb(); });
  beforeEach(async () => { await cleanTestDb(db); });

  describe('createAdmin', () => {
    it('creates admin with hashed password', async () => { /* ... */ });
    it('rejects if admin already exists', async () => { /* ... */ });
    it('rejects username shorter than 3 characters', async () => { /* ... */ });
    it('rejects password shorter than 8 characters', async () => { /* ... */ });
  });

  describe('login', () => {
    it('returns access + refresh tokens on valid credentials', async () => { /* ... */ });
    it('returns 401 on wrong password', async () => { /* ... */ });
    it('returns 401 on unknown username', async () => { /* ... */ });
    it('stores refresh token hash in database', async () => { /* ... */ });
  });

  describe('refreshToken', () => {
    it('issues new token pair and revokes old refresh token', async () => { /* ... */ });
    it('rejects expired refresh token', async () => { /* ... */ });
    it('rejects already-revoked refresh token', async () => { /* ... */ });
  });

  describe('logout', () => {
    it('revokes the refresh token', async () => { /* ... */ });
  });
});
```

### 4.2 Profile Service Tests

**File**: `services/profiles.test.ts`

Test cases:
- Create profile (name, avatar, optional PIN)
- Create profile — name uniqueness enforced
- List profiles — returns id, name, avatar, hasPin (never returns pinHash)
- Update profile — change name, avatar, PIN
- Delete profile — cascades (devices, queue, history, recently viewed)
- Select profile — no PIN → returns profile session token
- Select profile — correct PIN → returns token
- Select profile — wrong PIN → returns 403
- Max profile limit (if any — currently no stated limit)

### 4.3 Pairing Service Tests

**File**: `services/pairing.test.ts`

Test cases:
- Generate pairing code — returns 6-char code excluding ambiguous chars
- Generate code — only one active code per profile
- Claim code — valid → returns deviceId, deviceToken, rdApiKey, wsUrl
- Claim code — expired → 404
- Claim code — already claimed → 409
- Claim code — unknown code → 404
- Max 5 devices per profile → rejects 6th pairing attempt
- First device set as default automatically
- RD API key included in claim response (read from instance_settings)

### 4.4 Download Queue Service Tests

**File**: `services/downloadQueue.test.ts`

Test cases:
- Queue a download → creates row with status "queued"
- Deliver queued downloads on agent hello → status changes to "delivered", deliveredAt set
- Cancel queued download → deletes row
- Expire downloads older than 14 days → status changes to "expired"
- Delivery returns items in FIFO order (oldest first)
- Only delivers items matching the connecting agent's profileId + deviceId
- Empty queue → delivers nothing (no error)
- Delivered items are not re-delivered on subsequent connects

### 4.5 Download History Service Tests

**File**: `services/downloadHistory.test.ts`

Test cases:
- Create history entry on download:completed
- Create history entry on download:failed (includes error + retryable flag)
- List history — paginated, newest first
- List history — filterable by status
- Delete history entry
- History scoped to profile (profile A can't see profile B's history)

### 4.6 Instance Settings Service Tests

**File**: `services/instanceSettings.test.ts`

Test cases:
- Set and retrieve TMDB API key
- Set and retrieve RD API key (stored encrypted, returned masked)
- Test RD key — valid key returns user info
- Test RD key — invalid key returns error
- Test TMDB key — valid key returns configuration
- Test TMDB key — invalid key returns error
- Settings persist across service restarts

### 4.7 HTTP Endpoint Integration Tests

**File**: `routes/*.test.ts`

Use Supertest against the Hono app instance with a real test database:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { app } from '../app';
import { setupTestDb, teardownTestDb, cleanTestDb } from '../test/setup';

// Helper to create admin + get token for authenticated tests
async function createAdminAndLogin(app) {
  await app.request('/api/setup/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'testpass123',
      tmdbApiKey: 'test-tmdb-key',
      rdApiKey: 'test-rd-key',
      profileName: 'Noah',
      profileAvatar: 'blue',
    }),
  });

  const loginRes = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'testpass123' }),
  });

  const { accessToken } = await loginRes.json();
  return accessToken;
}
```

**Endpoint test matrix:**

| Route | Method | Auth | Test Cases |
|-------|--------|------|------------|
| `/api/setup/status` | GET | None | Returns `needsSetup: true` on fresh DB, `false` after setup |
| `/api/setup/complete` | POST | None | Creates admin, stores settings, creates profile; rejects second call |
| `/api/auth/login` | POST | None | Valid creds → tokens; invalid → 401 |
| `/api/auth/refresh` | POST | None | Valid refresh → new pair; expired → 401 |
| `/api/auth/logout` | POST | Admin | Revokes refresh token |
| `/api/profiles` | GET | None | Lists profiles (public endpoint) |
| `/api/profiles` | POST | Admin | Creates profile; rejects duplicate name |
| `/api/profiles/:id` | PATCH | Admin | Updates name/avatar/PIN |
| `/api/profiles/:id` | DELETE | Admin | Deletes profile + cascade |
| `/api/profiles/:id/select` | POST | None | PIN validation, returns session token |
| `/api/admin/settings` | GET | Admin | Returns masked keys |
| `/api/admin/settings` | PATCH | Admin | Updates keys (encrypted storage) |
| `/api/admin/settings/test-rd` | POST | Admin | Validates RD key against upstream |
| `/api/admin/settings/test-tmdb` | POST | Admin | Validates TMDB key against upstream |
| `/api/devices` | GET | Profile | Lists devices for profile |
| `/api/devices/:id` | PATCH | Profile | Rename, set default |
| `/api/devices/:id` | DELETE | Profile | Revoke device |
| `/api/devices/pair/request` | POST | Profile | Generate pairing code |
| `/api/devices/pair/claim` | POST | None | Claim code → device credentials |
| `/api/agent/config` | GET | Device | Returns current RD key |
| `/api/search` | GET | Profile | TMDB proxy (mock upstream) |
| `/api/media/:type/:tmdbId` | GET | Profile | TMDB detail proxy |
| `/api/streams/:type/:imdbId` | GET | Profile | Torrentio proxy |
| `/api/recently-viewed` | GET | Profile | List recently viewed |
| `/api/recently-viewed` | POST | Profile | Upsert recently viewed |
| `/api/downloads` | GET | Profile | Paginated history |
| `/api/downloads/:id` | DELETE | Profile | Remove history entry |
| `/api/version` | GET | None | Returns version info |

For each endpoint, test:
1. Happy path (correct auth, valid input)
2. Auth rejection (missing token, wrong token type, expired token)
3. Validation failure (bad input → 422)
4. Not found (invalid ID → 404)
5. Upstream failure (for proxy routes → 502)

---

## Relay WebSocket Test Harness

**File**: `packages/relay/src/__tests__/websocket.test.ts`

### 5.1 Connection Tests

```typescript
describe('WebSocket Connections', () => {
  it('accepts agent connection with valid device token', async () => { /* ... */ });
  it('rejects agent connection with invalid token (close 4001)', async () => { /* ... */ });
  it('rejects agent connection with expired token (close 4001)', async () => { /* ... */ });
  it('accepts client connection with valid profile session token', async () => { /* ... */ });
  it('rejects client connection with invalid token (close 4001)', async () => { /* ... */ });
  it('adds agent to connection pool on connect', async () => { /* ... */ });
  it('removes agent from pool on disconnect', async () => { /* ... */ });
  it('updates devices.is_online on connect/disconnect', async () => { /* ... */ });
  it('broadcasts device:status to profile clients on agent connect', async () => { /* ... */ });
  it('broadcasts device:status to profile clients on agent disconnect', async () => { /* ... */ });
});
```

### 5.2 Message Routing Tests

```typescript
describe('Message Routing', () => {
  it('routes download:request from client to target agent', async () => { /* ... */ });
  it('routes download:request to default agent when no targetDeviceId', async () => { /* ... */ });
  it('routes download:progress from agent to all profile clients', async () => { /* ... */ });
  it('routes download:completed from agent to all profile clients', async () => { /* ... */ });
  it('routes download:failed from agent to all profile clients', async () => { /* ... */ });
  it('routes cache:check from client to specified agent', async () => { /* ... */ });
  it('routes cache:result from agent to requesting client', async () => { /* ... */ });
  it('consumes agent:heartbeat (does NOT forward to clients)', async () => { /* ... */ });
  it('updates last_seen_at on heartbeat', async () => { /* ... */ });
  it('queues download:request when target agent is offline', async () => { /* ... */ });
  it('responds with download:queued when request is queued', async () => { /* ... */ });
});
```

### 5.3 Profile Isolation Tests

```typescript
describe('Profile Isolation', () => {
  it('agent for profile A does not receive messages from profile B client', async () => { /* ... */ });
  it('client for profile A does not receive events from profile B agent', async () => { /* ... */ });
  it('device:status for profile A not broadcast to profile B clients', async () => { /* ... */ });
  it('download:request rejects when targetDeviceId belongs to different profile', async () => { /* ... */ });
});
```

### 5.4 Heartbeat & Timeout Tests

```typescript
describe('Heartbeat & Timeout', () => {
  it('agent marked offline after 90 seconds without heartbeat', async () => { /* ... */ });
  it('heartbeat resets the offline timer', async () => { /* ... */ });
  it('multiple heartbeats update last_seen_at each time', async () => { /* ... */ });
});
```

### 5.5 Test Approach

For WebSocket tests, start the Hono server on a random port, connect real WebSocket clients, and assert on messages received:

```typescript
import { WebSocket } from 'ws';

async function connectAgent(port: number, deviceToken: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/agent?token=${deviceToken}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function connectClient(port: number, profileToken: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${profileToken}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, type?: string): Promise<any> {
  return new Promise((resolve) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (!type || msg.type === type) resolve(msg);
    });
  });
}
```

---

## Web Component Tests

**Directory**: `packages/web/src/__tests__/`

### 6.1 Test Environment

```typescript
// packages/web/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false, // Skip CSS processing for speed
  },
});
```

```typescript
// packages/web/src/test/setup.ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

### 6.2 Component Test Matrix

| Component | Key Test Cases |
|-----------|---------------|
| `SetupWizard` | Step progression, validation, API key test buttons, completion redirect |
| `LoginPage` | Submit with valid creds, error state on 401, loading state |
| `ProfilePicker` | Renders profiles, click selects profile, PIN modal for PIN-protected profiles |
| `AdminPanel` | Profile list, create/edit/delete, settings form, usage stats display |
| `SearchPage` | Search input, results grid rendering, empty state, loading state |
| `StreamPicker` | Stream table, filter chips, filter logic (OR within / AND across), RD cache badges |
| `TvSelector` | Season dropdown, episode list, stream fetch on selection |
| `DevicesPage` | Device list, online/offline status, pair flow, rename, revoke, empty state |
| `DownloadsPage` | Active/queued/history sections, progress bars, filter tabs, cancel, retry |
| `ToastContainer` | Toast rendering, auto-dismiss, stack order, dismiss button |
| `SettingsPage` | Profile info display, PIN change form, about section |
| `Sidebar` | Navigation links, active route highlight, profile avatar, connection dot |
| `DeviceSelector` | Dropdown rendering, default selection, offline device label |

### 6.3 Zustand Store Tests

**File**: `stores/downloadsStore.test.ts`

```typescript
describe('downloadsStore', () => {
  it('adds an active download', () => { /* ... */ });
  it('updates active download progress', () => { /* ... */ });
  it('removes active download on completion', () => { /* ... */ });
  it('adds a queued download', () => { /* ... */ });
  it('removes queued download on cancel', () => { /* ... */ });
  it('transitions queued to active on delivery', () => { /* ... */ });
  it('adds history entry', () => { /* ... */ });
  it('sets full history from API response', () => { /* ... */ });
  it('removes history entry', () => { /* ... */ });
  it('getActiveCount returns correct count', () => { /* ... */ });
  it('getQueuedCount returns correct count', () => { /* ... */ });
});
```

**File**: `stores/devicesStore.test.ts`

```typescript
describe('devicesStore', () => {
  it('sets device list from API', () => { /* ... */ });
  it('updates device online status from WebSocket event', () => { /* ... */ });
  it('renames a device', () => { /* ... */ });
  it('sets default device', () => { /* ... */ });
  it('removes a device', () => { /* ... */ });
});
```

### 6.4 WebSocket Client Tests

**File**: `ws/wsClient.test.ts`

```typescript
import { MockWebSocket } from '../test/mocks/MockWebSocket';

describe('WebSocket Client', () => {
  it('connects with profile session token', () => { /* ... */ });
  it('dispatches download:progress to store', () => { /* ... */ });
  it('dispatches download:completed to store + toast', () => { /* ... */ });
  it('dispatches download:failed to store + toast', () => { /* ... */ });
  it('dispatches device:status to devices store', () => { /* ... */ });
  it('queues outbound messages during reconnection', () => { /* ... */ });
  it('drains message queue after reconnection', () => { /* ... */ });
  it('reconnects with exponential backoff', () => { /* ... */ });
  it('updates connection status in store', () => { /* ... */ });
  it('disconnects on profile switch', () => { /* ... */ });
});
```

### 6.5 API Client Tests

**File**: `api/apiClient.test.ts`

Test the API client wrapper (fetch-based) with mocked responses:
- Successful requests return parsed JSON
- 401 triggers token refresh, then retries original request
- 4xx errors throw with `detail` from response body
- 5xx errors throw with fallback message
- Network failure throws with user-friendly message

---

## Web E2E Tests (Playwright)

**Directory**: `packages/web/e2e/`

### 7.1 Test Setup

> **✅ RESOLVED**: Always use the real relay backend for E2E tests — full relay against a test Postgres database, both in CI and local development. Maximum confidence. The CI pipeline spins up Docker Compose with a test database before running Playwright. Local dev also uses Docker Compose (the test database runs on tmpfs for speed).

### 7.2 E2E Test Flows

**File**: `e2e/setup-wizard.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Setup Wizard', () => {
  test('completes full setup on fresh instance', async ({ page }) => {
    await page.goto('/');
    // Should redirect to /setup
    await expect(page).toHaveURL('/setup');

    // Step 1: Create admin
    await page.fill('[data-testid="username"]', 'admin');
    await page.fill('[data-testid="password"]', 'testpass123');
    await page.fill('[data-testid="confirm-password"]', 'testpass123');
    await page.click('[data-testid="next-step"]');

    // Step 2: TMDB key
    await page.fill('[data-testid="tmdb-key"]', 'test-tmdb-key');
    await page.click('[data-testid="test-tmdb"]');
    await expect(page.locator('[data-testid="tmdb-status"]')).toHaveText('Valid');
    await page.click('[data-testid="next-step"]');

    // Step 3: RD key
    await page.fill('[data-testid="rd-key"]', 'test-rd-key');
    await page.click('[data-testid="test-rd"]');
    await expect(page.locator('[data-testid="rd-status"]')).toHaveText('Valid');
    await page.click('[data-testid="next-step"]');

    // Step 4: Create profile
    await page.fill('[data-testid="profile-name"]', 'Noah');
    await page.click('[data-testid="avatar-blue"]');
    await page.click('[data-testid="complete-setup"]');

    // Should redirect to profile picker
    await expect(page).toHaveURL('/profiles');
    await expect(page.locator('text=Noah')).toBeVisible();
  });

  test('setup wizard is locked after completion', async ({ page }) => {
    // ... setup already done ...
    await page.goto('/setup');
    // Should redirect away
    await expect(page).not.toHaveURL('/setup');
  });
});
```

**Full E2E test list:**

| File | Flow | Validates |
|------|------|-----------|
| `setup-wizard.spec.ts` | Fresh instance → wizard → profile picker | First-run, admin creation, API key validation |
| `admin-auth.spec.ts` | Login → admin panel → logout → refresh | Auth flow, token lifecycle |
| `profile-picker.spec.ts` | Pick profile, PIN flow, switch profiles | Profile selection, PIN validation |
| `admin-panel.spec.ts` | Create/edit/delete profiles, update settings | Profile CRUD, settings management |
| `devices.spec.ts` | Pair device flow, rename, set default, revoke | Device management (mock agent WebSocket) |
| `search.spec.ts` | Search → results → stream picker → filters | TMDB proxy, Torrentio proxy, filter logic |
| `tv-flow.spec.ts` | Search TV → season → episode → streams | TV-specific flow |
| `recently-viewed.spec.ts` | View title → appears in strip → click to revisit | Recently viewed persistence |
| `downloads.spec.ts` | Trigger download → progress → completion | Download lifecycle (mock agent) |
| `download-queue.spec.ts` | Download to offline device → queue → deliver on connect | Offline queue flow |
| `download-history.spec.ts` | History list, filters, retry failed, delete | History page |
| `settings.spec.ts` | View profile, change PIN, about section | Settings page |
| `multi-profile.spec.ts` | Switch profiles → isolation verified | Profile isolation |

---

## Agent Unit Tests

**Directory**: `packages/agent/src/__tests__/`

### 8.1 Real-Debrid Client Tests

**File**: `rd/rdClient.test.ts`

Uses `msw` to mock the RD API:

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { rdServer, rdHandlers } from '../test/mocks/rd-api';
import { RealDebridClient } from '../rd/rdClient';

describe('RealDebridClient', () => {
  let client: RealDebridClient;

  beforeAll(() => rdServer.listen());
  afterEach(() => rdServer.resetHandlers());
  afterAll(() => rdServer.close());

  beforeEach(() => {
    client = new RealDebridClient('test-api-key');
  });

  describe('addMagnet', () => {
    it('returns torrent ID on success', async () => {
      const id = await client.addMagnet('magnet:?xt=urn:btih:abc123');
      expect(id).toBe('rd-torrent-123');
    });

    it('throws on HTTP 403 (bad API key)', async () => {
      rdServer.use(
        http.post('*/torrents/addMagnet', () => HttpResponse.json({ error: 'bad_token' }, { status: 403 }))
      );
      await expect(client.addMagnet('magnet:...')).rejects.toThrow(/403/);
    });

    it('throws on network error', async () => {
      rdServer.use(
        http.post('*/torrents/addMagnet', () => HttpResponse.error())
      );
      await expect(client.addMagnet('magnet:...')).rejects.toThrow();
    });
  });

  describe('selectFiles', () => {
    it('selects all files (204 response)', async () => {
      await expect(client.selectFiles('rd-torrent-123')).resolves.toBeUndefined();
    });
  });

  describe('pollUntilReady', () => {
    it('returns links when status is "downloaded"', async () => {
      const links = await client.pollUntilReady('rd-torrent-123');
      expect(links).toEqual(['https://real-debrid.com/d/abc123']);
    });

    it('throws on error status (dead, virus, magnet_error)', async () => {
      rdServer.use(
        http.get('*/torrents/info/:id', () =>
          HttpResponse.json({ id: 'rd-torrent-123', status: 'dead', links: [] })
        )
      );
      await expect(client.pollUntilReady('rd-torrent-123')).rejects.toThrow(/dead/);
    });

    it('times out after configured duration', async () => {
      rdServer.use(
        http.get('*/torrents/info/:id', () =>
          HttpResponse.json({ id: 'rd-torrent-123', status: 'downloading', links: [] })
        )
      );
      // With a very short timeout for testing
      await expect(
        client.pollUntilReady('rd-torrent-123', { timeoutMs: 100, pollIntervalMs: 50 })
      ).rejects.toThrow(/timeout/i);
    });
  });

  describe('unrestrictLink', () => {
    it('returns download URL and file size', async () => {
      const result = await client.unrestrictLink('https://real-debrid.com/d/abc123');
      expect(result.url).toContain('download.real-debrid.com');
      expect(result.size).toBe(45_000_000_000);
    });
  });

  describe('checkCache', () => {
    it('returns boolean map for each info hash', async () => {
      const result = await client.checkCache(['abc123']);
      expect(result).toEqual({ abc123: true });
    });

    it('returns false for uncached hashes', async () => {
      rdServer.use(
        http.get('*/torrents/instantAvailability/:hashes', () =>
          HttpResponse.json({ abc123: {} })
        )
      );
      const result = await client.checkCache(['abc123']);
      expect(result).toEqual({ abc123: false });
    });
  });

  describe('downloadMagnet (full pipeline)', () => {
    it('runs add → select → poll → unrestrict', async () => {
      const result = await client.downloadMagnet('magnet:?xt=urn:btih:abc123');
      expect(result).toHaveLength(1);
      expect(result[0].url).toContain('download.real-debrid.com');
    });
  });
});
```

### 8.2 Download Handler Tests

**File**: `handler/downloadHandler.test.ts`

Test cases:
- Processes download:request → sends accepted → runs pipeline → sends completed
- Respects maxConcurrentDownloads semaphore
- Rejects with "queue_full" when semaphore exhausted
- Sends download:failed on RD error (with correct phase and retryable flag)
- Handles download:cancel → aborts at any phase, cleans up staging
- Processes queued downloads identically to live requests
- Progress events emitted during each phase
- Job ID is ULID

### 8.3 Media Organizer Tests

**File**: `organizer/mediaOrganizer.test.ts`

Uses a temporary directory (via `os.tmpdir()`) for file system operations:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { MediaOrganizer } from '../organizer/mediaOrganizer';

describe('MediaOrganizer', () => {
  let tmpDir: string;
  let organizer: MediaOrganizer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tadaima-test-'));
    organizer = new MediaOrganizer({
      moviesDir: path.join(tmpDir, 'Movies'),
      tvDir: path.join(tmpDir, 'TV'),
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('organizeMovie', () => {
    it('moves file to Plex-compatible movie path', async () => {
      const stagingFile = path.join(tmpDir, 'staging', 'movie.mkv');
      await fs.mkdir(path.dirname(stagingFile), { recursive: true });
      await fs.writeFile(stagingFile, 'fake-movie-data');

      const result = await organizer.organizeMovie(stagingFile, {
        title: 'Interstellar',
        year: 2014,
        tmdbId: 157336,
      });

      expect(result).toBe(
        path.join(tmpDir, 'Movies', 'Interstellar (2014) [tmdb-157336]', 'Interstellar (2014).mkv')
      );
      await expect(fs.access(result)).resolves.toBeUndefined();
    });

    it('creates parent directories if they do not exist', async () => { /* ... */ });
    it('overwrites duplicate files at destination', async () => { /* ... */ });
    it('sanitizes title with special characters', async () => { /* ... */ });
  });

  describe('organizeEpisode', () => {
    it('moves file to Plex-compatible TV path', async () => { /* ... */ });
    it('handles missing episode title', async () => { /* ... */ });
    it('zero-pads season and episode numbers', async () => { /* ... */ });
  });
});
```

### 8.4 WebSocket Client Tests (Agent)

**File**: `ws/agentWsClient.test.ts`

Test cases:
- Connects with device token
- Sends agent:hello on connection
- Sends agent:heartbeat every 30 seconds
- Reconnects with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s max)
- Resets backoff on successful connection
- Queues outbound messages during reconnection
- Drains queue after reconnection
- Dispatches download:request to handler
- Dispatches download:cancel to handler

### 8.5 Config Manager Tests

**File**: `config/configManager.test.ts`

Test cases:
- Reads config from file
- Writes config to file
- Gets value with dot notation (`directories.movies`)
- Sets value with dot notation
- Lists all config (redacts sensitive values)
- Handles missing config file gracefully
- Validates config structure on read

---

## Agent Integration Tests

**Directory**: `packages/agent/src/__tests__/integration/`

### 9.1 Full Pipeline Test (Mocked RD)

**File**: `pipeline.integration.test.ts`

End-to-end test that mocks the RD API but uses real filesystem operations:

```typescript
describe('Download Pipeline (integration)', () => {
  it('full movie pipeline: request → RD → download → organize', async () => {
    // 1. Set up: mock RD API, create temp directories, mock WebSocket
    // 2. Send download:request message
    // 3. Assert: download:accepted sent
    // 4. Assert: download:progress events sent for each phase
    // 5. Assert: download:completed sent with correct path
    // 6. Assert: file exists at Plex-compatible location
    // 7. Assert: staging files cleaned up
  });

  it('full TV episode pipeline', async () => { /* similar */ });

  it('cancellation mid-download aborts and cleans up', async () => {
    // 1. Start a download with a slow mock (delays in RD poll)
    // 2. Send download:cancel after a short delay
    // 3. Assert: download:failed sent with phase + retryable
    // 4. Assert: staging files cleaned up
    // 5. Assert: semaphore slot freed
  });

  it('concurrent downloads limited by semaphore', async () => {
    // 1. Set maxConcurrentDownloads to 1
    // 2. Send two download:request messages
    // 3. First is accepted, second is rejected with "queue_full"
  });
});
```

---

## RD Key Rotation Handling

### 10.1 Design

When the admin rotates the RD API key in the web app, active agents need to pick up the new key. The approach is **error-based retry** — no push mechanism, no polling.

### 10.2 Implementation

**File**: `packages/agent/src/rd/rdClient.ts` (addition to existing client)

```typescript
export class RealDebridClient {
  private apiKey: string;
  private onKeyExpired: () => Promise<string | null>;

  constructor(apiKey: string, onKeyExpired: () => Promise<string | null>) {
    this.apiKey = apiKey;
    this.onKeyExpired = onKeyExpired;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${RD_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 || res.status === 403) {
      // Attempt key rotation
      const newKey = await this.onKeyExpired();
      if (newKey && newKey !== this.apiKey) {
        this.apiKey = newKey;
        // Retry with new key
        const retryRes = await fetch(`${RD_BASE}${path}`, {
          method,
          headers: { Authorization: `Bearer ${this.apiKey}` },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!retryRes.ok) throw new RdApiError(retryRes.status, await retryRes.text());
        return retryRes;
      }
      throw new RdApiError(res.status, 'RD API key invalid — rotation failed');
    }

    if (!res.ok) throw new RdApiError(res.status, await res.text());
    return res;
  }
}
```

The `onKeyExpired` callback calls `GET /api/agent/config` on the relay:

```typescript
// packages/agent/src/config/keyRotation.ts
export async function fetchCurrentRdKey(relayUrl: string, deviceToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${relayUrl}/api/agent/config`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    if (!res.ok) return null;
    const config = await res.json();
    return config.rdApiKey ?? null;
  } catch {
    return null;
  }
}
```

### 10.3 Tests

**File**: `rd/keyRotation.test.ts`

```typescript
describe('RD Key Rotation', () => {
  it('retries with new key after 401', async () => {
    let callCount = 0;
    rdServer.use(
      http.post('*/torrents/addMagnet', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({ error: 'bad_token' }, { status: 401 });
        }
        return HttpResponse.json({ id: 'rd-torrent-123' });
      })
    );

    const client = new RealDebridClient('old-key', async () => 'new-key');
    const id = await client.addMagnet('magnet:...');
    expect(id).toBe('rd-torrent-123');
    expect(callCount).toBe(2);
  });

  it('throws when rotation also fails', async () => {
    rdServer.use(
      http.post('*/torrents/addMagnet', () =>
        HttpResponse.json({ error: 'bad_token' }, { status: 401 })
      )
    );

    const client = new RealDebridClient('bad-key', async () => 'also-bad-key');
    await expect(client.addMagnet('magnet:...')).rejects.toThrow(/rotation failed/);
  });

  it('throws when relay is unreachable for key fetch', async () => {
    rdServer.use(
      http.post('*/torrents/addMagnet', () =>
        HttpResponse.json({ error: 'bad_token' }, { status: 401 })
      )
    );

    const client = new RealDebridClient('bad-key', async () => null);
    await expect(client.addMagnet('magnet:...')).rejects.toThrow(/rotation failed/);
  });

  it('updates local config file after successful rotation', async () => { /* ... */ });
});
```

---

## Error Handling Audit

### 11.1 Relay Error Handling

**All endpoints** must return the standard error envelope:

```json
{ "error": "error_type", "detail": "Human-readable explanation" }
```

**Checklist** (verify each exists and has tests):

| Error Case | Status | Error Type | Where |
|-----------|--------|-----------|-------|
| Malformed JSON body | 400 | `bad_request` | Global middleware |
| Missing required field | 422 | `validation_error` | Zod validation middleware |
| Invalid JWT / no auth header | 401 | `unauthorized` | Auth middleware |
| Valid JWT but wrong type (e.g., profile token on admin endpoint) | 403 | `forbidden` | Auth middleware |
| Expired JWT | 401 | `token_expired` | Auth middleware |
| Resource not found | 404 | `not_found` | Route handlers |
| Duplicate resource (e.g., profile name) | 409 | `conflict` | Service layer |
| TMDB API failure | 502 | `upstream_error` | Proxy routes |
| Torrentio API failure | 502 | `upstream_error` | Proxy routes |
| RD API test failure | 422 | `validation_error` | Settings routes |
| Database connection error | 500 | `internal_error` | Global error handler |
| Unhandled exception | 500 | `internal_error` | Global error handler |

**Global error handler** (Hono `onError`):

```typescript
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    { error: 'internal_error', detail: 'An unexpected error occurred' },
    500
  );
});
```

### 11.2 Agent Error Handling

| Error Case | Behavior |
|-----------|----------|
| WebSocket connection refused | Log error, retry with backoff |
| WebSocket token rejected (4001) | Log error, prompt user to re-run `tadaima setup` |
| RD API 401/403 | Attempt key rotation (see §10) |
| RD API 429 (rate limited) | Wait, retry after `Retry-After` header (or 60s default) |
| RD API 5xx | Retry up to 3 times with 5s delay; then fail download |
| RD torrent status "dead" / "virus" / "magnet_error" | Fail download with `retryable: false` |
| RD poll timeout (30 min) | Fail download with `retryable: true` |
| File download HTTP error | Fail download with `retryable: true` |
| File download network error | Fail download with `retryable: true` |
| Disk full during download | Fail download with error "Insufficient disk space", `retryable: false` |
| Target directory doesn't exist | Create it (mkdir -p behavior) |
| File move permission denied | Fail download with error, `retryable: false` |
| Config file missing | Prompt user to run `tadaima setup` |
| Config file corrupt | Log error, exit with clear message |

### 11.3 Web Error Handling

| Error Case | Behavior |
|-----------|----------|
| API 401 (expired access token) | Silently refresh, retry original request |
| API 401 (expired refresh token) | Redirect to login |
| API 4xx | Show toast with `detail` from response |
| API 5xx | Show toast: "Something went wrong. Please try again." |
| API network error | Show toast: "Can't reach the server. Check your connection." |
| WebSocket disconnect | Show yellow connection dot, auto-reconnect |
| WebSocket 4001 (auth rejected) | Redirect to profile picker |

---

## Edge Cases & Hardening

### 12.1 Download Queue Edge Cases

| Scenario | Expected Behavior | Test |
|----------|------------------|------|
| Download queued, device revoked before delivery | Queue entry remains; on any future device connection for this profile, check if deviceId still exists — if not, mark as "expired" | ✓ |
| Download queued, profile deleted | Cascade delete removes queue entries | ✓ |
| Same magnet queued twice | Both queue entries created (no dedup — user might want to download to different devices) | ✓ |
| Agent connects, receives 50 queued downloads | Delivered in FIFO order, agent processes per concurrency limit | ✓ |
| Queue entry older than 14 days | Marked "expired", NOT auto-delivered; shown with warning in UI | ✓ |
| Queue entry cancelled while agent is connecting | Race condition — use `status = 'queued'` WHERE clause in delivery query | ✓ |

### 12.2 WebSocket Edge Cases

| Scenario | Expected Behavior |
|----------|------------------|
| Agent sends malformed JSON | Relay logs warning, ignores message, does NOT disconnect |
| Client sends unknown message type | Relay logs warning, responds with `error` message |
| Agent disconnects mid-download | Download state preserved; web shows "Offline" for device; active downloads become stale after timeout |
| Multiple web clients for same profile | All receive broadcast events |
| Relay restarts while agents connected | Agents auto-reconnect; relay rebuilds connection pools from new connections |
| Agent sends heartbeat for revoked device | Reject — close with 4001 |

### 12.3 Auth Edge Cases

| Scenario | Expected Behavior |
|----------|------------------|
| Admin token used for profile endpoint | 403 — wrong token type |
| Profile token used for admin endpoint | 403 — wrong token type |
| Device token used for web endpoint | 403 — wrong token type |
| Refresh token reuse (replay attack) | Second use revokes entire chain (all refresh tokens for that admin/profile) |
| Clock skew on JWT validation | Allow 30-second leeway on `exp` check |

### 12.4 TMDB/Torrentio Proxy Edge Cases

| Scenario | Expected Behavior |
|----------|------------------|
| TMDB returns empty search results | Return empty array, no error |
| TMDB rate limit (429) | Return 502 to client; do NOT cache the error |
| Torrentio returns no streams | Return empty array |
| Torrentio timeout (>10s) | Return 502 with "Stream service timed out" |
| Cached response expired | Fetch fresh, update cache; if upstream fails, optionally serve stale (see below) |

> **✅ RESOLVED**: Serve stale cached data for TMDB responses (movie info rarely changes). Return 502 for Torrentio streams when upstream is down (stream availability changes frequently and stale data would lead users to try downloading unavailable content).

### 12.5 RD-Specific Edge Cases

| Scenario | Expected Behavior |
|----------|------------------|
| Magnet not cached on RD | RD downloads from seeders; `pollUntilReady` waits longer |
| All seeders dead | RD returns "dead" status; agent reports `download:failed` with `retryable: false` |
| RD account limit reached | RD returns 503; agent reports `download:failed` with `retryable: true` |
| Multiple agents hit RD concurrently | Each agent handles RD errors independently; no relay coordination |
| RD link expired (unrestrict URL) | Re-unrestrict and retry download |

---

## Coverage Targets & Reporting

### 13.1 Per-Package Targets

| Package | Line Coverage | Branch Coverage | Notes |
|---------|--------------|-----------------|-------|
| `shared` | 100% | 100% | All schemas + all utilities |
| `relay` | 90% | 85% | Service logic + endpoints |
| `agent` | 90% | 85% | RD client + handler + organizer |
| `web` | 80% | 75% | Components + stores (E2E covers UI flows) |

### 13.2 Vitest Coverage Configuration

```typescript
// vitest.config.ts (per package)
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        lines: 90,    // adjust per package
        branches: 85,
      },
      exclude: [
        'src/test/**',
        '**/*.d.ts',
        '**/index.ts', // barrel exports
      ],
    },
  },
});
```

### 13.3 CI Integration

Turborepo `test` pipeline runs all package tests in dependency order. Coverage reports are generated per-package and merged at the root for the CI summary.

```json
// turbo.json addition
{
  "pipeline": {
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "test:e2e": {
      "dependsOn": ["build"],
      "outputs": ["playwright-report/**"]
    }
  }
}
```

---

## Implementation Order

Build tests in this order, each building on the previous:

### Step 1: Infrastructure (Day 1)
1. Set up `vitest.workspace.ts` at root
2. Configure per-package `vitest.config.ts` files
3. Set up `docker-compose.test.yml` with test Postgres
4. Create `packages/relay/src/test/setup.ts` (test DB helpers)
5. Create shared fixture files in `packages/shared/src/test/fixtures/`
6. Install `msw` for HTTP mocking, create RD API mock handlers

### Step 2: Shared Tests (Day 1-2)
7. Write all Zod schema tests
8. Write all utility function tests
9. Verify 100% coverage on shared package

### Step 3: Agent Tests (Day 2-4)
10. RD client tests (all methods, error cases, timeout)
11. Download handler tests (full pipeline, cancel, concurrency)
12. Media organizer tests (movies, TV, sanitization edge cases)
13. WebSocket client tests (connect, reconnect, queue)
14. Config manager tests
15. RD key rotation tests
16. Agent integration test (full pipeline with mocked RD)

### Step 4: Relay Tests (Day 4-6)
17. Service unit tests (auth, profiles, pairing, queue, history, settings)
18. HTTP endpoint integration tests (full matrix)
19. WebSocket test harness (connection, routing, isolation, heartbeat)
20. Error handling verification (all error paths return correct envelope)

### Step 5: Web Tests (Day 6-8)
21. Zustand store tests (downloads, devices)
22. WebSocket client tests
23. API client tests
24. Component tests (all components from matrix)

### Step 6: E2E Tests (Day 8-10)
25. Set up Playwright config
26. Write E2E tests for all flows
27. Configure CI to run E2E with Docker Compose

### Step 7: Hardening Pass (Day 10-12)
28. Error handling audit — verify every error case from §11
29. Edge case review — verify every case from §12
30. Fix any issues discovered during audit
31. Final coverage report — verify all targets met

---

## Common Pitfalls

1. **Don't mock internal modules** — mock at the boundary (HTTP, WebSocket, filesystem, database). Mocking internal functions makes tests brittle and couples them to implementation.

2. **Don't use `setTimeout` in tests** — use `vi.useFakeTimers()` for time-dependent tests (heartbeat timeout, exponential backoff, queue expiry).

3. **Don't forget to clean the test database** — run `cleanTestDb()` in `beforeEach` for relay integration tests, not just `beforeAll`. Each test must start with a clean slate.

4. **Don't test Zod schema implementation** — test behavior (valid input passes, invalid input fails). Don't assert on internal Zod error messages, which may change between versions.

5. **Don't skip coverage on error paths** — error handlers are the most important code to test. Verify every `catch` block and every error response.

6. **Don't use snapshot tests for API responses** — they're brittle and hard to review. Assert on specific fields.

7. **Don't run Playwright tests against a dev server** — build the web app first, serve the built files, and run E2E against the production build. This catches build issues.

8. **Remember to test cascade deletes** — when a profile or device is deleted, verify that all related data (queue, history, devices, recently viewed) is cleaned up.

9. **RD mock handlers must return realistic responses** — match the actual RD API response structure. Consult the Real-Debrid API documentation at `https://api.real-debrid.com/` for response formats.

10. **WebSocket tests need proper cleanup** — close all WebSocket connections in `afterEach` to prevent test pollution and hanging processes.

---

## Verification Checklist

Before marking Phase 9 as complete:

- [ ] `pnpm test` passes across all packages (zero failures)
- [ ] `pnpm test -- --coverage` meets all per-package thresholds
- [ ] Shared: 100% line + branch coverage
- [ ] Relay: 90%+ line coverage on service logic
- [ ] Agent: 90%+ line coverage on download pipeline
- [ ] Web: 80%+ line coverage on components + stores
- [ ] E2E: all acceptance criteria from Phases 2-8 covered
- [ ] No unhandled promise rejections or uncaught exceptions in any package
- [ ] Error handling audit complete — every error case from §11 verified
- [ ] Edge cases from §12 verified
- [ ] RD key rotation end-to-end test passes
- [ ] Profile isolation verified (WebSocket + API)
- [ ] Download queue edge cases verified
- [ ] Stale queue entry handling verified
- [ ] CI pipeline runs full test suite successfully

---

End of Phase 9 Spec.
