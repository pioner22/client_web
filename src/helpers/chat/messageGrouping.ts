import type { ChatMessage } from "../../stores/types";

export function isMessageContinuation(
  prev: ChatMessage | null,
  cur: ChatMessage,
  opts?: { maxGapSeconds?: number }
): boolean {
  if (!prev) return false;
  if (!cur) return false;
  if (prev.kind === "sys" || cur.kind === "sys") return false;
  if (prev.kind !== cur.kind) return false;

  const prevFrom = String(prev.from || "").trim();
  const curFrom = String(cur.from || "").trim();
  if (!prevFrom || !curFrom) return false;
  if (prevFrom !== curFrom) return false;

  const prevRoom = String(prev.room || "").trim();
  const curRoom = String(cur.room || "").trim();
  if (prevRoom !== curRoom) return false;

  const maxGap = Math.max(10, Math.min(30 * 60, Number(opts?.maxGapSeconds) || 5 * 60));
  const dt = Number(cur.ts) - Number(prev.ts);
  if (!Number.isFinite(dt) || dt < 0) return false;
  return dt <= maxGap;
}

