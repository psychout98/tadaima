import WebSocket from "ws";
import { platform, freemem } from "node:os";
import { createMessageId, createTimestamp } from "@tadaima/shared";
import { config } from "./config.js";

const HEARTBEAT_INTERVAL = 30_000;
const MAX_BACKOFF = 30_000;

type MessageHandler = (message: Record<string, unknown>) => void;

export class AgentWebSocket {
  private ws: WebSocket | null = null;
  private backoff = 1000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: string[] = [];
  private onMessage: MessageHandler | null = null;
  private stopped = false;
  private startTime = Date.now();
  private activeJobs = 0;

  connect(): void {
    this.stopped = false;
    const relayUrl = config.get("relay");
    const deviceToken = config.get("deviceToken");

    if (!relayUrl || !deviceToken) {
      console.error("Not configured. Run `tadaima-agent setup` first.");
      return;
    }

    const wsUrl = relayUrl
      .replace(/^http/, "ws")
      .replace(/\/$/, "");
    const url = `${wsUrl}/ws/agent?token=${deviceToken}`;

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log("Connected to relay");
      this.backoff = 1000;
      this.sendHello();
      this.startHeartbeat();
      this.drainQueue();
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (this.onMessage) {
          this.onMessage(msg);
        }
      } catch (err) {
        const raw = data.toString().slice(0, 200);
        console.error("Failed to parse WebSocket message:", err, "raw:", raw);
      }
    });

    this.ws.on("close", () => {
      console.log("Disconnected from relay");
      this.cleanup();
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
      this.cleanup();
      this.scheduleReconnect();
    });
  }

  stop(): void {
    this.stopped = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, "Agent stopped");
      this.ws = null;
    }
  }

  setMessageHandler(handler: MessageHandler): void {
    this.onMessage = handler;
  }

  send(message: Record<string, unknown>): void {
    const data = JSON.stringify(message);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(data);
      } catch (err) {
        console.error("Send failed, re-queuing message:", err);
        this.messageQueue.push(data);
        this.cleanup();
        this.scheduleReconnect();
      }
    } else {
      this.messageQueue.push(data);
    }
  }

  setActiveJobs(count: number): void {
    this.activeJobs = count;
  }

  private sendHello(): void {
    this.send({
      id: createMessageId(),
      type: "agent:hello",
      timestamp: createTimestamp(),
      payload: {
        version: "0.0.0",
        platform: platform(),
        activeJobs: this.activeJobs,
        diskFreeBytes: freemem(),
      },
    });
  }

  private sendHeartbeat(): void {
    this.send({
      id: createMessageId(),
      type: "agent:heartbeat",
      timestamp: createTimestamp(),
      payload: {
        activeJobs: this.activeJobs,
        diskFreeBytes: freemem(),
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      },
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeat(),
      HEARTBEAT_INTERVAL,
    );
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private drainQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(this.messageQueue[0]);
        this.messageQueue.shift();
      } catch (err) {
        console.error("Drain failed, will retry on reconnect:", err);
        this.cleanup();
        this.scheduleReconnect();
        return;
      }
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
    console.log(`Reconnecting in ${this.backoff / 1000}s...`);
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
  }
}
