# Phase 4: WebSocket Relay — Detailed Spec

> **Goal**: Implement bidirectional WebSocket connections for real-time command/event messaging between the web app, relay, and agents. After this phase, agents and web clients can connect, authenticate, and exchange typed messages through the relay.

---

## Overview

Phase 4 implements the live messaging layer that powers Tadaima's real-time features. The relay becomes a message broker with two WebSocket upgrade paths:

- `/ws` — Web clients (authenticated with profile session tokens)
- `/ws/agent` — Agents (authenticated with device tokens)

The relay maintains connection pools indexed by profile and device, routes messages between clients and agents within the same profile, handles heartbeats and online/offline status, and queues messages for offline agents to pick up on reconnection.

### Why This Phase Is Tricky

**Hono + ws on Node.js is non-standard**. Hono was designed for edge runtimes (Cloudflare Workers, etc.) where WebSocket upgrade is a first-class request property. On Node.js with the HTTP server, there's no built-in upgrade handler. This spec uses the raw Node.js `http` server with manual upgrade handling, separate from Hono's request/response cycle. This is well-established but requires careful integration.

---

## 1. Architecture: Connection Pools & Routing

### 1.1 Data Structures

```typescript
// packages/relay/src/websocket/types.ts

/**
 * Represents an authenticated WebSocket connection.
 * Identified by profileId (web clients) or profileId+deviceId (agents).
 */
export interface AuthenticatedConnection {
  ws: WebSocket;
  profileId: string;
  deviceId?: string;  // present only for agents
  connectedAt: number;  // timestamp
  lastHeartbeat?: number;  // unix ms, agents only
}

/**
 * Connection pool: organized by profileId and deviceId.
 *
 * Structure:
 * {
 *   "profile-uuid-1": {
 *     agents: Map<deviceId, AuthenticatedConnection>,
 *     clients: Set<AuthenticatedConnection>
 *   },
 *   "profile-uuid-2": {
 *     agents: Map<deviceId, AuthenticatedConnection>,
 *     clients: Set<AuthenticatedConnection>
 *   }
 * }
 */
export interface ConnectionPool {
  agents: Map<string, AuthenticatedConnection>;
  clients: Set<AuthenticatedConnection>;
}

export type ConnectionPools = Map<string, ConnectionPool>;
```

### 1.2 Global Connection Manager

```typescript
// packages/relay/src/websocket/pool.ts

import type { AuthenticatedConnection, ConnectionPools } from "./types";

/**
 * ConnectionPool manager: maintains all active WebSocket connections,
 * organized by profile and device.
 */
export class ConnectionPoolManager {
  private pools: ConnectionPools = new Map();

  /**
   * Register a web client connection (no deviceId).
   */
  registerClient(profileId: string, connection: AuthenticatedConnection): void {
    if (!this.pools.has(profileId)) {
      this.pools.set(profileId, {
        agents: new Map(),
        clients: new Set(),
      });
    }
    this.pools.get(profileId)!.clients.add(connection);
  }

  /**
   * Register an agent connection (with deviceId).
   */
  registerAgent(profileId: string, connection: AuthenticatedConnection): void {
    if (!this.pools.has(profileId)) {
      this.pools.set(profileId, {
        agents: new Map(),
        clients: new Set(),
      });
    }
    const deviceId = connection.deviceId!;
    this.pools.get(profileId)!.agents.set(deviceId, connection);
  }

  /**
   * Unregister a web client.
   */
  unregisterClient(profileId: string, connection: AuthenticatedConnection): void {
    const pool = this.pools.get(profileId);
    if (pool) {
      pool.clients.delete(connection);
      if (pool.agents.size === 0 && pool.clients.size === 0) {
        this.pools.delete(profileId);
      }
    }
  }

  /**
   * Unregister an agent and trigger offline broadcast.
   * Returns the device for offline notification.
   */
  unregisterAgent(profileId: string, deviceId: string): string | null {
    const pool = this.pools.get(profileId);
    if (!pool) return null;

    const connection = pool.agents.get(deviceId);
    if (connection) {
      pool.agents.delete(deviceId);
      if (pool.agents.size === 0 && pool.clients.size === 0) {
        this.pools.delete(profileId);
      }
      return deviceId;
    }
    return null;
  }

  /**
   * Get all web clients in a profile (for broadcasting agent status).
   */
  getClientsInProfile(profileId: string): Set<AuthenticatedConnection> {
    return this.pools.get(profileId)?.clients ?? new Set();
  }

  /**
   * Get a specific agent by profileId + deviceId.
   */
  getAgent(
    profileId: string,
    deviceId: string,
  ): AuthenticatedConnection | null {
    return this.pools.get(profileId)?.agents.get(deviceId) ?? null;
  }

  /**
   * Get all agents in a profile (for message routing to multiple devices).
   */
  getAgentsInProfile(profileId: string): AuthenticatedConnection[] {
    return Array.from(
      this.pools.get(profileId)?.agents.values() ?? new Map(),
    );
  }

  /**
   * Check if agent is online.
   */
  isAgentOnline(profileId: string, deviceId: string): boolean {
    return this.getAgent(profileId, deviceId) !== null;
  }

  /**
   * Get online agents in a profile for download routing.
   */
  getOnlineAgents(profileId: string): Map<string, AuthenticatedConnection> {
    return this.pools.get(profileId)?.agents ?? new Map();
  }
}

export const connectionPool = new ConnectionPoolManager();
```

---

## 2. WebSocket Upgrade Handler (Relay Server)

### 2.1 HTTP Server Integration

The relay needs a raw Node.js HTTP server to handle WebSocket upgrades. Hono sits on top for regular HTTP routes.

```typescript
// packages/relay/src/index.ts

import { createServer } from "http";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { handleWebSocketUpgrade } from "./websocket/upgrade.js";

const app = new Hono();

// Regular HTTP routes (auth, search, download queue, etc.)
app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

// ... other routes ...

const port = Number(process.env.PORT) || 3000;

// Create a raw HTTP server that wraps Hono
const server = createServer();

// Attach Hono to the server
const fetch = app.fetch.bind(app);
server.on("request", (req, res) => {
  fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method }))
    .then((response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(response.body);
    })
    .catch((err) => {
      console.error("Hono error:", err);
      res.writeHead(500);
      res.end("Internal Server Error");
    });
});

// Handle WebSocket upgrades
server.on("upgrade", (req, socket, head) => {
  handleWebSocketUpgrade(req, socket, head);
});

server.listen(port, () => {
  console.log(`Relay listening on http://localhost:${port}`);
});

export default app;
```

> **✅ RESOLVED**: Keep the manual HTTP server integration (raw WebSocket upgrade handler). This is standard practice for Hono-on-Node and gives full control over the upgrade process.

### 2.2 Token Validation

```typescript
// packages/relay/src/websocket/auth.ts

import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-change-in-production",
);

export interface TokenPayload {
  type: "profile" | "device";
  profileId: string;
  deviceId?: string;
}

/**
 * Extract and validate token from WebSocket upgrade request.
 * Query param: ?token=eyJ...
 */
export async function validateWebSocketToken(
  url: string,
  tokenType: "profile" | "device",
): Promise<TokenPayload | null> {
  try {
    const urlObj = new URL(url, "http://localhost");
    const token = urlObj.searchParams.get("token");

    if (!token) {
      console.warn("WebSocket connect: missing token");
      return null;
    }

    const verified = await jwtVerify(token, SECRET);
    const payload = verified.payload as unknown as TokenPayload;

    // Validate token type matches endpoint
    if (payload.type !== tokenType) {
      console.warn(
        `WebSocket connect: token type mismatch (got ${payload.type}, expected ${tokenType})`,
      );
      return null;
    }

    return payload;
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}
```

### 2.3 WebSocket Upgrade Handler

```typescript
// packages/relay/src/websocket/upgrade.ts

import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import type { Socket } from "net";
import { validateWebSocketToken } from "./auth.js";
import { connectionPool } from "./pool.js";
import {
  handleWebMessage,
  handleAgentMessage,
} from "./handlers/index.js";

const wsServers = {
  client: new WebSocketServer({ noServer: true }),
  agent: new WebSocketServer({ noServer: true }),
};

/**
 * Handle HTTP Upgrade requests for WebSocket.
 * Routes to /ws (web clients) or /ws/agent (agents).
 */
export function handleWebSocketUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): void {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;

  if (pathname === "/ws") {
    upgradeWebClient(req, socket, head);
  } else if (pathname === "/ws/agent") {
    upgradeAgent(req, socket, head);
  } else {
    socket.destroy();
  }
}

/**
 * Upgrade web client connection.
 * Expects: query param ?token=<profile-session-jwt>
 */
async function upgradeWebClient(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): Promise<void> {
  const tokenPayload = await validateWebSocketToken(req.url || "", "profile");

  if (!tokenPayload) {
    // RFC 6455: close code 4001 = policy violation
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: invalid\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "\r\n",
    );
    socket.destroy();
    return;
  }

  wsServers.client.handleUpgrade(req, socket, head, (ws) => {
    const connection = {
      ws,
      profileId: tokenPayload.profileId,
      connectedAt: Date.now(),
    };

    connectionPool.registerClient(tokenPayload.profileId, connection);
    console.log(`[WS] Web client connected: profile=${tokenPayload.profileId}`);

    ws.on("message", (data) => {
      handleWebMessage(connection, data).catch((err) => {
        console.error("Error handling web message:", err);
      });
    });

    ws.on("close", () => {
      connectionPool.unregisterClient(tokenPayload.profileId, connection);
      console.log(
        `[WS] Web client disconnected: profile=${tokenPayload.profileId}`,
      );
    });

    ws.on("error", (err) => {
      console.error("Web client error:", err);
    });
  });
}

/**
 * Upgrade agent connection.
 * Expects: query param ?token=<device-jwt>
 */
async function upgradeAgent(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): Promise<void> {
  const tokenPayload = await validateWebSocketToken(req.url || "", "device");

  if (!tokenPayload) {
    socket.destroy();
    return;
  }

  wsServers.agent.handleUpgrade(req, socket, head, (ws) => {
    const connection = {
      ws,
      profileId: tokenPayload.profileId,
      deviceId: tokenPayload.deviceId!,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    connectionPool.registerAgent(tokenPayload.profileId, connection);
    console.log(
      `[WS] Agent connected: profile=${tokenPayload.profileId} device=${tokenPayload.deviceId}`,
    );

    // Broadcast agent online status to web clients
    broadcastAgentStatus(tokenPayload.profileId, tokenPayload.deviceId!, true);

    // Deliver any queued downloads (Phase 6)
    // deliverQueuedDownloads(tokenPayload.profileId, tokenPayload.deviceId!);

    ws.on("message", (data) => {
      handleAgentMessage(connection, data).catch((err) => {
        console.error("Error handling agent message:", err);
      });
    });

    ws.on("close", () => {
      const deviceId = connectionPool.unregisterAgent(
        tokenPayload.profileId,
        tokenPayload.deviceId!,
      );
      if (deviceId) {
        broadcastAgentStatus(tokenPayload.profileId, deviceId, false);
      }
      console.log(
        `[WS] Agent disconnected: profile=${tokenPayload.profileId} device=${tokenPayload.deviceId}`,
      );
    });

    ws.on("error", (err) => {
      console.error("Agent error:", err);
    });
  });
}

/**
 * Broadcast agent online/offline status to all web clients in a profile.
 */
function broadcastAgentStatus(
  profileId: string,
  deviceId: string,
  isOnline: boolean,
): void {
  const clients = connectionPool.getClientsInProfile(profileId);
  const message = JSON.stringify({
    type: "agent:status",
    timestamp: Date.now(),
    payload: {
      deviceId,
      isOnline,
    },
  });

  clients.forEach((client) => {
    if (client.ws.readyState === 1) {
      // OPEN
      client.ws.send(message);
    }
  });
}
```

---

## 3. Message Routing Logic

### 3.1 Message Types (from shared package)

```typescript
// packages/shared/src/messages.ts

import { z } from "zod";

/**
 * All WebSocket message types, validated with Zod.
 */

// Base envelope
export const WsMessageSchema = z.object({
  id: z.string().ulid(),
  type: z.string(),
  timestamp: z.number().positive(),
  payload: z.unknown(),
});

export type WsMessage = z.infer<typeof WsMessageSchema>;

// Commands (web → relay → agent)
export const DownloadRequestSchema = WsMessageSchema.extend({
  type: z.literal("download:request"),
  payload: z.object({
    deviceId: z.string().uuid(),
    tmdbId: z.number().positive(),
    imdbId: z.string(),
    title: z.string(),
    year: z.number(),
    mediaType: z.enum(["movie", "tv"]),
    season: z.number().optional(),
    episode: z.number().optional(),
    episodeTitle: z.string().optional(),
    magnet: z.string().url(),
    torrentName: z.string(),
    expectedSize: z.number().positive(),
  }),
});

export const DownloadCancelSchema = WsMessageSchema.extend({
  type: z.literal("download:cancel"),
  payload: z.object({
    jobId: z.string().uuid(),
  }),
});

// Events (agent → relay → web)
export const DownloadAcceptedSchema = WsMessageSchema.extend({
  type: z.literal("download:accepted"),
  payload: z.object({
    jobId: z.string().uuid(),
    requestId: z.string(),
  }),
});

export const DownloadProgressSchema = WsMessageSchema.extend({
  type: z.literal("download:progress"),
  payload: z.object({
    jobId: z.string().uuid(),
    phase: z.enum([
      "adding",
      "waiting",
      "unrestricting",
      "downloading",
      "organizing",
    ]),
    progress: z.number().min(0).max(100),
    downloadedBytes: z.number().optional(),
    totalBytes: z.number().optional(),
    speedBps: z.number().optional(),
    eta: z.number().optional(),
  }),
});

export const DownloadCompletedSchema = WsMessageSchema.extend({
  type: z.literal("download:completed"),
  payload: z.object({
    jobId: z.string().uuid(),
    filePath: z.string(),
    finalSize: z.number().positive(),
  }),
});

export const DownloadFailedSchema = WsMessageSchema.extend({
  type: z.literal("download:failed"),
  payload: z.object({
    jobId: z.string().uuid(),
    error: z.string(),
    phase: z.string(),
    retryable: z.boolean(),
  }),
});

export const AgentHeartbeatSchema = WsMessageSchema.extend({
  type: z.literal("agent:heartbeat"),
  payload: z.object({
    activeJobs: z.number().nonnegative(),
    diskFreeBytes: z.number().positive(),
    uptimeSeconds: z.number().nonnegative(),
  }),
});

export const AgentStatusSchema = WsMessageSchema.extend({
  type: z.literal("agent:status"),
  payload: z.object({
    deviceId: z.string().uuid(),
    isOnline: z.boolean(),
  }),
});

// Union for all valid messages
export const AnyMessageSchema = z.union([
  DownloadRequestSchema,
  DownloadCancelSchema,
  DownloadAcceptedSchema,
  DownloadProgressSchema,
  DownloadCompletedSchema,
  DownloadFailedSchema,
  AgentHeartbeatSchema,
  AgentStatusSchema,
]);

export type AnyMessage = z.infer<typeof AnyMessageSchema>;
```

### 3.2 Message Handler: Web Client Messages

```typescript
// packages/relay/src/websocket/handlers/web.ts

import { AnyMessageSchema } from "@tadaima/shared";
import type { AuthenticatedConnection } from "../types.js";
import { connectionPool } from "../pool.js";

/**
 * Handle incoming messages from web clients.
 * Web clients can send: download:request, download:cancel, etc.
 * These are routed to agents within the same profile.
 */
export async function handleWebMessage(
  connection: AuthenticatedConnection,
  rawData: Buffer | string,
): Promise<void> {
  try {
    const data = JSON.parse(rawData.toString());
    const message = AnyMessageSchema.parse(data);

    switch (message.type) {
      case "download:request": {
        routeDownloadRequest(connection, message);
        break;
      }
      case "download:cancel": {
        routeDownloadCancel(connection, message);
        break;
      }
      default: {
        console.warn(`Unexpected message type from web client: ${message.type}`);
      }
    }
  } catch (error) {
    console.error("Failed to parse web message:", error);
  }
}

/**
 * Route download:request to target agent or queue if offline.
 */
function routeDownloadRequest(
  connection: AuthenticatedConnection,
  message: any,
): void {
  const { deviceId } = message.payload;
  const profileId = connection.profileId;

  // Check if agent is online
  const agent = connectionPool.getAgent(profileId, deviceId);

  if (agent && agent.ws.readyState === 1) {
    // OPEN: send directly to agent
    agent.ws.send(JSON.stringify(message));
    console.log(
      `[MSG] Routed download:request to agent: profile=${profileId} device=${deviceId}`,
    );
  } else {
    // OFFLINE: queue for later (Phase 6 integration)
    console.log(
      `[MSG] Agent offline, queueing download:request: profile=${profileId} device=${deviceId}`,
    );
    // TODO: insert into download_queue table
    // queueDownload(profileId, deviceId, message.payload);

    // Notify web client that download is queued
    const queuedNotification = {
      type: "download:queued",
      timestamp: Date.now(),
      payload: {
        queueId: message.id,
        requestId: message.id,
        title: message.payload.title,
        deviceName: "Unknown Device", // TODO: fetch from DB
      },
    };
    connection.ws.send(JSON.stringify(queuedNotification));
  }
}

/**
 * Route download:cancel to target agent (no queueing).
 */
function routeDownloadCancel(
  connection: AuthenticatedConnection,
  message: any,
): void {
  const profileId = connection.profileId;
  const agents = connectionPool.getAgentsInProfile(profileId);

  agents.forEach((agent) => {
    if (agent.ws.readyState === 1) {
      agent.ws.send(JSON.stringify(message));
    }
  });

  console.log(
    `[MSG] Broadcast download:cancel to ${agents.length} agents: profile=${profileId}`,
  );
}
```

### 3.3 Message Handler: Agent Messages

```typescript
// packages/relay/src/websocket/handlers/agent.ts

import { AnyMessageSchema } from "@tadaima/shared";
import type { AuthenticatedConnection } from "../types.js";
import { connectionPool } from "../pool.js";

/**
 * Handle incoming messages from agents.
 * Agents send: download:accepted, download:progress, download:completed, download:failed, agent:heartbeat
 * These are routed to web clients in the same profile.
 */
export async function handleAgentMessage(
  connection: AuthenticatedConnection,
  rawData: Buffer | string,
): Promise<void> {
  try {
    const data = JSON.parse(rawData.toString());
    const message = AnyMessageSchema.parse(data);

    switch (message.type) {
      case "download:accepted": {
        broadcastToClients(connection, message);
        break;
      }
      case "download:progress": {
        broadcastToClients(connection, message);
        // TODO: update download history (for real-time progress)
        break;
      }
      case "download:completed": {
        broadcastToClients(connection, message);
        // TODO: mark download_history as completed
        break;
      }
      case "download:failed": {
        broadcastToClients(connection, message);
        // TODO: update download_history with error
        break;
      }
      case "agent:heartbeat": {
        handleHeartbeat(connection, message);
        break;
      }
      default: {
        console.warn(`Unexpected message type from agent: ${message.type}`);
      }
    }
  } catch (error) {
    console.error("Failed to parse agent message:", error);
  }
}

/**
 * Broadcast agent event to all web clients in the profile.
 */
function broadcastToClients(
  connection: AuthenticatedConnection,
  message: any,
): void {
  const profileId = connection.profileId;
  const clients = connectionPool.getClientsInProfile(profileId);

  const payload = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.ws.readyState === 1) {
      client.ws.send(payload);
    }
  });

  console.log(
    `[MSG] Broadcast ${message.type} to ${clients.size} web clients: profile=${profileId}`,
  );
}

/**
 * Handle agent heartbeat: update last_seen_at, reset timeout, reply with keep-alive.
 * Agents send heartbeat every 30 seconds.
 * Relay waits 90 seconds before considering agent dead.
 */
function handleHeartbeat(
  connection: AuthenticatedConnection,
  message: any,
): void {
  connection.lastHeartbeat = Date.now();

  // TODO: update devices.last_seen_at in database
  // TODO: set agent online status to true (in case it was marked offline)

  // Send keep-alive response (optional, for symmetry)
  const response = {
    type: "relay:keepalive",
    timestamp: Date.now(),
    payload: {},
  };
  connection.ws.send(JSON.stringify(response));

  console.log(
    `[HEARTBEAT] Agent: profile=${connection.profileId} device=${connection.deviceId} jobs=${message.payload.activeJobs}`,
  );
}

// Export for Phase 4
export { broadcastToClients as broadcastToClients };
```

### 3.4 Handler Index

```typescript
// packages/relay/src/websocket/handlers/index.ts

export { handleWebMessage } from "./web.js";
export { handleAgentMessage } from "./agent.js";
```

---

## 4. Heartbeat Management

### 4.1 Heartbeat Interval Handler

```typescript
// packages/relay/src/websocket/heartbeat.ts

import { connectionPool } from "./pool.js";
import { broadcastToClients } from "./handlers/agent.js";

const AGENT_HEARTBEAT_INTERVAL = 30 * 1000; // 30s
const AGENT_TIMEOUT = 90 * 1000; // 90s

/**
 * Start periodic heartbeat check.
 * Called once on relay startup.
 */
export function startHeartbeatMonitor(): void {
  setInterval(checkAgentTimeouts, AGENT_HEARTBEAT_INTERVAL);
}

/**
 * Check if any agents have timed out (no heartbeat for 90s).
 * If so, mark them offline and broadcast to web clients.
 */
function checkAgentTimeouts(): void {
  const now = Date.now();

  // Iterate all profiles
  const profileIds = Array.from(new Map()); // TODO: get from connectionPool (add getter)

  profileIds.forEach((profileId) => {
    const agents = connectionPool.getAgentsInProfile(profileId);

    agents.forEach((agent) => {
      const lastHb = agent.lastHeartbeat || agent.connectedAt;
      const timeSinceLastHb = now - lastHb;

      if (timeSinceLastHb > AGENT_TIMEOUT) {
        console.warn(
          `[HEARTBEAT] Agent timeout: profile=${profileId} device=${agent.deviceId}`,
        );

        // Force disconnect
        agent.ws.close(1000, "Heartbeat timeout");
      }
    });
  });
}
```

> **✅ RESOLVED**: The relay actively closes the socket after 90s without a heartbeat. This gives cleaner state management. The agent detects the close and reconnects automatically with exponential backoff.

---

## 5. Agent WebSocket Client

The agent runs on the user's machine and maintains a persistent WebSocket connection to the relay.

### 5.1 Agent Connection Manager

```typescript
// packages/agent/src/websocket/client.ts

import WebSocket from "ws";
import { AnyMessageSchema } from "@tadaima/shared";

const DEFAULT_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]; // 1s → 30s max

export interface AgentClientOptions {
  relayUrl: string;
  deviceToken: string;
  deviceId: string;
  onMessage: (message: any) => Promise<void>;
  onOnline: () => Promise<void>;
  onOffline: () => void;
}

/**
 * WebSocket client for agents.
 * - Maintains persistent connection to relay
 * - Auto-reconnects with exponential backoff
 * - Queues messages during disconnection
 * - Validates all messages with Zod
 */
export class AgentWebSocketClient {
  private ws: WebSocket | null = null;
  private options: AgentClientOptions;
  private reconnectAttempt = 0;
  private messageQueue: string[] = [];
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(options: AgentClientOptions) {
    this.options = options;
  }

  /**
   * Connect to relay and start heartbeat.
   */
  async connect(): Promise<void> {
    const url = new URL(this.options.relayUrl);
    url.pathname = "/ws/agent";
    url.searchParams.set("token", this.options.deviceToken);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url.toString());

      this.ws.on("open", async () => {
        console.log("[WS] Connected to relay");
        this.reconnectAttempt = 0;

        // Flush queued messages
        await this.flushQueue();

        // Start heartbeat (every 30s)
        this.startHeartbeat();

        // Notify agent of online status
        await this.options.onOnline();

        resolve();
      });

      this.ws.on("message", async (data) => {
        try {
          const message = AnyMessageSchema.parse(JSON.parse(data.toString()));
          await this.options.onMessage(message);
        } catch (error) {
          console.error("Invalid message from relay:", error);
        }
      });

      this.ws.on("close", () => {
        console.log("[WS] Disconnected from relay");
        this.stopHeartbeat();
        this.options.onOffline();
        this.scheduleReconnect();
      });

      this.ws.on("error", (error) => {
        console.error("[WS] WebSocket error:", error);
        reject(error);
      });
    });
  }

  /**
   * Send message to relay. Queue if disconnected.
   */
  send(message: any): void {
    const payload = JSON.stringify(message);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      console.warn("[WS] Relay disconnected, queueing message");
      this.messageQueue.push(payload);
    }
  }

  /**
   * Flush all queued messages.
   */
  private async flushQueue(): Promise<void> {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(message);
      }
    }
  }

  /**
   * Start sending heartbeats every 30 seconds.
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const heartbeat = {
        type: "agent:heartbeat",
        timestamp: Date.now(),
        payload: {
          activeJobs: 0, // TODO: get actual job count
          diskFreeBytes: 1000000000, // TODO: get actual free space
          uptimeSeconds: Math.floor(process.uptime()),
        },
      };
      this.send(heartbeat);
    }, 30 * 1000);
  }

  /**
   * Stop heartbeat.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff.
   */
  private scheduleReconnect(): void {
    const delay =
      DEFAULT_RECONNECT_DELAYS[
        Math.min(this.reconnectAttempt, DEFAULT_RECONNECT_DELAYS.length - 1)
      ];
    this.reconnectAttempt++;

    console.log(
      `[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`,
    );

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error("[WS] Reconnect failed:", err);
        this.scheduleReconnect();
      });
    }, delay);
  }

  /**
   * Gracefully disconnect.
   */
  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, "Agent shutdown");
      this.ws = null;
    }
  }
}
```

### 5.2 Agent Integration

```typescript
// packages/agent/src/index.ts (updated)

import { AgentWebSocketClient } from "./websocket/client.js";
import { loadConfig } from "./config/loader.js";

const config = loadConfig();

const wsClient = new AgentWebSocketClient({
  relayUrl: config.relay,
  deviceToken: config.deviceToken,
  deviceId: config.deviceId,
  onMessage: async (message) => {
    console.log(`[MSG] Received from relay:`, message.type);
    // TODO: route to appropriate handler
    // handleDownloadRequest(message), etc.
  },
  onOnline: async () => {
    console.log("[AGENT] Online");
    // TODO: update local status, deliver queued downloads
  },
  onOffline: () => {
    console.log("[AGENT] Offline");
    // TODO: update local status
  },
});

await wsClient.connect();
```

---

## 6. Web WebSocket Client

The web app maintains a WebSocket connection to receive real-time updates.

### 6.1 Zustand Store with WebSocket Integration

```typescript
// packages/web/src/store/websocket.ts

import { create } from "zustand";

export interface DownloadProgressEvent {
  jobId: string;
  phase: string;
  progress: number;
  speedBps?: number;
  eta?: number;
}

export interface AgentStatusEvent {
  deviceId: string;
  isOnline: boolean;
}

export interface WebSocketStore {
  // Connection state
  connected: boolean;
  connecting: boolean;
  error: string | null;

  // Events
  downloads: Map<string, DownloadProgressEvent>;
  agentStatuses: Map<string, AgentStatusEvent>;

  // Methods
  connect: (token: string) => Promise<void>;
  disconnect: () => void;
  updateDownload: (jobId: string, event: DownloadProgressEvent) => void;
  updateAgentStatus: (deviceId: string, isOnline: boolean) => void;
}

export const useWebSocketStore = create<WebSocketStore>((set, get) => {
  let ws: WebSocket | null = null;

  return {
    connected: false,
    connecting: false,
    error: null,
    downloads: new Map(),
    agentStatuses: new Map(),

    connect: async (token: string) => {
      set({ connecting: true });

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

      return new Promise((resolve, reject) => {
        ws = new WebSocket(url);

        ws.onopen = () => {
          console.log("[WS] Connected to relay");
          set({ connected: true, connecting: false, error: null });
          resolve();
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            switch (message.type) {
              case "download:progress": {
                const { jobId, phase, progress, speedBps, eta } =
                  message.payload;
                get().updateDownload(jobId, {
                  jobId,
                  phase,
                  progress,
                  speedBps,
                  eta,
                });
                break;
              }
              case "download:completed": {
                const { jobId } = message.payload;
                // Update state: mark as completed
                get().updateDownload(jobId, {
                  jobId,
                  phase: "completed",
                  progress: 100,
                });
                break;
              }
              case "download:failed": {
                const { jobId, error } = message.payload;
                get().updateDownload(jobId, {
                  jobId,
                  phase: "failed",
                  progress: 0,
                });
                break;
              }
              case "agent:status": {
                const { deviceId, isOnline } = message.payload;
                get().updateAgentStatus(deviceId, isOnline);
                break;
              }
              default:
                console.warn(`Unknown message type: ${message.type}`);
            }
          } catch (error) {
            console.error("Failed to parse message:", error);
          }
        };

        ws.onerror = (event) => {
          const error = "WebSocket error";
          console.error(error);
          set({ error });
          reject(new Error(error));
        };

        ws.onclose = () => {
          console.log("[WS] Disconnected from relay");
          set({ connected: false, connecting: false });
        };
      });
    },

    disconnect: () => {
      if (ws) {
        ws.close();
        ws = null;
      }
      set({ connected: false });
    },

    updateDownload: (jobId, event) => {
      set((state) => ({
        downloads: new Map(state.downloads).set(jobId, event),
      }));
    },

    updateAgentStatus: (deviceId, isOnline) => {
      set((state) => ({
        agentStatuses: new Map(state.agentStatuses).set(deviceId, {
          deviceId,
          isOnline,
        }),
      }));
    },
  };
});
```

### 6.2 Connection Lifecycle

```typescript
// packages/web/src/hooks/useWebSocket.ts

import { useEffect } from "react";
import { useWebSocketStore } from "../store/websocket.js";

/**
 * Hook to manage WebSocket connection lifecycle.
 * Connects when profile session exists, disconnects on logout.
 */
export function useWebSocket(profileToken?: string) {
  const { connect, disconnect, connected } = useWebSocketStore();

  useEffect(() => {
    if (profileToken && !connected) {
      connect(profileToken).catch((err) => {
        console.error("Failed to connect WebSocket:", err);
      });
    }

    return () => {
      if (!profileToken) {
        disconnect();
      }
    };
  }, [profileToken, connected, connect, disconnect]);
}

/**
 * Usage in a component:
 *
 * export function SearchPage() {
 *   const { profileToken } = useProfileSession();
 *   useWebSocket(profileToken);
 *
 *   return <SearchResults />;
 * }
 */
```

---

## 7. Dependencies

### Relay additions to `packages/relay/package.json`

```jsonc
{
  "dependencies": {
    "@tadaima/shared": "workspace:*",
    "hono": "~4.12.0",
    "@hono/node-server": "~1.19.0",
    "ws": "~8.18.0",
    "jose": "~5.4.0",
    "drizzle-orm": "~0.34.0",
    "postgres": "~3.5.0"
  },
  "devDependencies": {
    "@types/node": "~22.0.0",
    "@types/ws": "~8.5.0",
    "tsx": "~4.19.0",
    "typescript": "~5.8.0",
    "vitest": "~4.1.0"
  }
}
```

### Agent additions to `packages/agent/package.json`

```jsonc
{
  "dependencies": {
    "@tadaima/shared": "workspace:*",
    "ws": "~8.18.0"
  },
  "devDependencies": {
    "@types/node": "~22.0.0",
    "@types/ws": "~8.5.0",
    "tsx": "~4.19.0",
    "typescript": "~5.8.0",
    "vitest": "~4.1.0"
  }
}
```

### Web additions to `packages/web/package.json`

```jsonc
{
  "dependencies": {
    "react": "~19.1.0",
    "react-dom": "~19.1.0",
    "zustand": "~5.1.0"
  },
  "devDependencies": {
    "@types/react": "~19.1.0",
    "@types/react-dom": "~19.1.0",
    "@vitejs/plugin-react": "~4.5.0",
    "tailwindcss": "~4.2.0",
    "@tailwindcss/vite": "~4.2.0",
    "typescript": "~5.8.0",
    "vite": "~6.3.0",
    "vitest": "~4.1.0"
  }
}
```

---

## 8. File Structure

All new files created in Phase 4:

```
packages/relay/src/
├── websocket/
│   ├── types.ts                 # AuthenticatedConnection, ConnectionPool
│   ├── pool.ts                  # ConnectionPoolManager
│   ├── auth.ts                  # Token validation
│   ├── upgrade.ts               # HTTP upgrade handler
│   ├── heartbeat.ts             # Heartbeat monitoring
│   └── handlers/
│       ├── index.ts             # Exports
│       ├── web.ts               # Web client message routing
│       └── agent.ts             # Agent message routing
└── index.ts                     # Updated with HTTP server + WebSocket

packages/agent/src/
├── websocket/
│   └── client.ts                # AgentWebSocketClient
└── index.ts                     # Updated with WebSocket connection

packages/web/src/
├── store/
│   └── websocket.ts             # Zustand store
├── hooks/
│   └── useWebSocket.ts          # Connection lifecycle hook
└── (existing files)

packages/shared/src/
├── messages.ts                  # Zod schemas for all message types
└── index.ts                     # Re-export all schemas
```

---

## 9. Testing Strategy

### 9.1 Mock WebSocket Server

```typescript
// packages/relay/src/websocket/__tests__/upgrade.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import type { Server } from "http";
import { createServer } from "http";

describe("WebSocket Upgrade", () => {
  let server: Server;
  const PORT = 3001;

  beforeAll(() => {
    server = createServer();
    // ... attach handleWebSocketUpgrade ...
    server.listen(PORT);
  });

  afterAll(() => {
    server.close();
  });

  it("rejects connection without token", async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

    // Should close immediately
    await new Promise((resolve) => {
      ws.on("error", () => resolve(null));
      ws.on("close", () => resolve(null));
    });
  });

  it("accepts connection with valid token", async () => {
    const token = generateValidToken(); // TODO: JWT helper
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${token}`);

    await new Promise((resolve) => {
      ws.on("open", () => resolve(null));
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
```

### 9.2 Integration Test

```typescript
// packages/relay/src/websocket/__tests__/routing.test.ts

/**
 * Integration test: web client sends download:request, agent receives it.
 */
describe("Message Routing", () => {
  it("routes download:request from web to agent", async () => {
    // Connect agent
    const agentWs = await connectAgent(TOKEN_AGENT);

    // Connect web client
    const clientWs = await connectClient(TOKEN_CLIENT);

    // Send download:request from client
    const request = {
      id: ulid(),
      type: "download:request",
      timestamp: Date.now(),
      payload: {
        deviceId: AGENT_DEVICE_ID,
        tmdbId: 1,
        imdbId: "tt0000001",
        title: "Test",
        year: 2024,
        mediaType: "movie",
        magnet: "magnet:...",
        torrentName: "Test.2024.mkv",
        expectedSize: 1000000,
      },
    };

    clientWs.send(JSON.stringify(request));

    // Agent should receive it
    const received = await new Promise((resolve) => {
      agentWs.on("message", (data) => {
        const msg = JSON.parse(data);
        resolve(msg);
      });
    });

    expect(received.type).toBe("download:request");
    expect(received.payload.title).toBe("Test");
  });
});
```

### 9.3 Agent Client Test

```typescript
// packages/agent/src/websocket/__tests__/client.test.ts

describe("AgentWebSocketClient", () => {
  it("reconnects with exponential backoff", async () => {
    const client = new AgentWebSocketClient({
      relayUrl: "ws://unreachable.invalid",
      deviceToken: TOKEN,
      deviceId: DEVICE_ID,
      onMessage: async () => {},
      onOnline: async () => {},
      onOffline: () => {},
    });

    const start = Date.now();
    await client.connect().catch(() => {}); // Will fail immediately

    // Check that it schedules reconnect
    // (This is tricky to test; might need a mock clock or relaxed timing)
  });

  it("queues messages when disconnected", () => {
    const client = new AgentWebSocketClient({
      relayUrl: "ws://unreachable.invalid",
      deviceToken: TOKEN,
      deviceId: DEVICE_ID,
      onMessage: async () => {},
      onOnline: async () => {},
      onOffline: () => {},
    });

    // Send before connected
    client.send({ type: "test", payload: {} });

    // After connection, message should flush
    // TODO: mock WebSocket to verify
  });
});
```

---

## 10. Common Pitfalls & Mitigations

### 10.1 Hono + ws Integration Pitfalls

1. **Pitfall**: Using `app.upgrade()` — Hono's `upgrade` method is for edge runtimes, not Node.js.
   - **Mitigation**: Use the raw HTTP server's `upgrade` event directly.

2. **Pitfall**: Forgetting to pass `noServer: true` to WebSocketServer.
   - **Mitigation**: Always instantiate with `new WebSocketServer({ noServer: true })`.

3. **Pitfall**: Mixing Hono's fetch-based routing with Node.js HTTP event handlers.
   - **Mitigation**: Keep HTTP routes in Hono, WebSocket upgrade in the raw server's `upgrade` event. No overlap.

4. **Pitfall**: Closing socket without proper HTTP response.
   - **Mitigation**: Use `wsServer.handleUpgrade()` to manage socket lifecycle, or manually send HTTP 101 before closing.

### 10.2 Token & Auth Pitfalls

5. **Pitfall**: Storing tokens in localStorage and reusing across page reloads.
   - **Mitigation**: Web: store profile token in memory (zustand), not localStorage. Re-request on page load from auth endpoint.

6. **Pitfall**: Not validating token type (profile vs. device).
   - **Mitigation**: Include `type` field in JWT payload; check it matches endpoint type.

7. **Pitfall**: Token expiration mid-connection.
   - **Mitigation**: Use long-lived tokens for WebSocket (lifetime = session duration). Refresh via separate HTTP endpoint before expiration.

### 10.3 Connection Pool Pitfalls

8. **Pitfall**: Orphaned connections in pool if close event doesn't fire.
   - **Mitigation**: Add a cleanup task that periodically sweeps stale connections (check `readyState`).

9. **Pitfall**: Broadcasting to disconnected clients (readyState !== OPEN).
   - **Mitigation**: Always check `ws.readyState === 1` before sending. Example in upgrade.ts above.

10. **Pitfall**: Profile isolation broken by leaked connections.
    - **Mitigation**: All routing is keyed by profileId. Never route cross-profile.

### 10.4 Message Routing Pitfalls

11. **Pitfall**: Routing download:request to multiple agents if user has multiple devices.
    - **Mitigation**: download:request includes `deviceId` in payload. Route only to that agent. If offline, queue.

12. **Pitfall**: Broadcasting download:cancel to all agents (intended for one).
    - **Mitigation**: download:cancel includes `jobId` and optionally agent-side filtering. Or, include deviceId in cancel message.

13. **Pitfall**: Agent sends message before authentication completes.
    - **Mitigation**: Don't add to pool until upgrade completes. Reject any messages from unauthenticated sockets.

### 10.5 Heartbeat Pitfalls

14. **Pitfall**: Heartbeat timeout too short (agents in poor network conditions timeout).
    - **Mitigation**: 30s agent interval, 90s relay timeout (3x buffer). Configurable via env vars if needed.

15. **Pitfall**: Stale heartbeat timestamps if system clock changes.
    - **Mitigation**: Use `Date.now()` consistently. If clock skew detected, log warning but don't fail.

### 10.6 Reconnection Pitfalls

16. **Pitfall**: Exponential backoff maxes out, agent never reconnects.
    - **Mitigation**: Cap at 30s, but keep retrying forever (no max attempt count).

17. **Pitfall**: Queue grows unbounded if relay is down for days.
    - **Mitigation**: Agent queue is in-memory only. On restart, fresh queue. Relay download_queue table handles persistence.

18. **Pitfall**: Queued messages sent twice (once from queue, once as duplicate).
    - **Mitigation**: Clear queue after flush completes. Use message IDs for deduplication if needed (Phase 6).

---

## 11. Execution Order

Execute these steps in sequence:

1. **Update `packages/shared/src/messages.ts`**
   - Define all Zod message schemas (DownloadRequest, AgentHeartbeat, etc.)
   - Export as `AnyMessageSchema`

2. **Create `packages/relay/src/websocket/types.ts`**
   - Define `AuthenticatedConnection`, `ConnectionPool`

3. **Create `packages/relay/src/websocket/pool.ts`**
   - Implement `ConnectionPoolManager` class
   - Export singleton `connectionPool`

4. **Create `packages/relay/src/websocket/auth.ts`**
   - Implement `validateWebSocketToken()`
   - Use existing JWT logic from Phase 2 (jose library)

5. **Create `packages/relay/src/websocket/handlers/web.ts`**
   - Implement `handleWebMessage()` with routing logic
   - Implement `routeDownloadRequest()` and `routeDownloadCancel()`

6. **Create `packages/relay/src/websocket/handlers/agent.ts`**
   - Implement `handleAgentMessage()` with switch/case
   - Implement `broadcastToClients()` and `handleHeartbeat()`

7. **Create `packages/relay/src/websocket/handlers/index.ts`**
   - Export handlers

8. **Create `packages/relay/src/websocket/upgrade.ts`**
   - Implement HTTP upgrade handler
   - Implement `/ws` and `/ws/agent` upgrade functions
   - Implement `broadcastAgentStatus()`

9. **Create `packages/relay/src/websocket/heartbeat.ts`**
   - Implement heartbeat monitor and timeout checker

10. **Update `packages/relay/src/index.ts`**
    - Create raw HTTP server
    - Attach Hono to server
    - Attach upgrade handler
    - Call `startHeartbeatMonitor()`

11. **Create `packages/agent/src/websocket/client.ts`**
    - Implement `AgentWebSocketClient` class
    - Implement connect, disconnect, send, flushQueue, startHeartbeat

12. **Update `packages/agent/src/index.ts`**
    - Create and connect WebSocketClient on startup
    - Wire up message handlers (stubbed for now)

13. **Create `packages/web/src/store/websocket.ts`**
    - Implement zustand store
    - Implement connect, disconnect, message dispatch

14. **Create `packages/web/src/hooks/useWebSocket.ts`**
    - Implement `useWebSocket()` hook
    - Wire up lifecycle

15. **Update `packages/relay/package.json`**
    - Add `ws`, `@types/ws`

16. **Update `packages/agent/package.json`**
    - Add `ws`, `@types/ws`

17. **Update `packages/web/package.json`**
    - Add `zustand`

18. **Run `pnpm install`**

19. **Create test files** (optional, for Phase 4)
    - `packages/relay/src/websocket/__tests__/upgrade.test.ts`
    - `packages/relay/src/websocket/__tests__/routing.test.ts`
    - `packages/agent/src/websocket/__tests__/client.test.ts`

20. **Run verification**
    - `pnpm typecheck`
    - `pnpm lint`
    - `pnpm build`
    - (Integration test: manual connect via ws CLI tool, send message, verify routing)

---

## 12. Verification Checklist

| # | Check | How to verify |
|---|-------|---------------|
| 1 | Relay HTTP server starts with upgrade handler | `pnpm --filter @tadaima/relay dev` → logs "Relay listening on http://localhost:3000" |
| 2 | Web client can connect to `/ws` with valid token | Use `websocat` or browser DevTools: `ws://localhost:3000/ws?token=<valid-jwt>` → connects, no close |
| 3 | Web client rejected without token | `ws://localhost:3000/ws` → closes immediately with 1002 or 1006 |
| 4 | Agent can connect to `/ws/agent` with valid token | `websocat ws://localhost:3000/ws/agent?token=<device-jwt>` → connects |
| 5 | Agent connection pool tracks devices correctly | Set breakpoint in `registerAgent()`, verify profileId + deviceId stored |
| 6 | Web client sends download:request, agent receives | Send via web client WS, spy on agent handler, verify message relayed |
| 7 | Agent offline, web client queued notification sent | Disconnect agent, send download:request from web, verify "download:queued" message received |
| 8 | Agent heartbeat sent every 30s | Enable debug logging, monitor agent client, see heartbeat message every ~30s |
| 9 | Agent heartbeat timeout after 90s inactivity | Suppress heartbeat, wait 90s+, verify agent auto-closes connection |
| 10 | Web zustand store connects and receives messages | Import store in React component, verify `connected === true` after connect |
| 11 | Agent client reconnects with exponential backoff | Kill relay, monitor agent logs, see reconnect attempts: 1s, 2s, 4s, 8s, 16s, 30s, 30s... |
| 12 | Agent message queue flushes on reconnect | Disconnect agent, send message locally, reconnect relay, verify message sent |
| 13 | Broadcast clears disconnected clients | Connect web client, send agent status, disconnect client mid-broadcast, verify no crash |
| 14 | Profile isolation enforced | Connect two profiles, send message from profile A, verify profile B never receives |

---

## 13. Post-Phase 4 Checklist

After Phase 4 completion, before moving to Phase 5:

- [ ] All four message types validated with Zod at both ends
- [ ] Connection pool is synchronized and garbage-collected
- [ ] Heartbeat monitoring active, agents timeout correctly
- [ ] Web app maintains persistent connection during session
- [ ] Agent auto-reconnects and queues messages offline
- [ ] No cross-profile message leaks
- [ ] Test suite passes
- [ ] Zero TypeScript errors
- [ ] Code follows project conventions (imports, naming, comments)

---

## Decision Points

> **✅ RESOLVED**: Hono + ws integration — use the raw HTTP server approach (Option A). Standard practice for Hono-on-Node. Full control over upgrade handling.

> **✅ RESOLVED**: Relay actively closes stale agent sockets after 90s with no heartbeat. Cleaner state management. Agent reconnects automatically.

> **✅ RESOLVED**: Profile tokens have a 24-hour expiry. Longer than admin tokens since profiles are low-risk. Users re-select their profile daily.

---

## Next Phases

- **Phase 5** (Search & Browse): Use the relay's `/ws` to push search results and stream availability in real-time (optional; can remain HTTP polling).
- **Phase 6** (Download Pipeline): Agent handlers for download:request, RD API client, file download, organizer. Relay queue delivery on reconnect.
- **Phase 7** (Real-Time UI): React components consume zustand store, live progress bars, toast notifications.

