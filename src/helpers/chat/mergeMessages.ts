import type { ChatMessage } from "../../stores/types";

function stableKey(m: ChatMessage): string {
  if (m.id !== undefined && m.id !== null) return `id:${m.id}`;
  const localId = typeof m.localId === "string" ? m.localId.trim() : "";
  if (localId) return `local:${localId}`;
  return `ts:${m.ts}|from:${m.from}|room:${m.room ?? ""}|to:${m.to ?? ""}|text:${m.text}`;
}

function sortKey(m: ChatMessage): number {
  if (m.id !== undefined && m.id !== null) return Number(m.id);
  return Number(m.ts) || 0;
}

function mergeLocalFields(prev: ChatMessage, next: ChatMessage): ChatMessage {
  const reply = next.reply !== undefined ? next.reply : prev.reply;
  const forward = next.forward !== undefined ? next.forward : prev.forward;
  const localId = next.localId !== undefined ? next.localId : prev.localId;
  return {
    ...next,
    ...(localId !== undefined ? { localId } : {}),
    ...(reply !== undefined ? { reply } : {}),
    ...(forward !== undefined ? { forward } : {}),
  };
}

export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of prev) map.set(stableKey(m), m);
  for (const m of incoming) {
    const key = stableKey(m);
    const existing = map.get(key);
    map.set(key, existing ? mergeLocalFields(existing, m) : m);
  }
  const merged = Array.from(map.values());
  merged.sort((a, b) => sortKey(a) - sortKey(b));
  return merged;
}
