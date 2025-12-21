import type { ConnStatus } from "../../stores/types";

export type MsgHandler = (msg: any) => void;
export type StatusHandler = (st: ConnStatus, detail?: string) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private stableTimer: number | null = null;
  private pingTimer: number | null = null;
  private readonly pingIntervalMs = 10_000;
  private attempts = 0;

  constructor(
    private url: string,
    private onMessage: MsgHandler,
    private onStatus: StatusHandler
  ) {}

  connect() {
    this.clearReconnect();
    this.clearStable();
    this.clearPing();
    this.onStatus("connecting");

    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.onStatus("connected");
        this.startPing();
        // Reset exponential backoff only after the connection stays up for a bit.
        this.stableTimer = window.setTimeout(() => {
          this.attempts = 0;
          this.stableTimer = null;
        }, 2_000);
      };
      ws.onclose = (ev) => {
        this.ws = null;
        this.clearStable();
        this.clearPing();
        const code = typeof ev?.code === "number" ? ev.code : 0;
        const reason = typeof ev?.reason === "string" ? ev.reason : "";
        const detail = code ? `code=${code}${reason ? ` reason=${reason}` : ""}` : undefined;
        this.onStatus("disconnected", detail);
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this.clearReconnect();
    this.clearStable();
    this.clearPing();
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

  private clearStable() {
    if (this.stableTimer !== null) {
      window.clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private startPing() {
    if (this.pingTimer !== null) return;
    this.send({ type: "ping" });
    this.pingTimer = window.setInterval(() => {
      this.send({ type: "ping" });
    }, this.pingIntervalMs);
  }

  private clearPing() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
