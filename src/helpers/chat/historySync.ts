import type { ChatMessage } from "../../stores/types";

export function newestServerMessageId(msgs: ChatMessage[]): number | null {
  let max: number | null = null;
  for (const m of msgs) {
    const id = m.id;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
    if (max === null || id > max) max = id;
  }
  return max;
}

