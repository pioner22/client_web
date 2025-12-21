import type { ChatMessage } from "../../stores/types";

function stableKey(m: ChatMessage): string {
  if (m.id !== undefined && m.id !== null) return `id:${m.id}`;
  return `ts:${m.ts}|from:${m.from}|room:${m.room ?? ""}|to:${m.to ?? ""}|text:${m.text}`;
}

function sortKey(m: ChatMessage): number {
  if (m.id !== undefined && m.id !== null) return Number(m.id);
  return Number(m.ts) || 0;
}

export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of prev) map.set(stableKey(m), m);
  for (const m of incoming) map.set(stableKey(m), m);
  const merged = Array.from(map.values());
  merged.sort((a, b) => sortKey(a) - sortKey(b));
  return merged;
}
