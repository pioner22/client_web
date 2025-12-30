export type ChatSearchFilter = "all" | "media" | "files" | "links" | "audio";

export interface ChatSearchFlags {
  media?: boolean;
  files?: boolean;
  links?: boolean;
  audio?: boolean;
}

export interface ChatSearchableMessage {
  text?: string | null;
  attachmentName?: string | null;
  flags?: ChatSearchFlags;
}

export interface ChatSearchCounts {
  all: number;
  media: number;
  files: number;
  links: number;
  audio: number;
}

export const CHAT_SEARCH_FILTERS: Array<{ id: ChatSearchFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "media", label: "Медиа" },
  { id: "files", label: "Файлы" },
  { id: "links", label: "Ссылки" },
  { id: "audio", label: "Аудио" },
];

function norm(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesFilter(flags: ChatSearchFlags | undefined, filter: ChatSearchFilter): boolean {
  if (filter === "all") return true;
  if (!flags) return false;
  return Boolean(flags[filter]);
}

function matchesQuery(message: ChatSearchableMessage, q: string): boolean {
  const hay = norm(`${message.text || ""} ${message.attachmentName || ""}`);
  if (!hay) return false;
  return hay.includes(q);
}

export function createChatSearchCounts(): ChatSearchCounts {
  return { all: 0, media: 0, files: 0, links: 0, audio: 0 };
}

export function computeChatSearchCounts(messages: ChatSearchableMessage[], query: string): ChatSearchCounts {
  const q = norm(query);
  const counts = createChatSearchCounts();
  if (!q) return counts;
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i] || {};
    if (!matchesQuery(m, q)) continue;
    counts.all += 1;
    if (m.flags?.media) counts.media += 1;
    if (m.flags?.files) counts.files += 1;
    if (m.flags?.links) counts.links += 1;
    if (m.flags?.audio) counts.audio += 1;
  }
  return counts;
}

export function computeChatSearchHits(messages: ChatSearchableMessage[], query: string, filter: ChatSearchFilter = "all"): number[] {
  const q = norm(query);
  if (!q) return [];
  const out: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i] || {};
    if (!matchesQuery(m, q)) continue;
    if (!matchesFilter(m.flags, filter)) continue;
    out.push(i);
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
