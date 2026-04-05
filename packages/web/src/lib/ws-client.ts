type ConnectionStatus = "connecting" | "connected" | "disconnected";
type MessageHandler = (message: Record<string, unknown>) => void;

function getWsUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) return apiUrl.replace(/^http/, "ws").replace(/\/$/, "");
  // In production, derive from current origin
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

class WebSocketClient {
  private ws: WebSocket | null = null;
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: string[] = [];
  private handlers: MessageHandler[] = [];
  private statusListeners: ((status: ConnectionStatus) => void)[] = [];
  private stopped = false;
  private token: string | null = null;

  connect(token: string): void {
    this.token = token;
    this.stopped = false;
    this.setStatus("connecting");

    const wsUrl = getWsUrl();
    const url = `${wsUrl}/ws?token=${token}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.backoff = 1000;
      this.setStatus("connected");
      this.drainQueue();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch {
        // Ignore malformed
      }
    };

    this.ws.onclose = () => {
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.setStatus("disconnected");
    };
  }

  disconnect(): void {
    this.stopped = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  send(message: Record<string, unknown>): void {
    const data = JSON.stringify(message);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.messageQueue.push(data);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private setStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private drainQueue(): void {
    while (
      this.messageQueue.length > 0 &&
      this.ws?.readyState === WebSocket.OPEN
    ) {
      this.ws.send(this.messageQueue.shift()!);
    }
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.token) return;
    this.reconnectTimer = setTimeout(() => {
      this.backoff = Math.min(this.backoff * 2, 30_000);
      this.connect(this.token!);
    }, this.backoff);
  }
}

export const wsClient = new WebSocketClient();
