import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { verifyToken } from "../auth.js";
import {
  addAgent,
  removeAgent,
  addClient,
  removeClient,
  broadcastToClients,
  getAgent,
  handleHeartbeat,
} from "./pool.js";
import { messageSchema } from "@tadaima/shared";
import { db } from "../db.js";
import { devices } from "@tadaima/shared";
import { eq, and } from "drizzle-orm";
import {
  queueDownload,
  deliverQueuedDownloads,
  recordDownloadHistory,
} from "./queue.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function attachWebSocket(server: any): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    const token = url.searchParams.get("token");
    const path = url.pathname;

    if (path !== "/ws" && path !== "/ws/agent") {
      socket.destroy();
      return;
    }

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      const payload = await verifyToken(token);

      if (path === "/ws/agent") {
        if (payload.type !== "device") {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }

        // Verify the device token hash exists in DB
        const { createHash } = await import("node:crypto");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const [device] = await db
          .select({ id: devices.id })
          .from(devices)
          .where(
            and(
              eq(devices.id, payload.deviceId),
              eq(devices.tokenHash, tokenHash),
            ),
          )
          .limit(1);

        if (!device) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          handleAgentConnection(ws, payload.sub!, payload.deviceId);
        });
      } else {
        // /ws — client connection
        if (payload.type !== "profile" && payload.type !== "admin") {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          handleClientConnection(ws, payload.sub!);
        });
      }
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    }
  });
}

function handleAgentConnection(
  ws: WebSocket,
  profileId: string,
  deviceId: string,
): void {
  addAgent(ws, profileId, deviceId);

  ws.on("message", (data) => {
    try {
      const raw = JSON.parse(data.toString());
      const msg = messageSchema.safeParse(raw);

      if (!msg.success) return;

      const message = msg.data;

      if (message.type === "agent:heartbeat") {
        handleHeartbeat(profileId, deviceId);
        return; // NOT forwarded
      }

      if (message.type === "agent:hello") {
        handleHeartbeat(profileId, deviceId);
        // Deliver any queued downloads
        deliverQueuedDownloads(profileId, deviceId).catch(console.error);
        return;
      }

      // Record completed/failed downloads in history
      if (
        message.type === "download:completed" ||
        message.type === "download:failed"
      ) {
        // History recording is best-effort
        const p = message.payload as Record<string, unknown>;
        if (p._meta) {
          const meta = p._meta as Record<string, unknown>;
          recordDownloadHistory(profileId, deviceId, {
            tmdbId: meta.tmdbId as number,
            imdbId: meta.imdbId as string,
            title: meta.title as string,
            year: meta.year as number,
            mediaType: meta.mediaType as string,
            season: meta.season as number | undefined,
            episode: meta.episode as number | undefined,
            episodeTitle: meta.episodeTitle as string | undefined,
            magnet: meta.magnet as string,
            torrentName: meta.torrentName as string,
            expectedSize: meta.expectedSize as number,
            sizeBytes:
              message.type === "download:completed"
                ? (p.finalSize as number)
                : undefined,
            status:
              message.type === "download:completed" ? "completed" : "failed",
            error: message.type === "download:failed" ? (p.error as string) : undefined,
            retryable:
              message.type === "download:failed"
                ? (p.retryable as boolean)
                : undefined,
          }).catch(console.error);
        }
      }

      // All other agent events → broadcast to profile's web clients
      broadcastToClients(profileId, JSON.stringify(message));
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on("close", () => {
    removeAgent(profileId, deviceId);
  });

  ws.on("error", () => {
    removeAgent(profileId, deviceId);
  });
}

function handleClientConnection(ws: WebSocket, profileId: string): void {
  addClient(ws, profileId);

  ws.on("message", async (data) => {
    try {
      const raw = JSON.parse(data.toString());
      const msg = messageSchema.safeParse(raw);

      if (!msg.success) return;

      const message = msg.data;

      // Route commands to target agent
      if (
        message.type === "download:request" ||
        message.type === "download:cancel" ||
        message.type === "cache:check"
      ) {
        // Find target device — use explicit targetDeviceId or default device
        const targetDeviceId =
          (raw as Record<string, unknown>).targetDeviceId as string | undefined;

        let agent;
        if (targetDeviceId) {
          agent = getAgent(profileId, targetDeviceId);
        } else {
          // Find profile's default device
          const [defaultDevice] = await db
            .select({ id: devices.id })
            .from(devices)
            .where(
              and(
                eq(devices.profileId, profileId),
                eq(devices.isDefault, true),
              ),
            )
            .limit(1);

          if (defaultDevice) {
            agent = getAgent(profileId, defaultDevice.id);
          }
        }

        if (agent && agent.ws.readyState === 1) {
          agent.ws.send(JSON.stringify(message));
        } else if (message.type === "download:request") {
          // Agent offline — queue the download
          const deviceIdToQueue = targetDeviceId ?? (await db
            .select({ id: devices.id })
            .from(devices)
            .where(and(eq(devices.profileId, profileId), eq(devices.isDefault, true)))
            .limit(1)
            .then((r) => r[0]?.id));

          if (deviceIdToQueue) {
            const payload = message.payload as Record<string, unknown>;
            await queueDownload(
              profileId,
              deviceIdToQueue,
              raw as Record<string, unknown>,
              raw.id as string,
              (payload.title as string) ?? "Unknown",
            );
          } else {
            ws.send(JSON.stringify({
              id: `reject-${Date.now()}`,
              type: "download:rejected",
              timestamp: Date.now(),
              payload: { requestId: raw.id ?? "", reason: "No device available" },
            }));
          }
        } else {
          // Non-download commands to offline agent — reject
          ws.send(
            JSON.stringify({
              id: `reject-${Date.now()}`,
              type: "download:rejected",
              timestamp: Date.now(),
              payload: {
                requestId: raw.id ?? "",
                reason: "Target device is offline",
              },
            }),
          );
        }
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on("close", () => {
    removeClient(ws, profileId);
  });

  ws.on("error", () => {
    removeClient(ws, profileId);
  });
}
