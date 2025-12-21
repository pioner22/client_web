import type { ConnStatus } from "../state";

export type MsgHandler = (msg: any) => void;
export type StatusHandler = (st: ConnStatus, detail?: string) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;

  constructor(
    private url: string,
    private onMessage: MsgHandler,
    private onStatus: StatusHandler
  ) {}

  connect() {
    this.clearReconnect();
    this.onStatus("connecting");

    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.attempts = 0;
        this.onStatus("connected");
      };
      ws.onclose = () => {
        this.ws = null;
        this.onStatus("disconnected");
        this.scheduleReconnect();
      };
      ws.onerror = () => {
        // onclose will follow in most browsers
      };
      ws.onmessage = (ev) => {
        try {
          const data = typeof ev.data === "string" ? ev.data : "";
          const msg = JSON.parse(data);
          this.onMessage(msg);
        } catch {
          // ignore
        }
      };
    } catch (e) {
      this.ws = null;
      this.onStatus("disconnected", String(e));
      this.scheduleReconnect();
    }
  }

  send(obj: unknown) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      // ignore
    }
  }

  close() {
    this.clearReconnect();
    try {
      this.ws?.close();
    } catch {
      // ignore
    } finally {
      this.ws = null;
    }
  }

  private scheduleReconnect() {
    this.clearReconnect();
    const base = 300;
    const max = 5_000;
    const delay = Math.min(max, base * 2 ** Math.min(6, this.attempts++));
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

