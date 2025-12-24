import type { ConnStatus } from "../../stores/types";

export type MsgHandler = (msg: any) => void;
export type StatusHandler = (st: ConnStatus, detail?: string) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private stableTimer: number | null = null;
  private pingTimer: number | null = null;
  private readonly pingIntervalMs = 10_000;
  private readonly reconnectBaseMs = 400;
  private readonly reconnectMaxMs = 30_000;
  private attempts = 0;
  private manualClose = false;
  private lastOpenAt = 0;
  private lastCloseAt = 0;
  private waitingOnline = false;
  private waitingVisible = false;
  private onlineHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor(
    private url: string,
    private onMessage: MsgHandler,
    private onStatus: StatusHandler
  ) {}

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.clearReconnect();
    this.clearStable();
    this.clearPing();
    this.clearWaiters();
    this.manualClose = false;
    if (this.deferIfOffline(true) || this.deferIfHidden(true)) return;
    this.onStatus("connecting");

    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.lastOpenAt = Date.now();
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
        this.lastCloseAt = Date.now();
        const code = typeof ev?.code === "number" ? ev.code : 0;
        const reason = typeof ev?.reason === "string" ? ev.reason : "";
        const baseDetail = code ? `code=${code}${reason ? ` reason=${reason}` : ""}` : "";
        const offlineNote = this.isOffline() ? "offline" : "";
        const hiddenNote = this.isHidden() ? "background" : "";
        const notes = [baseDetail, offlineNote, hiddenNote].filter(Boolean).join("; ");
        const detail = notes || undefined;
        this.onStatus("disconnected", detail);
        if (!this.manualClose) this.scheduleReconnect();
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
    this.manualClose = true;
    this.clearReconnect();
    this.clearStable();
    this.clearPing();
    this.clearWaiters();
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
    if (this.deferIfOffline(false) || this.deferIfHidden(false)) return;
    const now = Date.now();
    const lastUp = this.lastOpenAt ? now - this.lastOpenAt : 0;
    let delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** Math.min(7, this.attempts++));
    if (lastUp > 0 && lastUp < 1200) delay = Math.max(delay, 2000);
    const jitter = 0.85 + Math.random() * 0.3;
    delay = Math.round(delay * jitter);
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

  private isOffline(): boolean {
    try {
      if (typeof navigator !== "undefined" && "onLine" in navigator) return navigator.onLine === false;
    } catch {
      // ignore
    }
    return false;
  }

  private isHidden(): boolean {
    try {
      return typeof document !== "undefined" && document.visibilityState === "hidden";
    } catch {
      return false;
    }
  }

  private deferIfOffline(announce: boolean): boolean {
    if (!this.isOffline()) return false;
    if (announce) this.onStatus("disconnected", "offline");
    this.waitForOnline();
    return true;
  }

  private deferIfHidden(announce: boolean): boolean {
    if (!this.isHidden()) return false;
    if (announce) this.onStatus("disconnected", "background");
    this.waitForVisible();
    return true;
  }

  private waitForOnline() {
    if (this.waitingOnline) return;
    this.waitingOnline = true;
    try {
      this.onlineHandler = () => {
        this.waitingOnline = false;
        this.clearWaiters();
        this.connect();
      };
      window.addEventListener("online", this.onlineHandler, { once: true });
    } catch {
      // ignore
    }
  }

  private waitForVisible() {
    if (this.waitingVisible) return;
    this.waitingVisible = true;
    try {
      this.visibilityHandler = () => {
        if (document.visibilityState !== "visible") return;
        this.waitingVisible = false;
        this.clearWaiters();
        this.connect();
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    } catch {
      // ignore
    }
  }

  private clearWaiters() {
    if (this.onlineHandler) {
      try {
        window.removeEventListener("online", this.onlineHandler);
      } catch {
        // ignore
      }
      this.onlineHandler = null;
    }
    if (this.visibilityHandler) {
      try {
        document.removeEventListener("visibilitychange", this.visibilityHandler);
      } catch {
        // ignore
      }
      this.visibilityHandler = null;
    }
    this.waitingOnline = false;
    this.waitingVisible = false;
  }
}
