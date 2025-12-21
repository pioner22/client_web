import type { AppState, ChatMessage } from "../../stores/types";

export function upsertConversation(state: AppState, key: string, msg: ChatMessage): AppState {
  const prev = state.conversations[key] ?? [];
  let next: ChatMessage[];
  if (msg.id !== undefined && msg.id !== null) {
    const i = prev.findIndex((m) => m.id === msg.id);
    if (i >= 0) {
      next = [...prev];
      next[i] = msg;
    } else {
      next = [...prev, msg];
    }
  } else {
    next = [...prev, msg];
  }
  return {
    ...state,
    conversations: { ...state.conversations, [key]: next },
  };
}
