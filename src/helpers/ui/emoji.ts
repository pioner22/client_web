export const DEFAULT_EMOJI: string[] = [
  "😀",
  "😅",
  "😂",
  "🙂",
  "😉",
  "😊",
  "😍",
  "😘",
  "😎",
  "🤔",
  "😴",
  "😮",
  "😢",
  "😭",
  "😡",
  "👍",
  "👎",
  "🙏",
  "👏",
  "💪",
  "🔥",
  "✨",
  "💡",
  "✅",
  "❌",
  "⚠️",
  "❤️",
  "💜",
  "💙",
  "💚",
  "💛",
  "💯",
  "🎉",
  "🥳",
  "🍓",
  "🍒",
  "🍇",
  "🍉",
  "☕️",
  "🍕",
  "🎁",
  "📎",
  "📌",
  "🧷",
  "🕒",
  "📷",
  "🖼️",
  "📄",
  "🔒",
  "🔓",
  "🔔",
  "🔕",
  "⭐️",
  "🌙",
  "☀️",
  "🌧️",
  "❄️",
  "🌈",
];

export function insertTextAtSelection(opts: {
  value: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  insertText: string;
}): { value: string; caret: number } {
  const value = String(opts.value ?? "");
  const insertText = String(opts.insertText ?? "");
  const maxPos = value.length;
  const startRaw = typeof opts.selectionStart === "number" ? opts.selectionStart : maxPos;
  const endRaw = typeof opts.selectionEnd === "number" ? opts.selectionEnd : startRaw;

  const start = Math.max(0, Math.min(maxPos, startRaw));
  const end = Math.max(0, Math.min(maxPos, endRaw));
  const a = Math.min(start, end);
  const b = Math.max(start, end);

  const next = value.slice(0, a) + insertText + value.slice(b);
  return { value: next, caret: a + insertText.length };
}

export function updateEmojiRecents(prev: string[], emoji: string, max: number): string[] {
  const e = String(emoji || "").trim();
  if (!e) return Array.isArray(prev) ? prev : [];
  const safePrev = Array.isArray(prev) ? prev.filter((x) => typeof x === "string" && x) : [];
  const dedup = safePrev.filter((x) => x !== e);
  const next = [e, ...dedup];
  return next.slice(0, Math.max(1, Math.min(200, max || 0)));
}

export function mergeEmojiPalette(recents: string[], base: string[]): string[] {
  const r = Array.isArray(recents) ? recents.filter((x) => typeof x === "string" && x) : [];
  const b = Array.isArray(base) ? base.filter((x) => typeof x === "string" && x) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...r, ...b]) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

