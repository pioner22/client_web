import type { OutboxEntry } from "../../stores/types";
import { sanitizeOutboxMap, type OutboxMap } from "../chat/outbox";

const OUTBOX_SYNC_TIMEOUT_MS = 900;
const OUTBOX_SYNC_TAG = "yagodka-outbox-sync";

async function getServiceWorkerController(): Promise<ServiceWorker | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const controller = navigator.serviceWorker.controller;
  if (controller) return controller;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active ?? null;
  } catch {
    return null;
  }
}

function normalizeOutboxForSync(outbox: OutboxMap): OutboxMap {
  const sanitized = sanitizeOutboxMap(outbox);
  const next: OutboxMap = {};
  for (const [key, list] of Object.entries(sanitized)) {
    const filtered = (list || []).filter((e) => e && e.status !== "sending");
    if (filtered.length) next[key] = filtered;
  }
  return next;
}

function hasPendingEntries(outbox: OutboxMap): boolean {
  for (const list of Object.values(outbox || {})) {
    for (const entry of list || []) {
      const status = (entry as OutboxEntry).status;
      if (status !== "sent") return true;
    }
  }
  return false;
}

export async function syncOutboxToServiceWorker(
  userId: string,
  outbox: OutboxMap,
  sessionToken?: string | null
): Promise<void> {
  const uid = String(userId || "").trim();
  if (!uid) return;
  const controller = await getServiceWorkerController();
  if (!controller) return;
  const payloadOutbox = normalizeOutboxForSync(outbox);
  controller.postMessage({
    type: "PWA_OUTBOX_SYNC",
    userId: uid,
    session: sessionToken ?? null,
    outbox: payloadOutbox,
  });

  if (!hasPendingEntries(payloadOutbox)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sync = (reg as any)?.sync;
    if (sync && typeof sync.register === "function") {
      await sync.register(OUTBOX_SYNC_TAG);
    }
  } catch {
    // ignore
  }
}

export async function requestOutboxSnapshot(userId: string): Promise<OutboxMap | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const controller = await getServiceWorkerController();
  if (!controller) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: OutboxMap | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), OUTBOX_SYNC_TIMEOUT_MS);
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      const data = event?.data;
      if (data && typeof data === "object" && data.outbox && typeof data.outbox === "object") {
        finish(data.outbox as OutboxMap);
        return;
      }
      finish(null);
    };
    try {
      controller.postMessage({ type: "PWA_OUTBOX_REQUEST", userId: uid }, [channel.port2]);
    } catch {
      window.clearTimeout(timer);
      finish(null);
    }
  });
}

export async function clearOutboxForUser(userId: string): Promise<void> {
  const uid = String(userId || "").trim();
  if (!uid) return;
  const controller = await getServiceWorkerController();
  if (!controller) return;
  try {
    controller.postMessage({ type: "PWA_OUTBOX_CLEAR", userId: uid });
  } catch {
    // ignore
  }
}
