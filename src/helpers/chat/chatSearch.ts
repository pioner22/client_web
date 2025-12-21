export interface ChatSearchableMessage {
  text?: string | null;
  attachmentName?: string | null;
}

function norm(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function computeChatSearchHits(messages: ChatSearchableMessage[], query: string): number[] {
  const q = norm(query);
  if (!q) return [];
  const out: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i] || {};
    const hay = norm(`${m.text || ""} ${m.attachmentName || ""}`);
    if (!hay) continue;
    if (hay.includes(q)) out.push(i);
  }
  return out;
}

export function clampChatSearchPos(hits: number[], pos: number): number {
  if (!hits.length) return 0;
  const p = Number.isFinite(pos) ? Math.trunc(pos) : 0;
  if (p < 0) return 0;
  if (p >= hits.length) return hits.length - 1;
  return p;
}

export function stepChatSearchPos(hits: number[], pos: number, dir: 1 | -1): number {
  if (!hits.length) return 0;
  const p = clampChatSearchPos(hits, pos);
  const next = (p + dir + hits.length) % hits.length;
  return next;
}

