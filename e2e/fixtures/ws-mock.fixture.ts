import WebSocket from "ws";
import { WS_URL } from "../helpers/constants";

/**
 * Mock agent that connects to the relay via WebSocket.
 * Simulates a paired device for E2E tests.
 */
export class MockAgent {
  private ws: WebSocket | null = null;
  private messageHandlers: Array<(msg: Record<string, unknown>) => void> = [];
  private connected = false;
  private relayUrl: string;
  private deviceToken: string;

  constructor(relayUrl: string = WS_URL, deviceToken: string = "") {
    this.relayUrl = relayUrl;
    this.deviceToken = deviceToken;
  }

  async connect(deviceToken?: string): Promise<void> {
    if (deviceToken) this.deviceToken = deviceToken;
    return new Promise((resolve, reject) => {
      const url = `${this.relayUrl}/ws/agent?token=${this.deviceToken}`;
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        this.connected = true;
        // Send agent:hello
        this.send({
          id: `hello-${Date.now()}`,
          type: "agent:hello",
          timestamp: Date.now(),
          payload: {
            version: "1.0.0-test",
            platform: "linux",
            hostname: "test-agent",
          },
        });
        resolve();
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          for (const handler of this.messageHandlers) {
            handler(msg);
          }
        } catch {
          // ignore
        }
      });

      this.ws.on("error", reject);
      this.ws.on("close", () => {
        this.connected = false;
      });
    });
  }

  send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async acceptDownload(jobId: string, title?: string): Promise<void> {
    this.send({
      id: `accept-${Date.now()}`,
      type: "download:accepted",
      timestamp: Date.now(),
      payload: { jobId, requestId: jobId, title: title ?? "Test Download" },
    });
  }

  async sendProgress(
    jobId: string,
    progress: number,
    speed: number = 10_000_000,
    phase: string = "downloading",
  ): Promise<void> {
    this.send({
      id: `progress-${Date.now()}`,
      type: "download:progress",
      timestamp: Date.now(),
      payload: {
        jobId,
        phase,
        progress,
        downloadedBytes: Math.floor(progress * 1_000_000_000 / 100),
        totalBytes: 1_000_000_000,
        speedBps: speed,
        eta: Math.floor(((100 - progress) / 100) * 100),
      },
    });
  }

  async completeDownload(jobId: string, filePath?: string): Promise<void> {
    this.send({
      id: `complete-${Date.now()}`,
      type: "download:completed",
      timestamp: Date.now(),
      payload: {
        jobId,
        filePath: filePath ?? "/downloads/test-file.mkv",
        _meta: { title: "Test Movie" },
      },
    });
  }

  async failDownload(
    jobId: string,
    error: string = "Test error",
    retryable: boolean = false,
  ): Promise<void> {
    this.send({
      id: `fail-${Date.now()}`,
      type: "download:failed",
      timestamp: Date.now(),
      payload: {
        jobId,
        error,
        retryable,
        _meta: { title: "Test Movie" },
      },
    });
  }

  async sendHeartbeat(): Promise<void> {
    this.send({
      id: `hb-${Date.now()}`,
      type: "agent:heartbeat",
      timestamp: Date.now(),
      payload: {
        uptime: 3600,
        diskFreeBytes: 100_000_000_000,
        activeDownloads: 0,
      },
    });
  }

  onMessage(handler: (msg: Record<string, unknown>) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  waitForMessage(
    type: string,
    timeout: number = 5000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout waiting for message type: ${type}`)),
        timeout,
      );
      const unsub = this.onMessage((msg) => {
        if (msg.type === type) {
          clearTimeout(timer);
          unsub();
          resolve(msg);
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
      this.connected = false;
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
