import type WebSocket from "ws";
import { db } from "../db.js";
import { devices } from "@tadaima/shared";
import { eq } from "drizzle-orm";
import { createTimestamp } from "@tadaima/shared";

export interface AgentConnection {
  ws: WebSocket;
  profileId: string;
  deviceId: string;
}

export interface ClientConnection {
  ws: WebSocket;
  profileId: string;
}

// agents: Map<"profileId:deviceId", AgentConnection>
const agentPool = new Map<string, AgentConnection>();

// clients: Map<profileId, Set<ClientConnection>>
const clientPool = new Map<string, Set<ClientConnection>>();

function agentKey(profileId: string, deviceId: string): string {
  return `${profileId}:${deviceId}`;
}

// ── Agent pool ─────────────────────────────────────────────────

export function addAgent(
  ws: WebSocket,
  profileId: string,
  deviceId: string,
): void {
  const key = agentKey(profileId, deviceId);

  // Close existing connection if any
  const existing = agentPool.get(key);
  if (existing) {
    existing.ws.close(1000, "Replaced by new connection");
  }

  agentPool.set(key, { ws, profileId, deviceId });

  // Mark online in DB and broadcast
  db.update(devices)
    .set({ isOnline: true, lastSeenAt: new Date() })
    .where(eq(devices.id, deviceId))
    .then(() => broadcastDeviceStatus(profileId, deviceId, true));
}

export function removeAgent(profileId: string, deviceId: string): void {
  const key = agentKey(profileId, deviceId);
  agentPool.delete(key);

  // Mark offline and broadcast
  db.update(devices)
    .set({ isOnline: false, lastSeenAt: new Date() })
    .where(eq(devices.id, deviceId))
    .then(() => broadcastDeviceStatus(profileId, deviceId, false));
}

export function getAgent(
  profileId: string,
  deviceId: string,
): AgentConnection | undefined {
  return agentPool.get(agentKey(profileId, deviceId));
}

export function getAgentsForProfile(profileId: string): AgentConnection[] {
  const result: AgentConnection[] = [];
  for (const conn of agentPool.values()) {
    if (conn.profileId === profileId) result.push(conn);
  }
  return result;
}

// ── Client pool ────────────────────────────────────────────────

export function addClient(ws: WebSocket, profileId: string): void {
  let set = clientPool.get(profileId);
  if (!set) {
    set = new Set();
    clientPool.set(profileId, set);
  }
  set.add({ ws, profileId });
}

export function removeClient(ws: WebSocket, profileId: string): void {
  const set = clientPool.get(profileId);
  if (!set) return;
  for (const conn of set) {
    if (conn.ws === ws) {
      set.delete(conn);
      break;
    }
  }
  if (set.size === 0) clientPool.delete(profileId);
}

export function getClientsForProfile(profileId: string): ClientConnection[] {
  const set = clientPool.get(profileId);
  return set ? Array.from(set) : [];
}

// ── Broadcasting ───────────────────────────────────────────────

export function broadcastToClients(profileId: string, message: string): void {
  for (const client of getClientsForProfile(profileId)) {
    if (client.ws.readyState === 1) {
      client.ws.send(message);
    }
  }
}

function broadcastDeviceStatus(
  profileId: string,
  deviceId: string,
  isOnline: boolean,
): void {
  const msg = JSON.stringify({
    id: `status-${deviceId}-${Date.now()}`,
    type: "device:status",
    timestamp: createTimestamp(),
    payload: { deviceId, isOnline, lastSeenAt: createTimestamp() },
  });
  broadcastToClients(profileId, msg);
}

// ── Heartbeat ──────────────────────────────────────────────────

export function handleHeartbeat(
  profileId: string,
  deviceId: string,
): void {
  db.update(devices)
    .set({ isOnline: true, lastSeenAt: new Date() })
    .where(eq(devices.id, deviceId))
    .catch(console.error);
}

// Stale connection reaper — check every 90s for agents that haven't sent heartbeats
const STALE_TIMEOUT_MS = 90_000;

export function startStaleReaper(): void {
  setInterval(async () => {
    // Find devices marked online but with no active WS connection
    const staleDevices = await db
      .select({ id: devices.id, profileId: devices.profileId })
      .from(devices)
      .where(eq(devices.isOnline, true));

    for (const device of staleDevices) {
      const conn = getAgent(device.profileId, device.id);
      if (!conn) {
        // No active WS connection but DB says online — mark offline
        await db
          .update(devices)
          .set({ isOnline: false })
          .where(eq(devices.id, device.id));
        broadcastDeviceStatus(device.profileId, device.id, false);
      }
    }
  }, STALE_TIMEOUT_MS);
}
