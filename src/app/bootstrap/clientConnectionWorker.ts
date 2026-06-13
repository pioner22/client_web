import type { Store } from "../../stores/store";
import type { AppState } from "../../stores/types";
import type { GatewayTransport } from "../../lib/net/gatewayClient";
import type { ClientUpdateConnectionReadiness } from "./lazyPwaUpdateRuntime";

export interface ClientUpdateReadinessWorker {
  whenClientReadyForConnection: (opts?: { timeoutMs?: number }) => Promise<ClientUpdateConnectionReadiness>;
}

export interface ClientConnectionWorker {
  startAfterClientUpdateReady: () => void;
  connectNow: (reason?: string) => void;
}

export interface ClientConnectionWorkerDeps {
  store: Store<AppState>;
  gateway: GatewayTransport;
  updateWorker: ClientUpdateReadinessWorker;
  readinessTimeoutMs?: number;
}

function updateCheckStatus(): string {
  return "Проверяем обновление клиента перед подключением…";
}

function blockedStatus(readiness: ClientUpdateConnectionReadiness): string {
  const build = readiness.buildId ? ` (${readiness.buildId})` : "";
  if (readiness.reason.startsWith("update_") && readiness.reason !== "update_pending") {
    return `Обновление клиента выполняется${build}. Подключение к серверу начнётся после завершения обновления.`;
  }
  return `Доступно обновление клиента${build}. Сначала обновите приложение, затем подключение запустится автоматически после перезапуска.`;
}

export function createClientConnectionWorker(deps: ClientConnectionWorkerDeps): ClientConnectionWorker {
  const { store, gateway, updateWorker } = deps;
  const readinessTimeoutMs = Math.max(800, Math.min(8000, Math.trunc(Number(deps.readinessTimeoutMs ?? 4500) || 4500)));
  let connectStarted = false;
  let readinessInFlight = false;

  function connectNow(reason = "manual"): void {
    if (connectStarted) return;
    connectStarted = true;
    try {
      (globalThis as any).__yagodka_connect_reason = reason;
    } catch {
      // ignore
    }
    gateway.connect();
  }

  function markChecking(): void {
    store.set((prev) => {
      if (prev.conn === "connected") return prev;
      const nextStatus = updateCheckStatus();
      if (prev.status === nextStatus) return prev;
      return { ...prev, status: nextStatus };
    });
  }

  function markBlocked(readiness: ClientUpdateConnectionReadiness): void {
    const status = blockedStatus(readiness);
    store.set((prev) => ({
      ...prev,
      conn: prev.conn === "connected" ? prev.conn : "disconnected",
      status,
      pwaUpdateAvailable: prev.pwaUpdateAvailable || readiness.reason === "update_pending",
      ...(readiness.reason === "update_pending" || prev.pwaUpdateAvailable ? { modal: { kind: "pwa_update" as const } } : {}),
    }));
  }

  async function startAfterClientUpdateReady(): Promise<void> {
    if (connectStarted || readinessInFlight) return;
    readinessInFlight = true;
    markChecking();
    try {
      const readiness = await updateWorker.whenClientReadyForConnection({ timeoutMs: readinessTimeoutMs });
      if (readiness.connect) {
        connectNow(readiness.reason || "client_update_ready");
        return;
      }
      markBlocked(readiness);
    } finally {
      readinessInFlight = false;
    }
  }

  return {
    startAfterClientUpdateReady: () => {
      void startAfterClientUpdateReady();
    },
    connectNow,
  };
}
