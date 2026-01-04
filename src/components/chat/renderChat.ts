import { el } from "../../helpers/dom/el";
import { formatTime } from "../../helpers/time";
import { conversationKey } from "../../helpers/chat/conversationKey";
import { messageSelectionKey } from "../../helpers/chat/chatSelection";
import { isPinnedMessage } from "../../helpers/chat/pinnedMessages";
import { isMessageContinuation } from "../../helpers/chat/messageGrouping";
import type { AppState, ChatMessage, ChatMessageRef, FileOfferIn, FileTransferEntry } from "../../stores/types";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { fileBadge } from "../../helpers/files/fileBadge";
import { safeUrl } from "../../helpers/security/safeUrl";
import { renderRichText } from "../../helpers/chat/richText";
import { renderBoardPost } from "../../helpers/boards/boardPost";
import type { Layout } from "../layout/types";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import { clampVirtualAvg, getVirtualEnd, getVirtualMaxStart, getVirtualStart, shouldVirtualize } from "../../helpers/chat/virtualHistory";
import { CHAT_SEARCH_FILTERS } from "../../helpers/chat/chatSearch";

function dayKey(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  } catch {
    return "";
  }
}

const EMPTY_CHAT: ChatMessage[] = [];
const EMPTY_HITS: number[] = [];

function formatDayLabel(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    // Prefer RU locale, but keep it robust if runtime doesn't support it.
    const label = d.toLocaleDateString("ru-RU", sameYear ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "numeric" });
    return label || dayKey(ts) || "—";
  } catch {
    return dayKey(ts) || "—";
  }
}

function formatSelectionCount(count: number): string {
  const n = Math.max(0, Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word = "сообщений";
  if (mod10 === 1 && mod100 !== 11) word = "сообщение";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "сообщения";
  return `${n} ${word}`;
}

function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

function chatTitleNodes(state: AppState): Array<string | HTMLElement> {
  const sel = state.selected;
  if (!sel) return ["Чат"];
  if (sel.kind === "dm") {
    const p = state.profiles?.[sel.id];
    const dn = p?.display_name ? String(p.display_name).trim() : "";
    const h = p?.handle ? String(p.handle).trim() : "";
    const label = dn || (h ? (h.startsWith("@") ? h : `@${h}`) : sel.id);
    return [avatar("dm", sel.id), `Чат с: ${label}`];
  }
  if (sel.kind === "group") {
    const g = (state.groups || []).find((x) => x.id === sel.id);
    return [avatar("group", sel.id), `Чат: ${String(g?.name || sel.id)}`];
  }
  const b = (state.boards || []).find((x) => x.id === sel.id);
  return [avatar("board", sel.id), `Доска: ${String(b?.name || sel.id)}`];
}

function formatBytes(size: number): string {
  if (!size || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const precision = value >= 100 || idx === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[idx]}`;
}

function isImageFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("image/")) return true;
  const n = String(name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg|heic|heif)$/.test(n);
}

function isVideoFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("video/")) return true;
  const n = String(name || "").toLowerCase();
  return /\.(mp4|m4v|mov|webm|ogv|mkv|avi|3gp|3g2)$/.test(n);
}

function isAudioFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("audio/")) return true;
  const n = String(name || "").toLowerCase();
  return /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/.test(n);
}

function transferStatus(entry: FileTransferEntry): string {
  const pct = Math.max(0, Math.min(100, Math.round(entry.progress || 0)));
  if (entry.status === "uploading") return `Загрузка (${pct}%)`;
  if (entry.status === "downloading") return `Скачивание (${pct}%)`;
  if (entry.status === "uploaded") return "Файл загружен";
  if (entry.status === "complete") return "Готово";
  if (entry.status === "rejected") return "Отклонено";
  if (entry.status === "error") return `Ошибка: ${entry.error || "неизвестно"}`;
  return entry.direction === "out" ? "Ожидание подтверждения" : "Ожидание отправителя";
}

function statusLabel(m: ChatMessage): string {
  const status = m.status;
  if (!status) return "";
  const hasServerId = typeof m.id === "number" && Number.isFinite(m.id) && m.id > 0;
  if (status === "sending") return "…";
  if (status === "queued") return hasServerId ? "✓" : "…";
  if (status === "delivered") return "✓✓";
  if (status === "read") return "✓✓";
  if (status === "error") return "!";
  return "";
}

function statusTitle(m: ChatMessage): string {
  const status = m.status;
  if (!status) return "";
  const scheduleAt = typeof m.scheduleAt === "number" && Number.isFinite(m.scheduleAt) ? m.scheduleAt : 0;
  if (status === "queued" && scheduleAt > Date.now()) {
    try {
      const when = new Date(scheduleAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      return when ? `Запланировано на ${when}` : "Запланировано";
    } catch {
      return "Запланировано";
    }
  }
  const hasServerId = typeof m.id === "number" && Number.isFinite(m.id) && m.id > 0;
  if (status === "sending") return "Отправляется…";
  if (status === "queued") return m.whenOnline || hasServerId ? "В очереди (адресат оффлайн)" : "В очереди (нет соединения)";
  if (status === "delivered") return "Доставлено";
  if (status === "read") return "Прочитано";
  if (status === "error") return "Ошибка отправки";
  return "";
}

function formatUserLabel(displayName: string, handle: string, fallback: string): string {
  const dn = String(displayName || "").trim();
  if (dn) return dn;
  const h = String(handle || "").trim();
  if (h) return h.startsWith("@") ? h : `@${h}`;
  return fallback || "—";
}

function resolveUserLabel(state: AppState, id: string, friendLabels?: Map<string, string>): string {
  const pid = String(id || "").trim();
  if (!pid) return "—";
  const p = state.profiles?.[pid];
  if (p) return formatUserLabel(p.display_name || "", p.handle || "", pid);
  const fromFriends = friendLabels?.get(pid);
  return fromFriends || pid;
}

function normalizeHandle(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function refPreview(ref: ChatMessageRef): string {
  const rawText = String(ref?.text || "")
    .replace(/\s+/g, " ")
    .trim();
  const text = rawText && !rawText.startsWith("[file]") ? rawText : "";
  if (text) return text;
  const attachment = ref?.attachment;
  if (attachment?.kind === "file") {
    const name = String(attachment.name || "файл");
    const badge = fileBadge(name, attachment.mime);
    let kindLabel = "Файл";
    if (badge.kind === "image") kindLabel = "Фото";
    else if (badge.kind === "video") kindLabel = "Видео";
    else if (badge.kind === "audio") kindLabel = "Аудио";
    else if (badge.kind === "archive") kindLabel = "Архив";
    else if (badge.kind === "doc") kindLabel = "Документ";
    else if (badge.kind === "pdf") kindLabel = "PDF";
    return name ? `${kindLabel}: ${name}` : kindLabel;
  }
  if (attachment?.kind === "action") return "Действие";
  return "Сообщение";
}

function renderMessageRef(
  state: AppState,
  ref: ChatMessageRef | null | undefined,
  kind: "reply" | "forward",
  friendLabels?: Map<string, string>
): HTMLElement | null {
  if (!ref) return null;
  const fromId = String(ref.from || "").trim();
  const sender = fromId ? resolveUserLabel(state, fromId, friendLabels) : "";
  const isForward = kind === "forward";
  const isReply = kind === "reply";
  const titleBase = isForward ? "Переслано" : "Ответ";
  const viaBot = normalizeHandle(String(ref.via_bot || (ref as any).viaBot || ""));
  const postAuthor = String(ref.post_author || (ref as any).postAuthor || "").trim();
  const hiddenProfile = Boolean(ref.hidden_profile ?? (ref as any).hiddenProfile ?? false);
  const canShowSender = Boolean(sender) && !(isForward && hiddenProfile);
  const title = canShowSender ? (isForward ? `Переслано от ${sender}` : `Ответ: ${sender}`) : titleBase;
  const metaParts: string[] = [];
  if (hiddenProfile) metaParts.push("Скрытый профиль");
  if (viaBot) metaParts.push(`через ${viaBot}`);
  if (postAuthor) metaParts.push(`Автор: ${postAuthor}`);
  const meta = metaParts.join(" · ");
  const headerChildren: HTMLElement[] = [];
  if (isForward && fromId && !hiddenProfile) {
    const avatarNode = avatar("dm", fromId);
    avatarNode.classList.add("msg-ref-avatar");
    headerChildren.push(avatarNode);
  }
  const titleWrap = el("div", { class: "msg-ref-title-wrap" }, [el("div", { class: "msg-ref-title" }, [title])]);
  if (meta) titleWrap.appendChild(el("div", { class: "msg-ref-meta" }, [meta]));
  headerChildren.push(titleWrap);
  const header = el("div", { class: "msg-ref-header" }, headerChildren);
  const text = el("div", { class: "msg-ref-text" }, [refPreview(ref)]);
  let mediaNode: HTMLElement | null = null;
  if (ref.attachment?.kind === "file") {
    const name = String(ref.attachment.name || "файл");
    const badge = fileBadge(name, ref.attachment.mime);
    mediaNode = el(
      "div",
      { class: `msg-ref-media msg-ref-media-${badge.kind}`, style: `--msg-ref-media-hue: ${badge.hue};`, "aria-hidden": "true" },
      [badge.label]
    );
  }
  const hasMedia = Boolean(mediaNode);
  const cls = `msg-ref msg-ref-${kind}${isReply ? " msg-ref-quote" : ""}${hasMedia ? " msg-ref-with-media" : ""}`;
  if (hasMedia && mediaNode) {
    const body = el("div", { class: "msg-ref-body" }, [header, text]);
    return el("div", { class: cls }, [mediaNode, body]);
  }
  return el("div", { class: cls }, [header, text]);
}

function searchResultPreview(m: ChatMessage): string {
  const text = String(m.text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text) return text;
  const attachment = m.attachment;
  if (attachment?.kind === "file") {
    const name = String(attachment.name || "файл");
    const badge = fileBadge(name, attachment.mime);
    return `${badge.label}: ${name}`;
  }
  if (m.kind === "sys") return "Системное сообщение";
  return "Сообщение";
}

function trimSearchPreview(text: string, maxLen = 180): string {
  const t = String(text || "").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

type FileAttachmentInfo = {
  name: string;
  size: number;
  mime: string | null;
  fileId: string | null;
  url: string | null;
  transfer: FileTransferEntry | null;
  offer: FileOfferIn | null;
  statusLine: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  hasProgress: boolean;
};

type AlbumItem = {
  idx: number;
  msg: ChatMessage;
  info: FileAttachmentInfo;
};

function buildMessageMeta(m: ChatMessage): HTMLElement[] {
  const meta: HTMLElement[] = [el("span", { class: "msg-time" }, [formatTime(m.ts)])];
  if (m.edited) {
    const editedTs = typeof m.edited_ts === "number" && Number.isFinite(m.edited_ts) ? m.edited_ts : null;
    const time = editedTs !== null ? formatTime(editedTs) : "";
    meta.push(
      el(
        "span",
        { class: "msg-edited", "aria-label": "Изменено", ...(time ? { title: `Изменено: ${time}` } : {}) },
        [time ? `изменено ${time}` : "изменено"]
      )
    );
  }
  const status = m.kind === "out" ? statusLabel(m) : "";
  if (status) {
    meta.push(
      el("span", { class: `msg-status msg-status-${m.status || "delivered"}`, title: statusTitle(m) || undefined }, [status])
    );
  }
  return meta;
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function renderReactions(m: ChatMessage): HTMLElement | null {
  const raw = m.reactions;
  if (!raw || typeof raw !== "object") return null;
  const countsRaw = (raw as any).counts;
  if (!countsRaw || typeof countsRaw !== "object") return null;
  const entries: Array<{ emoji: string; count: number }> = [];
  for (const [emoji, cnt] of Object.entries(countsRaw as Record<string, unknown>)) {
    const e = String(emoji || "").trim();
    const n = typeof cnt === "number" && Number.isFinite(cnt) ? Math.trunc(cnt) : Math.trunc(Number(cnt) || 0);
    if (!e || n <= 0) continue;
    entries.push({ emoji: e, count: n });
  }
  if (!entries.length) return null;

  entries.sort((a, b) => {
    const ai = QUICK_REACTIONS.indexOf(a.emoji);
    const bi = QUICK_REACTIONS.indexOf(b.emoji);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    if (a.count !== b.count) return b.count - a.count;
    return a.emoji.localeCompare(b.emoji);
  });

  const mine = typeof (raw as any).mine === "string" ? String((raw as any).mine) : null;
  const nodes = entries.slice(0, 12).map(({ emoji, count }) => {
    const active = mine === emoji;
    const label = `${emoji} ${count}`;
    const btn = el(
      "button",
      {
        class: active ? "msg-react is-active" : "msg-react",
        type: "button",
        "data-action": "msg-react",
        "data-emoji": emoji,
        "aria-pressed": active ? "true" : "false",
        title: active ? `Убрать реакцию ${emoji}` : `Реакция ${emoji}`,
      },
      [el("span", { class: "msg-react-emoji", "aria-hidden": "true" }, [emoji]), el("span", { class: "msg-react-count" }, [String(count)])]
    ) as HTMLButtonElement;
    btn.setAttribute("aria-label", label);
    return btn;
  });
  return el("div", { class: "msg-reacts" }, nodes);
}

function getFileAttachmentInfo(state: AppState, m: ChatMessage, opts?: { mobileUi: boolean }): FileAttachmentInfo | null {
  const att = m.attachment;
  if (!att || att.kind !== "file") return null;
  const transfer =
    (att.localId ? state.fileTransfers.find((t) => t.localId === att.localId) : null) ||
    (att.fileId ? state.fileTransfers.find((t) => t.id === att.fileId) : null) ||
    null;
  const offer = !transfer && att.fileId ? state.fileOffersIn.find((o) => o.id === att.fileId) ?? null : null;
  const name = String(transfer?.name || offer?.name || att.name || "файл");
  const size = Number(transfer?.size ?? offer?.size ?? att.size ?? 0) || 0;
  const mime = att.mime || transfer?.mime || null;
  const base = typeof location !== "undefined" ? location.href : "http://localhost/";
  const url = transfer?.url ? safeUrl(transfer.url, { base, allowedProtocols: ["http:", "https:", "blob:"] }) : null;
  const mobileUi = opts?.mobileUi ?? false;
  const statusLine = transfer
    ? transferStatus(transfer)
    : offer
      ? mobileUi
        ? "Входящий файл (принять в «Файлы»)"
        : "Входящий файл (принять в «Файлы» / F7)"
      : "";
  const isImage = isImageFile(name, mime);
  const isVideo = isVideoFile(name, mime);
  const isAudio = isAudioFile(name, mime);
  const hasProgress = Boolean(transfer && (transfer.status === "uploading" || transfer.status === "downloading"));
  return {
    name,
    size,
    mime,
    fileId: att.fileId ? String(att.fileId) : null,
    url,
    transfer,
    offer,
    statusLine,
    isImage,
    isVideo,
    isAudio,
    hasProgress,
  };
}

function renderImagePreviewButton(info: FileAttachmentInfo, opts?: { className?: string; msgIdx?: number; caption?: string | null }): HTMLElement | null {
  if (!info.isImage) return null;
  if (!info.url && !info.fileId) return null;
  const classes = info.url ? ["chat-file-preview"] : ["chat-file-preview", "chat-file-preview-empty"];
  if (opts?.className) classes.push(opts.className);
  const attrs: Record<string, string | undefined> = {
    class: classes.join(" "),
    type: "button",
    "data-action": "open-file-viewer",
    "data-name": info.name,
    "data-size": String(info.size || 0),
    "aria-label": `Открыть: ${info.name}`,
  };
  if (info.url) attrs["data-url"] = info.url;
  if (!info.url && info.fileId) attrs["data-file-id"] = info.fileId;
  if (info.mime) attrs["data-mime"] = info.mime;
  if (opts?.msgIdx !== undefined) attrs["data-msg-idx"] = String(opts.msgIdx);
  if (opts?.caption) attrs["data-caption"] = opts.caption;

  const child = info.url
    ? el("img", { class: "chat-file-img", src: info.url, alt: info.name, loading: "lazy", decoding: "async" })
    : el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Фото"]);
  return el("button", attrs, [child]);
}

function renderVideoPreviewButton(info: FileAttachmentInfo, opts?: { className?: string; msgIdx?: number; caption?: string | null }): HTMLElement | null {
  if (!info.isVideo) return null;
  if (!info.url && !info.fileId) return null;
  const classes = info.url ? ["chat-file-preview", "chat-file-preview-video"] : ["chat-file-preview", "chat-file-preview-video", "chat-file-preview-empty"];
  if (opts?.className) classes.push(opts.className);
  const attrs: Record<string, string | undefined> = {
    class: classes.join(" "),
    type: "button",
    "data-action": "open-file-viewer",
    "data-name": info.name,
    "data-size": String(info.size || 0),
    "aria-label": `Открыть: ${info.name}`,
  };
  if (info.url) attrs["data-url"] = info.url;
  if (!info.url && info.fileId) attrs["data-file-id"] = info.fileId;
  if (info.mime) attrs["data-mime"] = info.mime;
  if (opts?.msgIdx !== undefined) attrs["data-msg-idx"] = String(opts.msgIdx);
  if (opts?.caption) attrs["data-caption"] = opts.caption;

  const child = info.url
    ? el("video", { class: "chat-file-video", src: info.url, preload: "metadata", playsinline: "true", muted: "true" })
    : el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Видео"]);
  return el("button", attrs, [child]);
}

function isAlbumCandidate(msg: ChatMessage, info: FileAttachmentInfo | null): info is FileAttachmentInfo {
  if (!info || !info.isImage) return false;
  if (msg.kind === "sys") return false;
  if (info.offer) return false;
  if (info.hasProgress) return false;
  const caption = String(msg.text || "").trim();
  if (caption && !caption.startsWith("[file]")) return false;
  if (!info.url && !info.fileId) return false;
  return true;
}

function skeletonLine(widthPct: number, cls = "skel-line"): HTMLElement {
  const w = Math.max(8, Math.min(100, Math.round(widthPct)));
  return el("div", { class: cls, style: `width: ${w}%;` }, [""]);
}

function skeletonMsg(kind: "in" | "out", seed: number): HTMLElement {
  const variants: Array<[number, number, number]> = [
    [76, 42, 22],
    [64, 30, 18],
    [82, 54, 26],
    [58, 36, 20],
    [70, 46, 24],
  ];
  const v = variants[Math.abs(seed) % variants.length] || variants[0];
  const body = el("div", { class: "msg-body" }, [
    skeletonLine(v[0], "skel-line"),
    skeletonLine(v[1], "skel-line"),
    skeletonLine(v[2], "skel-line skel-meta"),
  ]);
  const children: HTMLElement[] = [];
  if (kind === "in") {
    children.push(el("div", { class: "msg-avatar" }, [el("span", { class: "avatar avatar-skel", "aria-hidden": "true" }, [""])]));
  }
  children.push(body);
  return el("div", { class: `msg msg-${kind} msg-skel`, "aria-hidden": "true" }, children);
}

const EMOJI_SEGMENT_RE = /\p{Extended_Pictographic}/u;

function isEmojiOnlyText(text: string): boolean {
  const raw = String(text ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
    let hasEmoji = false;
    for (const part of seg.segment(trimmed)) {
      const chunk = part.segment;
      if (!chunk || !chunk.trim()) continue;
      if (EMOJI_SEGMENT_RE.test(chunk)) {
        hasEmoji = true;
        continue;
      }
      return false;
    }
    return hasEmoji;
  }
  let hasEmoji = false;
  for (const ch of Array.from(trimmed)) {
    if (!ch.trim()) continue;
    if (EMOJI_SEGMENT_RE.test(ch)) {
      hasEmoji = true;
      continue;
    }
    return false;
  }
  return hasEmoji;
}

function roomLabel(name: string | null | undefined, id: string, handle?: string | null): string {
  const base = name ? `${name} (${id})` : id;
  if (handle) {
    const h = handle.startsWith("@") ? handle : `@${handle}`;
    return `${base} ${h}`;
  }
  return base;
}

function renderMultilineText(text: string): HTMLElement {
  const cleaned = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned.split("\n");
  const nodes = lines.map((line) => el("div", { class: "invite-line" }, renderRichText(line)));
  return el("div", { class: "invite-text" }, nodes);
}

function messageLine(
  state: AppState,
  m: ChatMessage,
  friendLabels?: Map<string, string>,
  opts?: { mobileUi: boolean; boardUi?: boolean; msgIdx?: number }
): HTMLElement {
  const actionBtn = (
    label: string,
    attrs: Record<string, string>,
    cls: string,
    baseClass: string = "msg-action-btn"
  ): HTMLElement => el("button", { class: `btn ${baseClass} ${cls}`.trim(), type: "button", ...attrs }, [label]);

  function renderInviteCard(payload: any, text: string): HTMLElement | null {
    if (!payload || typeof payload !== "object") return null;
    const kind = String(payload.kind || "");
    if (kind !== "group_invite" && kind !== "board_invite") return null;
    const isGroup = kind === "group_invite";
    const roomId = String(payload.groupId || payload.group_id || payload.boardId || payload.board_id || "").trim();
    if (!roomId) return null;
    const name = String(payload.name || "").trim() || null;
    const handle = String(payload.handle || "").trim() || null;
    const from = String(payload.from || "").trim();
    const description = String(payload.description || "").trim();
    const rules = String(payload.rules || "").trim();
    const title = text || (isGroup ? "Приглашение в чат" : "Приглашение в доску");
    const label = roomLabel(name, roomId, handle);

    const metaLines: HTMLElement[] = [];
    metaLines.push(el("div", { class: "invite-meta-line" }, [isGroup ? `Чат: ${label}` : `Доска: ${label}`]));
    if (from) metaLines.push(el("div", { class: "invite-meta-line" }, [`От: ${from}`]));
    const meta = el("div", { class: "invite-meta" }, metaLines);

    const sections: HTMLElement[] = [];
    if (description) {
      sections.push(el("div", { class: "invite-section" }, [el("div", { class: "invite-section-title" }, ["Описание"]), renderMultilineText(description)]));
    }
    if (rules) {
      sections.push(el("div", { class: "invite-section" }, [el("div", { class: "invite-section-title" }, ["Правила"]), renderMultilineText(rules)]));
    }
    if (!sections.length) {
      sections.push(el("div", { class: "invite-empty" }, ["Описание и правила не указаны"]));
    }

    const baseAttrs: Record<string, string> = isGroup ? { "data-group-id": roomId } : { "data-board-id": roomId };
    if (from) baseAttrs["data-from"] = from;

    const actions = el("div", { class: "invite-actions" }, [
      actionBtn(
        "Вступить",
        { ...baseAttrs, "data-action": isGroup ? "group-invite-accept" : "board-invite-accept" },
        "btn-primary",
        "invite-action-btn"
      ),
      actionBtn(
        "Отклонить",
        { ...baseAttrs, "data-action": isGroup ? "group-invite-decline" : "board-invite-decline" },
        "",
        "invite-action-btn"
      ),
      actionBtn(
        "Спам",
        { ...baseAttrs, "data-action": isGroup ? "group-invite-block" : "board-invite-block" },
        "btn-danger",
        "invite-action-btn"
      ),
    ]);

    return el("div", { class: "invite-card" }, [el("div", { class: "invite-title" }, [title]), meta, ...sections, actions]);
  }

  function sysActions(payload: any): HTMLElement | null {
    if (!payload || typeof payload !== "object") return null;
    const kind = String(payload.kind || "");
    const buttons: HTMLElement[] = [];

    if (kind === "auth_in") {
      const peer = String(payload.peer || "").trim();
      if (peer) {
        buttons.push(actionBtn("Принять", { "data-action": "auth-accept", "data-peer": peer }, "btn-primary"));
        buttons.push(actionBtn("Отклонить", { "data-action": "auth-decline", "data-peer": peer }, "btn-danger"));
      }
    } else if (kind === "auth_out") {
      const peer = String(payload.peer || "").trim();
      if (peer) {
        buttons.push(actionBtn("Отменить", { "data-action": "auth-cancel", "data-peer": peer }, "btn-danger"));
      }
    } else if (kind === "group_invite") {
      const groupId = String(payload.groupId || payload.group_id || "").trim();
      if (groupId) {
        buttons.push(actionBtn("Принять", { "data-action": "group-invite-accept", "data-group-id": groupId }, "btn-primary"));
        buttons.push(actionBtn("Отклонить", { "data-action": "group-invite-decline", "data-group-id": groupId }, "btn-danger"));
      }
    } else if (kind === "group_join_request") {
      const groupId = String(payload.groupId || payload.group_id || "").trim();
      const peer = String(payload.from || payload.peer || "").trim();
      if (groupId && peer) {
        buttons.push(
          actionBtn("Принять", { "data-action": "group-join-accept", "data-group-id": groupId, "data-peer": peer }, "btn-primary")
        );
        buttons.push(
          actionBtn("Отклонить", { "data-action": "group-join-decline", "data-group-id": groupId, "data-peer": peer }, "btn-danger")
        );
      }
    } else if (kind === "board_invite") {
      const boardId = String(payload.boardId || payload.board_id || "").trim();
      if (boardId) {
        buttons.push(actionBtn("Принять", { "data-action": "board-invite-accept", "data-board-id": boardId }, "btn-primary"));
        buttons.push(actionBtn("Отклонить", { "data-action": "board-invite-decline", "data-board-id": boardId }, "btn-danger"));
      }
    }

    if (!buttons.length) return null;
    return el("div", { class: "msg-actions" }, buttons);
  }

  if (m.kind === "sys") {
    const bodyChildren: HTMLElement[] = [];
    if (m.attachment?.kind === "action") {
      const card = renderInviteCard(m.attachment.payload, m.text);
      if (card) {
        bodyChildren.push(card);
        return el("div", { class: "msg msg-sys" }, [el("div", { class: "msg-body" }, bodyChildren)]);
      }
    }
    const emojiOnlySys = isEmojiOnlyText(m.text || "");
    bodyChildren.push(el("div", { class: `msg-text${emojiOnlySys ? " msg-emoji-only" : ""}` }, renderRichText(m.text)));
    if (m.attachment?.kind === "action") {
      const actions = sysActions(m.attachment.payload);
      if (actions) bodyChildren.push(actions);
    }
    return el("div", { class: "msg msg-sys" }, [
      el("div", { class: "msg-body" }, bodyChildren),
    ]);
  }
  const fromId = String(m.from || "").trim();
  const isPlainView = state.messageView === "plain";
  const showFrom =
    m.kind === "in" &&
    (Boolean(m.room) || (state.selected?.kind === "group") || (state.selected?.kind === "board") || isPlainView);
  const fromLabel = resolveUserLabel(state, fromId, friendLabels);
  const canOpenProfile = Boolean(fromId);
  const meta = buildMessageMeta(m);
  const bodyChildren: HTMLElement[] = [];
  if (showFrom) {
    const attrs = canOpenProfile
      ? {
          class: "msg-from msg-from-btn",
          type: "button",
          "data-action": "user-open",
          "data-user-id": fromId,
          title: `Профиль: ${fromLabel}`,
        }
      : { class: "msg-from" };
    const node = canOpenProfile ? el("button", attrs, [fromLabel]) : el("div", attrs, [fromLabel]);
    bodyChildren.push(node);
  } else if (isPlainView && m.kind === "out") {
    bodyChildren.push(el("div", { class: "msg-from msg-from-self" }, ["Я"]));
  }
  const ref = m.reply || m.forward;
  if (ref) {
    const kind = m.reply ? "reply" : "forward";
    const refNode = renderMessageRef(state, ref, kind, friendLabels);
    if (refNode) bodyChildren.push(refNode);
  }
  const info = getFileAttachmentInfo(state, m, opts);
  if (info) {
    const name = info.name;
    const size = info.size;
    const mime = info.mime;
    const url = info.url;
    const transfer = info.transfer;
    const offer = info.offer;
    const statusLine = info.statusLine;

    const metaEls: HTMLElement[] = [];
    metaEls.push(el("div", { class: "file-meta" }, [`Размер: ${formatBytes(size)}`]));
    if (statusLine) metaEls.push(el("div", { class: "file-meta" }, [statusLine]));
    if (transfer?.acceptedBy?.length) metaEls.push(el("div", { class: "file-meta" }, [`Приняли: ${transfer.acceptedBy.join(", ")}`]));
    if (transfer?.receivedBy?.length) metaEls.push(el("div", { class: "file-meta" }, [`Получили: ${transfer.receivedBy.join(", ")}`]));

    const badge = fileBadge(name, mime);
    const icon = el("span", { class: `file-icon file-icon-${badge.kind}`, "aria-hidden": "true" }, [badge.label]);
    icon.style.setProperty("--file-h", String(badge.hue));
    const mainChildren: HTMLElement[] = [el("div", { class: "file-title" }, [icon, el("div", { class: "file-name" }, [name])]), ...metaEls];
    if (transfer && (transfer.status === "uploading" || transfer.status === "downloading")) {
      const bar = el("div", { class: "file-progress-bar" });
      bar.style.width = `${Math.max(0, Math.min(100, Math.round(transfer.progress || 0)))}%`;
      mainChildren.push(el("div", { class: "file-progress" }, [bar]));
    }

    const isImage = info.isImage;
    const isVideo = info.isVideo;
    const isAudio = info.isAudio;

    if (isAudio && url) {
      mainChildren.splice(1, 0, el("audio", { class: "chat-file-audio", src: url, controls: "true", preload: "metadata" }) as HTMLAudioElement);
    }

    const actions: HTMLElement[] = [];
    if (offer?.id) {
      actions.push(
        el(
          "button",
          { class: "btn btn-primary file-action file-action-accept", type: "button", "data-action": "file-accept", "data-file-id": offer.id, "aria-label": `Принять: ${name}` },
          ["Принять"]
        )
      );
    } else if (info.fileId) {
      actions.push(
        el(
          "button",
          { class: "btn file-action file-action-download", type: "button", "data-action": "file-download", "data-file-id": info.fileId, "aria-label": `Скачать: ${name}` },
          ["Скачать"]
        )
      );
    } else if (url) {
      actions.push(
        el("a", { class: "btn file-action file-action-download", href: url, download: name, title: `Скачать: ${name}`, "aria-label": `Скачать: ${name}` }, [
          "Скачать",
        ])
      );
    }

    const rowChildren: HTMLElement[] = [
      el("div", { class: "file-main" }, mainChildren),
      el("div", { class: "file-actions" }, actions),
    ];

    const caption = String(m.text || "").trim();
    const viewerCaption = caption && !caption.startsWith("[file]") ? caption : "";
    const isVisualMedia = isImage || isVideo;
    if (isVisualMedia) {
      const previewOpts = { caption: viewerCaption, msgIdx: opts?.msgIdx };
      const preview = isImage ? renderImagePreviewButton(info, previewOpts) : renderVideoPreviewButton(info, previewOpts);
      if (preview) rowChildren.unshift(preview);
    }

    const hasProgress = info.hasProgress;
    const fileRowClass = isVisualMedia
      ? `file-row file-row-chat file-row-image${isVideo ? " file-row-video" : ""}${hasProgress ? " file-row-progress" : ""}`
      : isAudio
        ? "file-row file-row-chat file-row-audio"
        : "file-row file-row-chat";
    bodyChildren.push(el("div", { class: fileRowClass }, rowChildren));
    if (viewerCaption) {
      const emojiOnlyCaption = isEmojiOnlyText(viewerCaption);
      const boardUi = Boolean(opts?.boardUi && state.selected?.kind === "board");
      if (boardUi && !emojiOnlyCaption) {
        bodyChildren.push(el("div", { class: "msg-text msg-caption msg-text-board" }, [renderBoardPost(viewerCaption)]));
      } else {
        bodyChildren.push(el("div", { class: `msg-text msg-caption${emojiOnlyCaption ? " msg-emoji-only" : ""}` }, renderRichText(viewerCaption)));
      }
    }
  } else {
    const emojiOnly = isEmojiOnlyText(m.text || "");
    const boardUi = Boolean(opts?.boardUi && state.selected?.kind === "board");
    if (boardUi && !emojiOnly) {
      bodyChildren.push(el("div", { class: "msg-text msg-text-board" }, [renderBoardPost(m.text)]));
    } else {
      bodyChildren.push(el("div", { class: `msg-text${emojiOnly ? " msg-emoji-only" : ""}` }, renderRichText(m.text)));
    }
  }
  bodyChildren.push(el("div", { class: "msg-meta" }, meta));
  const reacts = renderReactions(m);
  if (reacts) bodyChildren.push(reacts);
  const lineChildren: HTMLElement[] = [];
  if (m.kind === "in" && fromId) {
    const avatarNode = avatar("dm", fromId);
    if (canOpenProfile) {
      lineChildren.push(
        el("div", { class: "msg-avatar" }, [
          el(
            "button",
            { class: "msg-avatar-btn", type: "button", "data-action": "user-open", "data-user-id": fromId, title: `Профиль: ${fromLabel}` },
            [avatarNode]
          ),
        ])
      );
    } else {
      lineChildren.push(el("div", { class: "msg-avatar" }, [avatarNode]));
    }
  }
  lineChildren.push(el("div", { class: "msg-body" }, bodyChildren));
  const cls = m.attachment ? `msg msg-${m.kind} msg-attach` : `msg msg-${m.kind}`;
  return el("div", { class: cls }, lineChildren);
}

function renderAlbumLine(state: AppState, items: AlbumItem[], friendLabels?: Map<string, string>): HTMLElement {
  const first = items[0];
  const last = items[items.length - 1];
  const fromId = String(first.msg.from || "").trim();
  const isPlainView = state.messageView === "plain";
  const showFrom =
    first.msg.kind === "in" &&
    (Boolean(first.msg.room) || (state.selected?.kind === "group") || (state.selected?.kind === "board") || isPlainView);
  const fromLabel = resolveUserLabel(state, fromId, friendLabels);
  const canOpenProfile = Boolean(fromId);
  const bodyChildren: HTMLElement[] = [];
  if (showFrom) {
    const attrs = canOpenProfile
      ? {
          class: "msg-from msg-from-btn",
          type: "button",
          "data-action": "user-open",
          "data-user-id": fromId,
          title: `Профиль: ${fromLabel}`,
        }
      : { class: "msg-from" };
    const node = canOpenProfile ? el("button", attrs, [fromLabel]) : el("div", attrs, [fromLabel]);
    bodyChildren.push(node);
  } else if (isPlainView && first.msg.kind === "out") {
    bodyChildren.push(el("div", { class: "msg-from msg-from-self" }, ["Я"]));
  }
  const ref = first.msg.reply || first.msg.forward;
  if (ref) {
    const kind = first.msg.reply ? "reply" : "forward";
    const refNode = renderMessageRef(state, ref, kind, friendLabels);
    if (refNode) bodyChildren.push(refNode);
  }

  const gridItems: HTMLElement[] = [];
  for (const item of items) {
    const caption = String(item.msg.text || "").trim();
    const viewerCaption = caption && !caption.startsWith("[file]") ? caption : "";
    const preview = renderImagePreviewButton(item.info, { className: "chat-file-preview-album", msgIdx: item.idx, caption: viewerCaption });
    if (!preview) continue;
    const wrap = el("div", { class: "chat-album-item", "data-msg-idx": String(item.idx) }, [preview]);
    gridItems.push(wrap);
  }
  bodyChildren.push(el("div", { class: "chat-album-grid", "data-count": String(items.length) }, gridItems));
  bodyChildren.push(el("div", { class: "msg-meta" }, buildMessageMeta(last.msg)));
  const reacts = renderReactions(last.msg);
  if (reacts) bodyChildren.push(reacts);

  const lineChildren: HTMLElement[] = [];
  if (first.msg.kind === "in" && fromId) {
    const avatarNode = avatar("dm", fromId);
    if (canOpenProfile) {
      lineChildren.push(
        el("div", { class: "msg-avatar" }, [
          el(
            "button",
            { class: "msg-avatar-btn", type: "button", "data-action": "user-open", "data-user-id": fromId, title: `Профиль: ${fromLabel}` },
            [avatarNode]
          ),
        ])
      );
    } else {
      lineChildren.push(el("div", { class: "msg-avatar" }, [avatarNode]));
    }
  }
  lineChildren.push(el("div", { class: "msg-body" }, bodyChildren));
  return el("div", { class: `msg msg-${first.msg.kind} msg-attach msg-album` }, lineChildren);
}

export function renderChat(layout: Layout, state: AppState) {
  const mobileUi = isMobileLikeUi();
  const boardUi = Boolean(state.selected && state.selected.kind === "board");
  const scrollHost = layout.chatHost;
  const hostState = scrollHost as any;
  const key = state.selected ? conversationKey(state.selected) : "";
  const selectionState = state.chatSelection && state.chatSelection.key === key ? state.chatSelection : null;
  const selectionSet =
    selectionState && Array.isArray(selectionState.ids) && selectionState.ids.length ? new Set(selectionState.ids) : null;
  const selectionCount = selectionSet ? selectionSet.size : 0;
  const maxScrollTop = () => Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
  layout.chat.classList.toggle("chat-board", Boolean(state.selected && state.selected.kind === "board"));
  const prevKey = String(scrollHost.getAttribute("data-chat-key") || "");
  const keyChanged = key !== prevKey;
  const prevScrollTop = scrollHost.scrollTop;
  const atBottomBefore = scrollHost.scrollTop >= maxScrollTop() - 24;
  const sticky = hostState.__stickBottom;
  const stickyActive = Boolean(sticky && sticky.active && sticky.key === key);
  // NOTE: autoscroll-on-open/sent is handled in app/mountApp.ts (pendingChatAutoScroll).
  // Here we only keep pinned-bottom stable during re-renders/content growth for the *current* chat.
  const shouldStick = Boolean(key && !keyChanged && (stickyActive || atBottomBefore));
  if (keyChanged && hostState.__stickBottom) hostState.__stickBottom = null;
  else if (key) {
    if (shouldStick) hostState.__stickBottom = { key, active: true, at: Date.now() };
    else if (hostState.__stickBottom && hostState.__stickBottom.key === key) hostState.__stickBottom.active = false;
  }
  scrollHost.setAttribute("data-chat-key", key);
  if (!key && hostState.__chatLinesObserver && typeof hostState.__chatLinesObserver.disconnect === "function") {
    try {
      hostState.__chatLinesObserver.disconnect();
      hostState.__chatLinesObserved = null;
    } catch {
      // ignore
    }
  }

  // No selected chat: keep the main area empty (mobile starts from the sidebar tabs).
  if (!key) {
    layout.chatTop.replaceChildren();
    scrollHost.replaceChildren();
    layout.chatJump.classList.add("hidden");
    layout.chatSearchResults.classList.add("hidden");
    layout.chatSearchResults.replaceChildren();
    layout.chatSearchFooter.classList.add("hidden");
    layout.chatSearchFooter.replaceChildren();
    layout.chatSelectionBar.classList.add("hidden");
    layout.chatSelectionBar.replaceChildren();
    return;
  }

  const friendLabels = new Map<string, string>();
  for (const f of state.friends || []) {
    friendLabels.set(String(f.id), formatUserLabel(f.display_name || "", f.handle || "", String(f.id || "")));
  }

  const msgs = key ? (state.conversations[key] ?? EMPTY_CHAT) : EMPTY_CHAT;
  const hasMore = Boolean(key && state.historyHasMore && state.historyHasMore[key]);
  const loadingMore = Boolean(key && state.historyLoading && state.historyLoading[key]);
  const searchActive = Boolean(state.chatSearchOpen && state.chatSearchQuery.trim());
  const hits = searchActive ? state.chatSearchHits || EMPTY_HITS : EMPTY_HITS;
  const hitSet = searchActive && hits.length ? new Set(hits) : null;
  const activePos = searchActive ? Math.max(0, Math.min(hits.length ? hits.length - 1 : 0, state.chatSearchPos | 0)) : 0;
  const activeMsgIdx = searchActive && hits.length ? hits[activePos] : null;
  const searchResultsOpen = Boolean(searchActive && state.chatSearchResultsOpen);
  const prevRender = hostState.__chatRenderState as
    | {
        key: string;
        selectedKind: string;
        selectedId: string;
        page: string;
        msgsRef: ChatMessage[];
        historyLoaded: boolean;
        historyLoading: boolean;
        historyHasMore: boolean;
        historyVirtualStart: number | null;
        searchOpen: boolean;
        searchQuery: string;
        searchResultsOpen: boolean;
        searchPos: number;
        searchHitsRef: number[] | null;
        selectionRef: AppState["chatSelection"] | null;
        pinnedIdsRef: number[] | null;
        pinnedActive: number | null;
        lastRead: { id?: number; ts?: number } | null;
        profilesRef: AppState["profiles"];
        groupsRef: AppState["groups"];
        boardsRef: AppState["boards"];
        rightPanelRef: AppState["rightPanel"];
        messageView: AppState["messageView"];
        searchFilter: AppState["chatSearchFilter"];
        searchDate: AppState["chatSearchDate"];
      }
    | null;
  const pinnedIds = key && state.pinnedMessages ? state.pinnedMessages[key] : null;
  const activeRaw = key && state.pinnedMessageActive ? state.pinnedMessageActive[key] : null;
  const selectedKind = state.selected?.kind ? String(state.selected.kind) : "";
  const selectedId = state.selected?.id ? String(state.selected.id) : "";
  const historyVirtualStart = key && state.historyVirtualStart ? state.historyVirtualStart[key] ?? null : null;
  const lastRead = key && state.lastRead ? state.lastRead[key] ?? null : null;
  const selectionRef = selectionState;
  const renderState = {
    key,
    selectedKind,
    selectedId,
    page: state.page,
    msgsRef: msgs,
    historyLoaded: Boolean(key && state.historyLoaded && state.historyLoaded[key]),
    historyLoading: loadingMore,
    historyHasMore: hasMore,
    historyVirtualStart,
    searchOpen: Boolean(state.chatSearchOpen),
    searchQuery: String(state.chatSearchQuery || ""),
    searchResultsOpen,
    searchPos: state.chatSearchPos | 0,
    searchHitsRef: hits,
    selectionRef,
    pinnedIdsRef: pinnedIds,
    pinnedActive: typeof activeRaw === "number" ? activeRaw : null,
    lastRead,
    profilesRef: state.profiles,
    groupsRef: state.groups,
    boardsRef: state.boards,
    rightPanelRef: state.rightPanel,
    messageView: state.messageView,
    searchFilter: state.chatSearchFilter,
    searchDate: state.chatSearchDate,
  };
  const canSkipRender =
    prevRender &&
    prevRender.key === renderState.key &&
    prevRender.selectedKind === renderState.selectedKind &&
    prevRender.selectedId === renderState.selectedId &&
    prevRender.page === renderState.page &&
    prevRender.msgsRef === renderState.msgsRef &&
    prevRender.historyLoaded === renderState.historyLoaded &&
    prevRender.historyLoading === renderState.historyLoading &&
    prevRender.historyHasMore === renderState.historyHasMore &&
    prevRender.historyVirtualStart === renderState.historyVirtualStart &&
    prevRender.searchOpen === renderState.searchOpen &&
    prevRender.searchQuery === renderState.searchQuery &&
    prevRender.searchResultsOpen === renderState.searchResultsOpen &&
    prevRender.searchPos === renderState.searchPos &&
    prevRender.searchHitsRef === renderState.searchHitsRef &&
    prevRender.selectionRef === renderState.selectionRef &&
    prevRender.pinnedIdsRef === renderState.pinnedIdsRef &&
    prevRender.pinnedActive === renderState.pinnedActive &&
    prevRender.lastRead === renderState.lastRead &&
    prevRender.profilesRef === renderState.profilesRef &&
    prevRender.groupsRef === renderState.groupsRef &&
    prevRender.boardsRef === renderState.boardsRef &&
    prevRender.rightPanelRef === renderState.rightPanelRef &&
    prevRender.messageView === renderState.messageView &&
    prevRender.searchFilter === renderState.searchFilter &&
    prevRender.searchDate === renderState.searchDate;
  if (canSkipRender) return;
  hostState.__chatRenderState = renderState;
  const virtualEnabled = Boolean(key && shouldVirtualize(msgs.length, searchActive));
  const virtualAvgMap: Map<string, number> = hostState.__chatVirtualAvgHeights || new Map();
  hostState.__chatVirtualAvgHeights = virtualAvgMap;
  const avgHeight = clampVirtualAvg(key ? virtualAvgMap.get(key) : null);
  const maxVirtualStart = getVirtualMaxStart(msgs.length);
  const preferredStart = virtualEnabled && shouldStick ? maxVirtualStart : state.historyVirtualStart?.[key];
  const virtualStart = virtualEnabled ? getVirtualStart(msgs.length, preferredStart) : 0;
  const virtualEnd = virtualEnabled ? getVirtualEnd(msgs.length, virtualStart) : msgs.length;
  const topSpacerHeight = virtualEnabled ? Math.max(0, virtualStart) * avgHeight : 0;
  const bottomSpacerHeight = virtualEnabled ? Math.max(0, msgs.length - virtualEnd) * avgHeight : 0;
  const lineItems: HTMLElement[] = [];
  const lines: HTMLElement[] = [];
  let prevDay = "";
  let prevMsg: ChatMessage | null = null;
  let unreadIdx = -1;
  if (state.selected?.kind === "dm" && !searchActive) {
    const unread = (state.friends || []).find((f) => f.id === state.selected?.id)?.unread ?? 0;
    if (unread > 0 && msgs.length > 0) {
      unreadIdx = Math.max(0, Math.min(msgs.length - 1, msgs.length - unread));
    }
  } else if (!searchActive && key) {
    const marker = state.lastRead?.[key];
    const lastReadId = Number(marker?.id ?? 0);
    const lastReadAt = Number(marker?.ts ?? 0);
    if (lastReadId > 0 && msgs.length > 0) {
      const idx = msgs.findIndex((m) => Number(m?.id ?? 0) > lastReadId);
      if (idx >= 0) unreadIdx = idx;
    } else if (lastReadAt > 0 && msgs.length > 0) {
      const idx = msgs.findIndex((m) => Number(m?.ts ?? 0) > lastReadAt);
      if (idx >= 0) unreadIdx = idx;
    }
  }
  if (virtualEnabled && virtualStart > 0) {
    const prev = msgs[virtualStart - 1];
    if (prev) {
      prevDay = dayKey(prev.ts);
      prevMsg = prev.kind === "sys" ? null : prev;
    }
  }
  const isGroupTail = (idx: number, msg: ChatMessage) => {
    const nextIdx = idx + 1;
    if (nextIdx >= msgs.length) return true;
    if (nextIdx === unreadIdx) return true;
    const nextMsg = msgs[nextIdx];
    if (!nextMsg || nextMsg.kind === "sys") return true;
    const curDay = dayKey(msg.ts);
    const nextDay = dayKey(nextMsg.ts);
    if (curDay && nextDay && curDay !== nextDay) return true;
    return !isMessageContinuation(msg, nextMsg);
  };
  const albumMin = 3;
  const albumMax = 12;
  const albumGapSeconds = 3 * 60;
  for (let msgIdx = virtualStart; msgIdx < virtualEnd; msgIdx += 1) {
    const m = msgs[msgIdx];
    const dk = dayKey(m.ts);
    if (dk && dk !== prevDay) {
      prevDay = dk;
      lineItems.push(
        el("div", { class: "msg-sep msg-date", "aria-hidden": "true" }, [el("span", { class: "msg-sep-text" }, [formatDayLabel(m.ts)])])
      );
      prevMsg = null;
    }
    if (msgIdx === unreadIdx) {
      lineItems.push(
        el("div", { class: "msg-sep msg-unread", role: "separator", "aria-label": "Непрочитанные" }, [
          el("span", { class: "msg-sep-text" }, ["Непрочитанные"]),
        ])
      );
      prevMsg = null;
    }

    const info = getFileAttachmentInfo(state, m, { mobileUi });
    if (isAlbumCandidate(m, info)) {
      const group: AlbumItem[] = [{ idx: msgIdx, msg: m, info }];
      let scan = msgIdx + 1;
      while (scan < virtualEnd) {
        const next = msgs[scan];
        if (dk && dayKey(next.ts) !== dk) break;
        const nextInfo = getFileAttachmentInfo(state, next, { mobileUi });
        if (!isAlbumCandidate(next, nextInfo)) break;
        if (!isMessageContinuation(group[group.length - 1].msg, next, { maxGapSeconds: albumGapSeconds })) break;
        group.push({ idx: scan, msg: next, info: nextInfo });
        scan += 1;
        if (group.length >= albumMax) break;
      }
      if (group.length >= albumMin) {
        const line = renderAlbumLine(state, group, friendLabels);
        if (m.kind !== "sys" && isMessageContinuation(prevMsg, m)) line.classList.add("msg-cont");
        const lastItem = group[group.length - 1];
        if (lastItem?.msg?.kind !== "sys" && isGroupTail(lastItem.idx, lastItem.msg)) line.classList.add("msg-tail");
        const hit = hitSet ? group.some((item) => hitSet.has(item.idx)) : false;
        const active = activeMsgIdx !== null && group.some((item) => item.idx === activeMsgIdx);
        if (selectionSet) {
          const selected = group.some((item) => {
            const selKey = messageSelectionKey(item.msg);
            return selKey ? selectionSet.has(selKey) : false;
          });
          if (selected) line.classList.add("msg-selected");
        }
        line.setAttribute("data-msg-idx", String(group[group.length - 1].idx));
        const groupMsgId = Number(group[group.length - 1].msg.id ?? NaN);
        if (Number.isFinite(groupMsgId)) line.setAttribute("data-msg-id", String(groupMsgId));
        const groupMsgKey = messageSelectionKey(group[group.length - 1].msg);
        if (groupMsgKey) line.setAttribute("data-msg-key", groupMsgKey);
        if (hit) line.classList.add("msg-hit");
        if (active) line.classList.add("msg-hit-active");
        lineItems.push(line);
        prevMsg = group[group.length - 1].msg.kind === "sys" ? null : group[group.length - 1].msg;
        msgIdx = group[group.length - 1].idx;
        continue;
      }
    }

    const line = messageLine(state, m, friendLabels, { mobileUi, boardUi, msgIdx });
    if (m.kind !== "sys" && isMessageContinuation(prevMsg, m)) line.classList.add("msg-cont");
    if (m.kind !== "sys" && isGroupTail(msgIdx, m)) line.classList.add("msg-tail");
    line.setAttribute("data-msg-idx", String(msgIdx));
    const msgId = Number(m.id ?? NaN);
    if (Number.isFinite(msgId)) line.setAttribute("data-msg-id", String(msgId));
    const msgKey = messageSelectionKey(m);
    if (msgKey) line.setAttribute("data-msg-key", msgKey);
    if (selectionSet) {
      const selKey = messageSelectionKey(m);
      if (selKey && selectionSet.has(selKey)) line.classList.add("msg-selected");
    }
    if (hitSet?.has(msgIdx)) line.classList.add("msg-hit");
    if (activeMsgIdx === msgIdx) line.classList.add("msg-hit-active");
    lineItems.push(line);
    prevMsg = m.kind === "sys" ? null : m;
  }

  if (key && loadingMore) {
    const btn = el(
      "button",
      {
        class: "btn chat-history-more btn-loading",
        type: "button",
        disabled: "true",
        "aria-live": "polite",
      },
      ["Загрузка…"]
    );
    lineItems.unshift(el("div", { class: "chat-history-more-wrap" }, [btn]));
  }

  if (!lineItems.length) {
    const loaded = key ? Boolean(state.historyLoaded[key]) : true;
    if (!loaded) {
      for (let i = 0; i < 7; i += 1) {
        lines.push(skeletonMsg(i % 2 === 0 ? "in" : "out", i));
      }
    } else {
      lines.push(el("div", { class: "chat-empty" }, [el("div", { class: "chat-empty-title" }, ["Пока нет сообщений"])]));
    }
  } else {
    if (virtualEnabled && topSpacerHeight > 0) {
      const spacer = el("div", { class: "chat-virtual-spacer", "data-virtual-spacer": "top", "aria-hidden": "true" });
      spacer.style.height = `${topSpacerHeight}px`;
      lines.push(spacer);
    }
    lines.push(...lineItems);
    if (virtualEnabled && bottomSpacerHeight > 0) {
      const spacer = el("div", { class: "chat-virtual-spacer", "data-virtual-spacer": "bottom", "aria-hidden": "true" });
      spacer.style.height = `${bottomSpacerHeight}px`;
      lines.push(spacer);
    }
  }
  const titleChildren: Array<string | HTMLElement> = [...chatTitleNodes(state)];
  const chatSearchEnabled = !mobileUi;
  const showChatSearchToggle = false;
  if (state.selected) {
    const infoActive = Boolean(
      state.page === "main" &&
        state.rightPanel &&
        state.rightPanel.kind === state.selected.kind &&
        state.rightPanel.id === state.selected.id
    );
    titleChildren.push(el("span", { class: "chat-title-spacer", "aria-hidden": "true" }, [""]));
    titleChildren.push(
      el(
        "button",
        {
          class: infoActive ? "btn chat-info-btn btn-active" : "btn chat-info-btn",
          type: "button",
          "data-action": "chat-profile-open",
          title: infoActive ? "Закрыть профиль чата" : "Профиль чата",
          "aria-label": infoActive ? "Закрыть профиль чата" : "Профиль чата",
          "aria-pressed": infoActive ? "true" : "false",
        },
        ["ℹ︎"]
      )
    );
    if (chatSearchEnabled && showChatSearchToggle) {
      titleChildren.push(
        el(
          "button",
          {
            class: state.chatSearchOpen ? "btn chat-search-toggle btn-active" : "btn chat-search-toggle",
            type: "button",
            "data-action": state.chatSearchOpen ? "chat-search-close" : "chat-search-open",
            title: "Поиск в чате (Ctrl+F)",
            "aria-label": "Поиск в чате",
          },
          [state.chatSearchOpen ? "Закрыть поиск" : "Поиск"]
        )
      );
    }
  }

  let searchBar: HTMLElement | null = null;
  if (state.selected && state.chatSearchOpen && chatSearchEnabled) {
    const input = el("input", {
      class: "modal-input chat-search-input",
      id: "chat-search-input",
      type: "search",
      placeholder: "Найти в чате…",
      "data-ios-assistant": "off",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      inputmode: "text",
      enterkeyhint: "search",
    }) as HTMLInputElement;
    input.value = state.chatSearchQuery || "";
    const row = el("div", { class: "chat-search-row" }, [input]);
    const filters: HTMLElement[] = [];
    const counts = state.chatSearchCounts || { all: 0, media: 0, files: 0, links: 0, audio: 0 };
    const hasQuery = Boolean((state.chatSearchQuery || "").trim());
    if (hasQuery) {
      for (const item of CHAT_SEARCH_FILTERS) {
        const count = item.id === "all" ? counts.all : counts[item.id] || 0;
        const active = item.id === state.chatSearchFilter;
        const disabled = item.id !== "all" && count === 0;
        const btn = el(
          "button",
          {
            class: `chat-search-filter${active ? " is-active" : ""}`,
            type: "button",
            role: "tab",
            "aria-selected": active ? "true" : "false",
            "data-action": "chat-search-filter",
            "data-filter": item.id,
            ...(disabled ? { disabled: "true" } : {}),
          },
          [item.label, el("span", { class: "chat-search-filter-count" }, [String(count)])]
        );
        filters.push(btn);
      }
    }
    const filterRow = filters.length ? el("div", { class: "chat-search-filters", role: "tablist" }, filters) : null;
    searchBar = el("div", { class: "chat-search" }, [row, ...(filterRow ? [filterRow] : [])]);
  }

  let searchFooter: HTMLElement | null = null;
  if (state.selected && state.chatSearchOpen) {
    const total = hits.length;
    const hasQuery = Boolean((state.chatSearchQuery || "").trim());
    const countLabel = total ? `${Math.min(activePos + 1, total)}/${total}` : hasQuery ? "0/0" : "";
    const count = el(
      "span",
      { class: `chat-search-count${hasQuery ? "" : " is-empty"}`, "aria-live": "polite" },
      [countLabel || ""]
    );
    const dateInput = el("input", {
      class: "modal-input chat-search-date",
      id: "chat-search-date",
      type: "date",
      "aria-label": "Перейти к дате",
    }) as HTMLInputElement;
    dateInput.value = state.chatSearchDate || "";
    const dateClear = el(
      "button",
      {
        class: "btn chat-search-date-clear",
        type: "button",
        title: "Сбросить дату",
        "data-action": "chat-search-date-clear",
        ...(dateInput.value ? {} : { disabled: "true" }),
      },
      ["×"]
    );
    const btnPrev = el(
      "button",
      {
        class: "btn chat-search-nav",
        type: "button",
        "data-action": "chat-search-prev",
        "aria-label": "Предыдущий результат",
        ...(total ? {} : { disabled: "true" }),
      },
      ["↑"]
    );
    const btnNext = el(
      "button",
      {
        class: "btn chat-search-nav",
        type: "button",
        "data-action": "chat-search-next",
        "aria-label": "Следующий результат",
        ...(total ? {} : { disabled: "true" }),
      },
      ["↓"]
    );
    const controls = el("div", { class: "chat-search-controls" }, [btnPrev, btnNext]);
    const footerClass = `chat-search-footer-row${searchResultsOpen ? " is-open" : ""}`;
    searchFooter = el(
      "div",
      { class: footerClass, "data-action": "chat-search-results-toggle", "aria-expanded": searchResultsOpen ? "true" : "false" },
      [count, dateInput, dateClear, controls]
    );
  }

  if (searchResultsOpen) {
    const maxResults = 200;
    const totalHits = hits.length;
    let windowStart = 0;
    let windowHits = hits;
    if (totalHits > maxResults) {
      const half = Math.floor(maxResults / 2);
      const clampStart = Math.max(0, Math.min(totalHits - maxResults, activePos - half));
      windowStart = clampStart;
      windowHits = hits.slice(windowStart, windowStart + maxResults);
    }
    const rows: HTMLElement[] = [];
    const showFrom = Boolean(state.selected && state.selected.kind !== "dm");
    for (let i = 0; i < windowHits.length; i += 1) {
      const msgIdx = windowHits[i];
      const m = msgs[msgIdx];
      if (!m) continue;
      const hitPos = windowStart + i;
      const preview = trimSearchPreview(searchResultPreview(m));
      const textEl = el("div", { class: "chat-search-result-text" }, [preview]);
      const metaItems: HTMLElement[] = [];
      if (showFrom && m.kind !== "sys") {
        metaItems.push(el("span", { class: "chat-search-result-from" }, [resolveUserLabel(state, m.from, friendLabels)]));
      }
      const time = typeof m.ts === "number" && Number.isFinite(m.ts) ? formatTime(m.ts) : "";
      if (time) {
        metaItems.push(el("span", { class: "chat-search-result-time" }, [time]));
      }
      const body = el("div", { class: "chat-search-result-body" }, [textEl, ...(metaItems.length ? [el("div", { class: "chat-search-result-meta" }, metaItems)] : [])]);
      const active = hitPos === activePos;
      rows.push(
        el(
          "button",
          {
            class: `chat-search-result${active ? " is-active" : ""}`,
            type: "button",
            "data-action": "chat-search-result",
            "data-msg-idx": String(msgIdx),
            "data-hit-pos": String(hitPos),
            ...(active ? { "aria-current": "true" } : {}),
          },
          [body]
        )
      );
    }
    if (!rows.length) {
      rows.push(el("div", { class: "chat-search-results-empty" }, ["Ничего не найдено"]));
    }
    const list = el("div", { class: "chat-search-results-list", role: "list" }, rows);
    const header =
      totalHits > maxResults
        ? el("div", { class: "chat-search-results-hint" }, [
            `Показаны ${windowStart + 1}–${windowStart + windowHits.length} из ${totalHits}`,
          ])
        : null;
    layout.chatSearchResults.classList.remove("hidden");
    layout.chatSearchResults.replaceChildren(...(header ? [header, list] : [list]));
  } else {
    layout.chatSearchResults.classList.add("hidden");
    layout.chatSearchResults.replaceChildren();
  }

  let pinnedBar: HTMLElement | null = null;
  if (Array.isArray(pinnedIds) && pinnedIds.length) {
    const activeId = typeof activeRaw === "number" && pinnedIds.includes(activeRaw) ? activeRaw : pinnedIds[0];
    const activeIdx = Math.max(0, pinnedIds.indexOf(activeId));
    const pinnedMsg = msgs.find((m) => typeof m.id === "number" && m.id === activeId) || null;
    const previewRaw =
      pinnedMsg?.attachment?.kind === "file"
        ? `Файл: ${String(pinnedMsg.attachment.name || "файл")}`
        : String(pinnedMsg?.text || "").trim() || `Сообщение #${activeId}`;
    const preview = previewRaw.length > 140 ? `${previewRaw.slice(0, 137)}…` : previewRaw;
    const titleNodes: Array<string | HTMLElement> = ["Закреплено"];
    if (pinnedIds.length > 1) {
      titleNodes.push(
        el("span", { class: "chat-pinned-count", "aria-label": `Закреп ${activeIdx + 1} из ${pinnedIds.length}` }, [
          `${activeIdx + 1}/${pinnedIds.length}`,
        ])
      );
    }

    const jumpBtn = el(
      "button",
      { class: "chat-pinned-body", type: "button", "data-action": "chat-pinned-jump", "aria-label": "Показать закреплённое сообщение" },
      [
        el("div", { class: "chat-pinned-main" }, [
          el("span", { class: "chat-pinned-title" }, titleNodes),
          el("span", { class: "chat-pinned-text" }, [preview]),
        ]),
        el("span", { class: "chat-pinned-jump", "aria-hidden": "true" }, ["→"]),
      ]
    );
    const closeBtn = el("button", { class: "btn chat-pinned-close", type: "button", "data-action": "chat-pinned-unpin", "aria-label": "Открепить" }, [
      "×",
    ]);
    const actions: HTMLElement[] = [];
    if (pinnedIds.length > 1) {
      actions.push(el("button", { class: "btn chat-pinned-nav", type: "button", "data-action": "chat-pinned-prev", "aria-label": "Предыдущий закреп" }, ["↑"]));
      actions.push(el("button", { class: "btn chat-pinned-nav", type: "button", "data-action": "chat-pinned-next", "aria-label": "Следующий закреп" }, ["↓"]));
    }
    actions.push(closeBtn);
    pinnedBar = el("div", { class: "chat-pinned", role: "note" }, [
      jumpBtn,
      el("div", { class: "chat-pinned-actions" }, actions),
    ]);
  }

  const topChildren: HTMLElement[] = [el("div", { class: "chat-title" }, titleChildren)];
  if (pinnedBar) topChildren.push(pinnedBar);
  if (searchBar) topChildren.push(searchBar);
  layout.chatTop.replaceChildren(...topChildren);
  if (searchFooter) {
    layout.chatSearchFooter.classList.remove("hidden");
    layout.chatSearchFooter.replaceChildren(searchFooter);
  } else {
    layout.chatSearchFooter.classList.add("hidden");
    layout.chatSearchFooter.replaceChildren();
  }
  if (selectionCount > 0) {
    const selectedMsgs =
      selectionSet && selectionSet.size
        ? msgs.filter((msg) => {
            const selKey = messageSelectionKey(msg);
            return Boolean(selKey && selectionSet.has(selKey));
          })
        : [];
    const pinCandidates = selectedMsgs
      .map((msg) => (typeof msg.id === "number" && Number.isFinite(msg.id) ? Math.trunc(msg.id) : 0))
      .filter((id) => id > 0);
    const canPin = pinCandidates.length > 0;
    const allPinned = canPin && pinCandidates.every((id) => isPinnedMessage(state.pinnedMessages, key, id));
    const pinLabel = allPinned ? "📍" : "📌";
    const pinTitle = allPinned ? "Открепить" : "Закрепить";
    const cancelBtn = el(
      "button",
      {
        class: "btn chat-selection-cancel",
        type: "button",
        "data-action": "chat-selection-cancel",
        "aria-label": "Отменить выбор",
      },
      ["×"]
    );
    const countNode = el("div", { class: "chat-selection-count" }, [formatSelectionCount(selectionCount)]);
    const forwardBtn = el(
      "button",
      {
        class: "btn chat-selection-action",
        type: "button",
        "data-action": "chat-selection-forward",
        "aria-label": "Переслать выбранные сообщения",
        title: "Переслать",
      },
      ["↪"]
    );
    const deleteBtn = el(
      "button",
      {
        class: "btn chat-selection-action chat-selection-danger",
        type: "button",
        "data-action": "chat-selection-delete",
        "aria-label": "Удалить выбранные сообщения",
        title: "Удалить",
      },
      ["🗑️"]
    );
    const pinBtn = el(
      "button",
      {
        class: "btn chat-selection-action",
        type: "button",
        "data-action": "chat-selection-pin",
        "aria-label": pinTitle,
        title: pinTitle,
        ...(canPin ? {} : { disabled: "true" }),
      },
      [pinLabel]
    );
    const actions = el("div", { class: "chat-selection-actions" }, [forwardBtn, deleteBtn, pinBtn]);
    const inner = el("div", { class: "chat-selection-inner" }, [cancelBtn, countNode, actions]);
    layout.chatSelectionBar.classList.remove("hidden");
    layout.chatSelectionBar.replaceChildren(inner);
  } else {
    layout.chatSelectionBar.classList.add("hidden");
    layout.chatSelectionBar.replaceChildren();
  }
  scrollHost.replaceChildren(el("div", { class: "chat-lines" }, lines));

  if (virtualEnabled && key) {
    const w = typeof window !== "undefined" ? window : null;
    if (hostState.__chatVirtualAvgRaf) {
      // already scheduled
    } else {
      const schedule = () => {
        hostState.__chatVirtualAvgRaf = null;
        const linesEl = scrollHost.firstElementChild as HTMLElement | null;
        if (!linesEl) return;
        const children = Array.from(linesEl.children) as HTMLElement[];
        let spacerHeight = 0;
        let spacerCount = 0;
        for (const child of children) {
          if (child.getAttribute("data-virtual-spacer")) {
            spacerHeight += child.offsetHeight;
            spacerCount += 1;
          }
        }
        const totalHeight = Math.max(0, linesEl.scrollHeight - spacerHeight);
        const lineCount = Math.max(1, children.length - spacerCount);
        const avg = clampVirtualAvg(totalHeight / lineCount);
        virtualAvgMap.set(key, avg);
      };
      if (w && typeof w.requestAnimationFrame === "function") {
        hostState.__chatVirtualAvgRaf = w.requestAnimationFrame(schedule);
      } else {
        hostState.__chatVirtualAvgRaf = 1;
        schedule();
      }
    }
  }

  // iOS/WebKit: images and media previews may change the history height after render.
  // Keep the chat pinned to bottom on content height changes, but only when pinned is active.
  if (key && typeof ResizeObserver === "function") {
    try {
      if (!hostState.__chatLinesObserver) {
        hostState.__chatLinesObserverRaf = null;
        hostState.__chatLinesObserver = new ResizeObserver(() => {
          const w = typeof window !== "undefined" ? window : null;
          if (hostState.__chatLinesObserverRaf !== null) return;
          const run = () => {
            hostState.__chatLinesObserverRaf = null;
            const curKey = String(scrollHost.getAttribute("data-chat-key") || "");
            if (!curKey) return;
            const st = hostState.__stickBottom;
          if (!st || !st.active || st.key !== curKey) return;
          scrollHost.scrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
        };
        if (w && typeof w.requestAnimationFrame === "function") {
          hostState.__chatLinesObserverRaf = w.requestAnimationFrame(run);
        } else {
          hostState.__chatLinesObserverRaf = 1;
            run();
          }
        });
      }
      const linesEl = scrollHost.firstElementChild as HTMLElement | null;
      if (linesEl && hostState.__chatLinesObserved !== linesEl) {
        hostState.__chatLinesObserver.disconnect();
        hostState.__chatLinesObserver.observe(linesEl);
        hostState.__chatLinesObserved = linesEl;
      }
    } catch {
      // ignore
    }
  }

  if (!shouldStick && !keyChanged) {
    // Some browsers (notably iOS/WebKit) may reset scrollTop when we replace the chat DOM.
    // Preserve the user's position in history unless we explicitly want to stick to bottom.
    try {
      const maxTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, prevScrollTop));
      if (Math.abs(scrollHost.scrollTop - nextTop) >= 1) scrollHost.scrollTop = nextTop;
    } catch {
      // ignore
    }
  }
  const atBottomNow = scrollHost.scrollTop >= maxScrollTop() - 24;
  layout.chatJump.classList.toggle("hidden", !key || shouldStick || atBottomNow);
  if (shouldStick) {
    const stickNow = () => {
      const curKey = String(scrollHost.getAttribute("data-chat-key") || "");
      const st = hostState.__stickBottom;
      if (!curKey || curKey !== key) return;
      if (!st || !st.active || st.key !== key) return;
      scrollHost.scrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
    };
    queueMicrotask(stickNow);
  }
}
