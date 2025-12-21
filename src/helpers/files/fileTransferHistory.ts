import type { FileTransferEntry, FileTransferStatus } from "../../stores/types";

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const FILE_TRANSFERS_VERSION = 1;
const MAX_ENTRIES = 200;
const TERMINAL_STATUSES = new Set<FileTransferStatus>(["complete", "uploaded", "error", "rejected"]);

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_file_transfers_v${FILE_TRANSFERS_VERSION}:${id}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

function normalizeStatus(raw: unknown): FileTransferStatus | null {
  const s = String(raw ?? "").trim();
  if (s === "offering") return "offering";
  if (s === "uploading") return "uploading";
  if (s === "uploaded") return "uploaded";
  if (s === "downloading") return "downloading";
  if (s === "complete") return "complete";
  if (s === "rejected") return "rejected";
  if (s === "error") return "error";
  return null;
}

function sanitizeEntry(raw: unknown): FileTransferEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as any;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  if (!id) return null;

  const status = normalizeStatus(obj.status);
  if (!status || !TERMINAL_STATUSES.has(status)) return null;

  const localIdRaw = typeof obj.localId === "string" ? obj.localId.trim() : "";
  const localId = localIdRaw || `ft-${id}`;

  const nameRaw = typeof obj.name === "string" ? obj.name : "";
  const name = nameRaw.trim() || "файл";

  const sizeNum = Number(obj.size ?? 0);
  const size = Number.isFinite(sizeNum) && sizeNum > 0 ? Math.round(sizeNum) : 0;

  const dir = String(obj.direction ?? "").trim();
  const direction = dir === "in" || dir === "out" ? (dir as "in" | "out") : null;
  if (!direction) return null;

  const peerRaw = typeof obj.peer === "string" ? obj.peer.trim() : "";
  const peer = peerRaw || "—";

  const roomRaw = obj.room;
  const room = typeof roomRaw === "string" ? roomRaw : roomRaw === null ? null : null;

  const progressNum = Number(obj.progress ?? 0);
  const progress =
    status === "complete" || status === "uploaded"
      ? 100
      : Number.isFinite(progressNum)
        ? Math.max(0, Math.min(100, Math.round(progressNum)))
        : 0;

  const errorRaw = typeof obj.error === "string" ? obj.error.trim() : "";
  const error = errorRaw || null;

  return {
    localId,
    id,
    name,
    size,
    direction,
    peer,
    room,
    status,
    progress,
    ...(error ? { error } : {}),
  };
}

export function sanitizeFileTransfers(raw: unknown): FileTransferEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FileTransferEntry[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    const entry = sanitizeEntry(it);
    if (!entry) continue;
    const key = String(entry.id || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

export function parseFileTransfersPayload(raw: string | null): FileTransferEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const obj = parsed as any;
    if (obj.v !== FILE_TRANSFERS_VERSION) return [];
    return sanitizeFileTransfers(obj.transfers);
  } catch {
    return [];
  }
}

export function serializeFileTransfersPayload(transfers: FileTransferEntry[]): string {
  return JSON.stringify({ v: FILE_TRANSFERS_VERSION, transfers: sanitizeFileTransfers(transfers) });
}

export function loadFileTransfersForUser(userId: string, storage?: StorageLike | null): FileTransferEntry[] {
  const key = storageKey(userId);
  if (!key) return [];
  const st = storage ?? defaultStorage();
  if (!st) return [];
  try {
    return parseFileTransfersPayload(st.getItem(key));
  } catch {
    return [];
  }
}

export function saveFileTransfersForUser(userId: string, transfers: FileTransferEntry[], storage?: StorageLike | null): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const sanitized = sanitizeFileTransfers(transfers);
    if (!sanitized.length) {
      st.removeItem(key);
      return;
    }
    st.setItem(key, serializeFileTransfersPayload(sanitized));
  } catch {
    // ignore
  }
}
