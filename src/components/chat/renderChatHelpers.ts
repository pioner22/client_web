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
import { getCachedMediaAspectRatio } from "../../helpers/chat/mediaAspectCache";
import { getCachedLocalMediaAspectRatio } from "../../helpers/chat/localMediaAspectCache";
import { layoutTelegramAlbum } from "../../helpers/chat/telegramGroupedLayout";
import {
  HISTORY_VIRTUAL_THRESHOLD,
  HISTORY_VIRTUAL_WINDOW,
  clampVirtualAvg,
  getVirtualEnd,
  getVirtualMaxStart,
  getVirtualStart,
  shouldVirtualize,
} from "../../helpers/chat/virtualHistory";
import { CHAT_SEARCH_FILTERS } from "../../helpers/chat/chatSearch";

export function dayKey(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  } catch {
    return "";
  }
}

export const EMPTY_CHAT: ChatMessage[] = [];
export const EMPTY_HITS: number[] = [];

export function formatDayLabel(ts: number): string {
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

export function formatSelectionCount(count: number): string {
  const n = Math.max(0, Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word = "сообщений";
  if (mod10 === 1 && mod100 !== 11) word = "сообщение";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "сообщения";
  return `${n} ${word}`;
}

export function shortenChatFileNameTelegram(
  name: string,
  maxWords = 4,
  maxChars = 25
): { title: string; display: string } {
  const title = String(name || "").trim() || "файл";
  const dotIndex = title.lastIndexOf(".");
  const hasExt = dotIndex > 0 && dotIndex < title.length - 1;
  const base = hasExt ? title.slice(0, dotIndex) : title;
  const ext = hasExt ? title.slice(dotIndex) : "";
  const body = base.trim() || title;

  let wordCount = 0;
  let inWord = false;

  for (let idx = 0; idx < body.length; idx++) {
    const ch = body[idx];
    const isSep = ch === " " || ch === "_" || ch === "-" || ch === "\t";
    if (!inWord && !isSep) inWord = true;
    if (inWord && isSep) {
      inWord = false;
      wordCount += 1;
    }
  }
  if (inWord) wordCount += 1;

  const needsShorten = body.length > maxChars || wordCount > maxWords;
  if (!needsShorten) return { title, display: title };

  const prefix = body
    .slice(0, Math.max(1, Math.min(body.length, maxChars)))
    .trimEnd()
    .replace(/[\s_-]+$/g, "");
  const safePrefix = prefix || body.slice(0, Math.max(1, Math.min(body.length, maxChars))).trimEnd();
  return { title, display: `${safePrefix}…${ext}` };
}

export function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

export function chatTitleNodes(state: AppState): Array<string | HTMLElement> {
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

export function formatBytes(size: number): string {
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

export function resolveUserAccent(seed: string): string | null {
  const s = String(seed ?? "").trim();
  if (!s) return null;
  const hue = avatarHue(s);
  return `hsl(${hue} 68% 58%)`;
}

export function normalizeFileName(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const noQuery = raw.split(/[?#]/)[0];
  const leaf = noQuery.split(/[\\/]/).pop() || "";
  return leaf.trim().toLowerCase();
}

export const IMAGE_NAME_HINT_RE =
  /(?:^|[_\-\s\(\)\[\]])(?:img|image|photo|pic|picture|screenshot|screen[_\-\s]?shot|shot|dsc|pxl|selfie|scan|скрин(?:шот)?|фото|картин|изображ|снимок)(?:[_\-\s\(\)\[\]]|\d|$)/;
export const VIDEO_NAME_HINT_RE =
  /(?:^|[_\-\s\(\)\[\]])(?:video|vid|movie|clip|screencast|screen[_\-\s]?(?:rec|record|recording)|видео|ролик)(?:[_\-\s\(\)\[\]]|\d|$)/;
export const AUDIO_NAME_HINT_RE =
  /(?:^|[_\-\s\(\)\[\]])(?:audio|voice|sound|music|song|track|record|rec|memo|note|voice[_\-\s]?note|аудио|звук|музык|песня|голос|запис|диктофон|заметк)(?:[_\-\s\(\)\[\]]|\d|$)/;

export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg|heic|heif)$/;
export const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|ogv|mkv|avi|3gp|3g2)$/;
export const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/;

export function isImageFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("image/")) return true;
  if (mt.startsWith("video/") || mt.startsWith("audio/")) return false;
  const n = normalizeFileName(name);
  if (!n) return false;
  if (IMAGE_EXT_RE.test(n)) return true;
  // iOS often names videos as IMG_XXXX.MP4/MOV; extension must override name hints.
  if (VIDEO_EXT_RE.test(n) || AUDIO_EXT_RE.test(n)) return false;
  return IMAGE_NAME_HINT_RE.test(n);
}

export function isVideoFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("video/")) return true;
  if (mt.startsWith("image/") || mt.startsWith("audio/")) return false;
  const n = normalizeFileName(name);
  if (!n) return false;
  if (VIDEO_EXT_RE.test(n)) return true;
  if (IMAGE_EXT_RE.test(n) || AUDIO_EXT_RE.test(n)) return false;
  return VIDEO_NAME_HINT_RE.test(n);
}

export function isAudioFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("audio/")) return true;
  if (mt.startsWith("image/") || mt.startsWith("video/")) return false;
  const n = normalizeFileName(name);
  if (!n) return false;
  if (AUDIO_EXT_RE.test(n)) return true;
  if (IMAGE_EXT_RE.test(n) || VIDEO_EXT_RE.test(n)) return false;
  return AUDIO_NAME_HINT_RE.test(n);
}

export function transferStatus(entry: FileTransferEntry): string {
  if (entry.status === "uploading") return "Загрузка";
  if (entry.status === "downloading") return "Скачивание";
  if (entry.status === "uploaded") return "Файл загружен";
  if (entry.status === "complete") return "Готово";
  if (entry.status === "rejected") return "Отклонено";
  if (entry.status === "error") return `Ошибка: ${entry.error || "неизвестно"}`;
  return entry.direction === "out" ? "Ожидание подтверждения" : "Ожидание отправителя";
}

export function statusLabel(m: ChatMessage): string {
  const status = m.status;
  if (!status) return "";
  const hasServerId = typeof m.id === "number" && Number.isFinite(m.id) && m.id > 0;
  if (status === "sending") return "…";
  if (status === "queued") return hasServerId ? "✓" : "…";
  if (status === "sent") return "✓";
  if (status === "delivered") return "✓✓";
  if (status === "read") return "✓✓";
  if (status === "error") return "!";
  return "";
}

export function statusTitle(m: ChatMessage): string {
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
  if (status === "sent") return "Отправлено";
  if (status === "delivered") return "Доставлено";
  if (status === "read") return "Прочитано";
  if (status === "error") return "Ошибка отправки";
  return "";
}

export function formatUserLabel(displayName: string, handle: string, fallback: string): string {
  const dn = String(displayName || "").trim();
  if (dn) return dn;
  const h = String(handle || "").trim();
  if (h) return h.startsWith("@") ? h : `@${h}`;
  return fallback || "—";
}

export function resolveUserLabel(state: AppState, id: string, friendLabels?: Map<string, string>): string {
  const pid = String(id || "").trim();
  if (!pid) return "—";
  const p = state.profiles?.[pid];
  if (p) return formatUserLabel(p.display_name || "", p.handle || "", pid);
  const fromFriends = friendLabels?.get(pid);
  return fromFriends || pid;
}

export function resolveUserHandle(state: AppState, id: string): string {
  const pid = String(id || "").trim();
  if (!pid) return "";
  const p = state.profiles?.[pid];
  return normalizeHandle(String(p?.handle || ""));
}

export function normalizeHandle(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

export function refPreview(ref: ChatMessageRef): string {
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

export function renderMessageRef(
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
  const senderHandle = !hiddenProfile && fromId ? resolveUserHandle(state, fromId) : "";
  if (senderHandle && !sender.includes(senderHandle)) metaParts.push(senderHandle);
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

export function searchResultPreview(m: ChatMessage): string {
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

export function trimSearchPreview(text: string, maxLen = 180): string {
  const t = String(text || "").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

export type FileAttachmentInfo = {
  name: string;
  size: number;
  mime: string | null;
  fileId: string | null;
  url: string | null;
  thumbUrl: string | null;
  thumbW: number | null;
  thumbH: number | null;
  mediaW: number | null;
  mediaH: number | null;
  transfer: FileTransferEntry | null;
  offer: FileOfferIn | null;
  statusLine: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  hasProgress: boolean;
};

export const CHAT_MEDIA_PREVIEW_SCALE = 0.33;
export const CHAT_MEDIA_PREVIEW_FALLBACK_BASE_PX = 420;

export function resolvePreviewBaseWidthPx(info: FileAttachmentInfo): number | null {
  const w = info.thumbW || info.mediaW || CHAT_MEDIA_PREVIEW_FALLBACK_BASE_PX;
  if (!Number.isFinite(w) || w <= 0) return null;
  return Math.trunc(w);
}

export type AlbumItem = {
  idx: number;
  msg: ChatMessage;
  info: FileAttachmentInfo;
};

export function buildMessageMeta(m: ChatMessage): HTMLElement[] {
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

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

export function renderReactions(m: ChatMessage): HTMLElement | null {
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

  const mine = typeof (raw as any).mine === "string" ? String((raw as any).mine).trim() : null;
  const shown = entries.slice(0, 12);
  const nodes = shown.map(({ emoji, count }) => {
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
        title: active ? `Убрать реакцию ${emoji}` : mine ? `Заменить реакцию на ${emoji}` : `Поставить реакцию ${emoji}`,
      },
      [el("span", { class: "msg-react-emoji", "aria-hidden": "true" }, [emoji]), el("span", { class: "msg-react-count" }, [String(count)])]
    ) as HTMLButtonElement;
    btn.setAttribute("aria-label", label);
    return btn;
  });

  const remaining = entries.length - shown.length;
  if (remaining > 0) {
    const more = el(
      "button",
      {
        class: "msg-react msg-react-more",
        type: "button",
        "data-action": "msg-react-more",
        title: "Показать все реакции",
        "aria-label": "Показать все реакции",
      },
      [`+${remaining}`]
    ) as HTMLButtonElement;
    nodes.push(more);
  }

  const add = el(
    "button",
    {
      class: "msg-react msg-react-add",
      type: "button",
      "data-action": "msg-react-add",
      title: mine ? "Изменить реакцию" : "Добавить реакцию",
      "aria-label": mine ? "Изменить реакцию" : "Добавить реакцию",
    },
    ["＋"]
  ) as HTMLButtonElement;
  nodes.push(add);
  return el("div", { class: "msg-reacts" }, nodes);
}

export function getFileAttachmentInfo(state: AppState, m: ChatMessage, opts?: { mobileUi: boolean }): FileAttachmentInfo | null {
  const att = m.attachment;
  if (!att || att.kind !== "file") return null;
  const transfer =
    (att.localId ? state.fileTransfers.find((t) => t.localId === att.localId) : null) ||
    (att.fileId ? state.fileTransfers.find((t) => t.id === att.fileId) : null) ||
    null;
  const offer = !transfer && att.fileId ? state.fileOffersIn.find((o) => o.id === att.fileId) ?? null : null;
  const name = String(transfer?.name || offer?.name || att.name || "файл");
  const size = Number(transfer?.size ?? offer?.size ?? att.size ?? 0) || 0;
  const mime = att.mime || transfer?.mime || offer?.mime || null;
  const base = typeof location !== "undefined" ? location.href : "http://localhost/";
  const url = transfer?.url ? safeUrl(transfer.url, { base, allowedProtocols: ["http:", "https:", "blob:"] }) : null;
  const mobileUi = opts?.mobileUi ?? false;
  const hideProgressText = Boolean(transfer && (transfer.status === "uploading" || transfer.status === "downloading"));
  const statusLine = transfer
    ? hideProgressText
      ? ""
      : transferStatus(transfer)
    : offer
      ? mobileUi
        ? "Входящий файл (принять в «Файлы»)"
        : "Входящий файл (принять в «Файлы» / F7)"
      : "";
  const isImage = isImageFile(name, mime);
  const isVideo = isVideoFile(name, mime);
  const isAudio = isAudioFile(name, mime);
  const hasProgress = Boolean(transfer && (transfer.status === "uploading" || transfer.status === "downloading"));
  const fileId = att.fileId ? String(att.fileId) : transfer?.id ? String(transfer.id) : offer?.id ? String(offer.id) : null;
  const thumbUrl =
    fileId && state.fileThumbs?.[fileId]?.url
      ? safeUrl(state.fileThumbs[fileId].url, { base, allowedProtocols: ["http:", "https:", "blob:"] })
      : null;
  const thumbMeta = fileId ? state.fileThumbs?.[fileId] ?? null : null;
  const thumbW = typeof thumbMeta?.w === "number" && Number.isFinite(thumbMeta.w) && thumbMeta.w > 0 ? Math.trunc(thumbMeta.w) : null;
  const thumbH = typeof thumbMeta?.h === "number" && Number.isFinite(thumbMeta.h) && thumbMeta.h > 0 ? Math.trunc(thumbMeta.h) : null;
  const mediaW =
    typeof thumbMeta?.mediaW === "number" && Number.isFinite(thumbMeta.mediaW) && thumbMeta.mediaW > 0 ? Math.trunc(thumbMeta.mediaW) : null;
  const mediaH =
    typeof thumbMeta?.mediaH === "number" && Number.isFinite(thumbMeta.mediaH) && thumbMeta.mediaH > 0 ? Math.trunc(thumbMeta.mediaH) : null;
  return {
    name,
    size,
    mime,
    fileId,
    url,
    thumbUrl,
    thumbW,
    thumbH,
    mediaW,
    mediaH,
    transfer,
    offer,
    statusLine,
    isImage,
    isVideo,
    isAudio,
    hasProgress,
  };
}

function renderMediaProgressOverlay(transfer: FileTransferEntry): HTMLElement | null {
  if (transfer.status !== "uploading" && transfer.status !== "downloading") return null;
  const progress = Math.max(0, Math.min(100, Math.round(transfer.progress || 0)));
  const label = transfer.status === "uploading" ? `Загрузка ${progress}%` : `Скачивание ${progress}%`;
  const candy = el("span", { class: "file-progress-candy", "aria-hidden": "true" });
  candy.style.setProperty("--file-progress", `${progress}%`);
  return el(
    "span",
    {
      class: "chat-media-progress",
      role: "progressbar",
      title: label,
      "aria-label": label,
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": String(progress),
    },
    [candy]
  );
}

export function renderImagePreviewButton(info: FileAttachmentInfo, opts?: { className?: string; msgIdx?: number; caption?: string | null }): HTMLElement | null {
  if (!info.isImage) return null;
  const previewUrl = info.thumbUrl || info.url;
  if (!previewUrl && !info.fileId) return null;
  const classes = previewUrl ? ["chat-file-preview"] : ["chat-file-preview", "chat-file-preview-empty"];
  if (opts?.className) classes.push(opts.className);
  const fixedAspect = Boolean(opts?.className && opts.className.split(/\s+/).includes("chat-file-preview-album"));
  const attrs: Record<string, string | undefined> = {
    class: classes.join(" "),
    type: "button",
    "data-action": "open-file-viewer",
    "data-file-kind": "image",
    "data-name": info.name,
    "data-size": String(info.size || 0),
    ...(fixedAspect ? { "data-media-fixed": "1" } : {}),
    "aria-label": `Открыть: ${info.name}`,
  };
  if (info.transfer?.localId) attrs["data-local-id"] = info.transfer.localId;
  const progressOverlay = info.transfer ? renderMediaProgressOverlay(info.transfer) : null;
  if (progressOverlay) attrs["data-media-progress"] = "1";
  if (info.url) attrs["data-url"] = info.url;
  if (info.fileId) attrs["data-file-id"] = info.fileId;
  if (info.mime) attrs["data-mime"] = info.mime;
  if (opts?.msgIdx !== undefined) attrs["data-msg-idx"] = String(opts.msgIdx);
  if (opts?.caption) attrs["data-caption"] = opts.caption;

  const child = previewUrl
    ? el("img", { class: "chat-file-img", src: previewUrl, alt: info.name, loading: "lazy", decoding: "async" })
    : el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Фото"]);
  const btnChildren: HTMLElement[] = [child];
  if (progressOverlay) btnChildren.push(progressOverlay);
  const btn = el("button", attrs, btnChildren) as HTMLButtonElement;
  if (!fixedAspect) {
    const cachedRatio = info.fileId ? getCachedMediaAspectRatio(info.fileId) : null;
    const cachedLocalRatio = !cachedRatio && info.transfer?.localId ? getCachedLocalMediaAspectRatio(info.transfer.localId) : null;
    const ratio = cachedRatio ?? cachedLocalRatio;
    if (ratio) btn.style.aspectRatio = String(ratio);
  }
  return btn;
}

export function renderVideoPreviewButton(
  info: FileAttachmentInfo,
  opts?: { className?: string; msgIdx?: number; caption?: string | null; mobileUi?: boolean }
): HTMLElement | null {
  if (!info.isVideo) return null;
  const fixedAspect = Boolean(opts?.className && opts.className.split(/\s+/).includes("chat-file-preview-album"));
  const mobileUi = Boolean(opts?.mobileUi);
  const progressOverlay = info.transfer ? renderMediaProgressOverlay(info.transfer) : null;
  const bytes = Number(info.size || 0) || 0;
  const INLINE_VIDEO_MAX_BYTES = 8 * 1024 * 1024;
  const canInlineVideo = Boolean(!fixedAspect && info.url && !mobileUi && bytes > 0 && bytes <= INLINE_VIDEO_MAX_BYTES);
  const previewUrl = fixedAspect ? info.thumbUrl : canInlineVideo ? info.url : info.thumbUrl;
  if (!previewUrl && !info.fileId) return null;
  const hasVisual = Boolean(previewUrl);
  const classes = hasVisual
    ? ["chat-file-preview", "chat-file-preview-video"]
    : ["chat-file-preview", "chat-file-preview-video", "chat-file-preview-empty"];
  if (opts?.className) classes.push(opts.className);
  const attrs: Record<string, string | undefined> = {
    class: classes.join(" "),
    type: "button",
    "data-action": "open-file-viewer",
    ...(fixedAspect ? { "data-media-fixed": "1" } : {}),
    ...(canInlineVideo ? { "data-video-state": "paused" } : {}),
    ...(progressOverlay ? { "data-media-progress": "1" } : {}),
    "data-file-kind": "video",
    "data-name": info.name,
    "data-size": String(info.size || 0),
    "aria-label": `Открыть: ${info.name}`,
  };
  if (info.transfer?.localId) attrs["data-local-id"] = info.transfer.localId;
  if (info.url) attrs["data-url"] = info.url;
  if (info.fileId) attrs["data-file-id"] = info.fileId;
  if (info.mime) attrs["data-mime"] = info.mime;
  if (opts?.msgIdx !== undefined) attrs["data-msg-idx"] = String(opts.msgIdx);
  if (opts?.caption) attrs["data-caption"] = opts.caption;

  const children: HTMLElement[] = [
    canInlineVideo
	      ? (() => {
	          const video = el("video", {
	            class: "chat-file-video",
	            src: info.url || undefined,
	            preload: "metadata",
	            playsinline: "true",
	            muted: "true",
	            loop: "true",
            ...(info.thumbUrl ? { poster: info.thumbUrl } : {}),
          }) as HTMLVideoElement;
          video.muted = true;
          video.defaultMuted = true;
          return video;
        })()
      : previewUrl
        ? (el("img", { class: "chat-file-img", src: previewUrl, alt: info.name, loading: "lazy", decoding: "async" }) as HTMLImageElement)
        : (el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Видео"]) as HTMLDivElement),
  ];
  if (canInlineVideo) {
    if (!progressOverlay) {
      children.push(el("span", { class: "chat-file-video-toggle", "data-action": "media-toggle", "aria-hidden": "true" }, [""]));
    }
  } else if (!progressOverlay) {
    children.push(el("span", { class: "chat-file-video-toggle", "aria-hidden": "true" }, [""]));
  }
  if (progressOverlay) children.push(progressOverlay);
  const btn = el("button", attrs, children) as HTMLButtonElement;
  if (!fixedAspect) {
    const cachedRatio = info.fileId ? getCachedMediaAspectRatio(info.fileId) : null;
    const cachedLocalRatio = !cachedRatio && info.transfer?.localId ? getCachedLocalMediaAspectRatio(info.transfer.localId) : null;
    const ratio = cachedRatio ?? cachedLocalRatio;
    if (ratio) btn.style.aspectRatio = String(ratio);
  }
  return btn;
}

export function isWebpStickerCandidate(info: FileAttachmentInfo, ratio: number): boolean {
  if (!info.isImage) return false;
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) return false;
  if (r < 0.85 || r > 1.18) return false;
  const size = Number(info.size || 0) || 0;
  if (size <= 0 || size > 600_000) return false;
  const name = String(info.name || "").trim().toLowerCase();
  const mime = String(info.mime || "").trim().toLowerCase();
  const isWebp = mime === "image/webp" || name.endsWith(".webp");
  return isWebp;
}

export function isRoundVideoCandidate(info: FileAttachmentInfo, ratio: number): boolean {
  void info;
  void ratio;
  return false;
}

export function isAlbumCandidate(msg: ChatMessage, info: FileAttachmentInfo | null): info is FileAttachmentInfo {
  if (!info || !(info.isImage || info.isVideo)) return false;
  if (msg.kind === "sys") return false;
  if (info.offer) return false;
  const caption = String(msg.text || "").trim();
  if (caption && !caption.startsWith("[file]")) return false;
  if (!info.url && !info.fileId) return false;
  return true;
}

export function skeletonLine(widthPct: number, cls = "skel-line"): HTMLElement {
  const w = Math.max(8, Math.min(100, Math.round(widthPct)));
  return el("div", { class: cls, style: `width: ${w}%;` }, [""]);
}

export function skeletonMsg(kind: "in" | "out", seed: number): HTMLElement {
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
  children.push(el("div", { class: "msg-avatar" }, [el("span", { class: "avatar avatar-skel", "aria-hidden": "true" }, [""])]));
  children.push(body);
  return el("div", { class: `msg msg-${kind} msg-skel`, "aria-hidden": "true" }, children);
}

export type ChatShiftAnchor = {
  key: string;
  msgKey?: string;
  msgId?: number;
  rectBottom: number;
  scrollTop: number;
};

export type UnreadDividerAnchor = {
  msgKey?: string;
  msgId?: number;
};

export function unreadAnchorForMessage(msg: ChatMessage): UnreadDividerAnchor {
  const msgKey = messageSelectionKey(msg);
  const rawId = msg?.id;
  const msgId = typeof rawId === "number" && Number.isFinite(rawId) && rawId > 0 ? rawId : undefined;
  return { ...(msgKey ? { msgKey } : {}), ...(msgId ? { msgId } : {}) };
}

export function findUnreadAnchorIndex(msgs: ChatMessage[], anchor: UnreadDividerAnchor): number {
  if (!Array.isArray(msgs) || msgs.length === 0) return -1;
  if (anchor.msgKey) {
    const idx = msgs.findIndex((m) => messageSelectionKey(m) === anchor.msgKey);
    if (idx >= 0) return idx;
  }
  if (anchor.msgId !== undefined) {
    const idx = msgs.findIndex((m) => {
      const raw = m?.id;
      return typeof raw === "number" && Number.isFinite(raw) && raw === anchor.msgId;
    });
    if (idx >= 0) return idx;
  }
  return -1;
}

export function captureChatShiftAnchor(host: HTMLElement, key: string): ChatShiftAnchor | null {
  const lines = host.firstElementChild as HTMLElement | null;
  if (!lines) return null;
  const hostRect = host.getBoundingClientRect();
  const children = Array.from(lines.children) as HTMLElement[];
  let fallback: HTMLElement | null = null;
  let lastVisible: { element: HTMLElement; rect: DOMRect } | null = null;
  for (const child of children) {
    if (!child.classList.contains("msg")) continue;
    if (!fallback) fallback = child;
    const rect = child.getBoundingClientRect();
    if (rect.bottom >= hostRect.top && rect.top <= hostRect.bottom) {
      lastVisible = { element: child, rect };
    } else if (lastVisible && rect.top > hostRect.bottom) {
      break;
    }
  }
  const picked = lastVisible ?? (fallback ? { element: fallback, rect: fallback.getBoundingClientRect() } : null);
  if (!picked) return null;
  const msgKey = String(picked.element.getAttribute("data-msg-key") || "").trim();
  const rawMsgId = picked.element.getAttribute("data-msg-id");
  const msgId = rawMsgId ? Number(rawMsgId) : NaN;
  return {
    key,
    msgKey: msgKey || undefined,
    msgId: Number.isFinite(msgId) ? msgId : undefined,
    rectBottom: picked.rect.bottom,
    scrollTop: host.scrollTop,
  };
}

export function findChatShiftAnchorElement(host: HTMLElement, anchor: ChatShiftAnchor): HTMLElement | null {
  const lines = host.firstElementChild as HTMLElement | null;
  if (!lines) return null;
  const children = Array.from(lines.children) as HTMLElement[];
  for (const child of children) {
    if (!child.classList.contains("msg")) continue;
    if (anchor.msgKey) {
      if (child.getAttribute("data-msg-key") === anchor.msgKey) return child;
      continue;
    }
    if (anchor.msgId !== undefined) {
      const raw = child.getAttribute("data-msg-id");
      if (!raw) continue;
      const msgId = Number(raw);
      if (Number.isFinite(msgId) && msgId === anchor.msgId) return child;
    }
  }
  return null;
}

export const EMOJI_SEGMENT_RE = /\p{Extended_Pictographic}/u;

export function isEmojiOnlyText(text: string): boolean {
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

export function roomLabel(name: string | null | undefined, id: string, handle?: string | null): string {
  const base = name ? `${name} (${id})` : id;
  if (handle) {
    const h = handle.startsWith("@") ? handle : `@${handle}`;
    return `${base} ${h}`;
  }
  return base;
}

export function renderMultilineText(text: string): HTMLElement {
  const cleaned = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned.split("\n");
  const nodes = lines.map((line) => el("div", { class: "invite-line" }, renderRichText(line)));
  return el("div", { class: "invite-text" }, nodes);
}

export function applyMessageDataset(
  line: HTMLElement,
  msgKind: string,
  meta: {
    boardUi?: boolean;
    mobileUi?: boolean;
    refKind?: "reply" | "forward";
    hasReacts?: boolean;
    hasCaption?: boolean;
    hasText?: boolean;
    emojiOnly?: boolean;
    attachKind?: string;
    fileKind?: string;
    actionKind?: string;
    album?: boolean;
    sticker?: boolean;
    roundVideo?: boolean;
  }
) {
  const setData = (name: string, value?: string) => {
    if (!value) return;
    line.setAttribute(name, value);
  };
  const setFlag = (name: string, ok?: boolean) => {
    if (!ok) return;
    line.setAttribute(name, "1");
  };
  line.setAttribute("data-msg-kind", String(msgKind || ""));
  setData("data-msg-attach", meta.attachKind);
  setData("data-msg-file", meta.fileKind);
  setData("data-msg-action", meta.actionKind);
  if (meta.refKind) {
    setData("data-msg-ref", meta.refKind);
    setFlag("data-msg-has-ref", true);
  }
  setFlag("data-msg-has-reacts", meta.hasReacts);
  setFlag("data-msg-has-caption", meta.hasCaption);
  setFlag("data-msg-has-text", meta.hasText);
  setFlag("data-msg-emoji-only", meta.emojiOnly);
  setFlag("data-msg-board", meta.boardUi);
  setFlag("data-msg-mobile", meta.mobileUi);
  setFlag("data-msg-album", meta.album);
  setFlag("data-msg-sticker", meta.sticker);
  setFlag("data-msg-round-video", meta.roundVideo);
}

export function messageLine(
  state: AppState,
  m: ChatMessage,
  friendLabels?: Map<string, string>,
  opts?: { mobileUi: boolean; boardUi?: boolean; msgIdx?: number; selectionMode?: boolean; selected?: boolean }
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
    const actionKind = m.attachment?.kind === "action" ? String(m.attachment.payload?.kind || "") : "";
    if (m.attachment?.kind === "action") {
      const card = renderInviteCard(m.attachment.payload, m.text);
      if (card) {
        bodyChildren.push(card);
        const line = el("div", { class: "msg msg-sys" }, [el("div", { class: "msg-body" }, bodyChildren)]);
        applyMessageDataset(line, m.kind, {
          boardUi: Boolean(opts?.boardUi && state.selected?.kind === "board"),
          mobileUi: opts?.mobileUi,
          attachKind: m.attachment?.kind,
          actionKind,
          hasText: Boolean(String(m.text || "").trim()),
        });
        return line;
      }
    }
    const emojiOnlySys = isEmojiOnlyText(m.text || "");
    bodyChildren.push(el("div", { class: `msg-text${emojiOnlySys ? " msg-emoji-only" : ""}` }, renderRichText(m.text)));
    if (m.attachment?.kind === "action") {
      const actions = sysActions(m.attachment.payload);
      if (actions) bodyChildren.push(actions);
    }
    const line = el("div", { class: "msg msg-sys" }, [el("div", { class: "msg-body" }, bodyChildren)]);
    applyMessageDataset(line, m.kind, {
      boardUi: Boolean(opts?.boardUi && state.selected?.kind === "board"),
      mobileUi: opts?.mobileUi,
      attachKind: m.attachment?.kind,
      actionKind,
      hasText: Boolean(String(m.text || "").trim()),
      emojiOnly: emojiOnlySys,
    });
    return line;
  }
  const fromId = String(m.from || "").trim();
  const selfId = String(state.selfId || "").trim();
  const displayFromId = m.kind === "out" ? selfId : fromId;
  const accentId = displayFromId;
  const resolvedLabel = displayFromId ? resolveUserLabel(state, displayFromId, friendLabels) : "";
  const fromLabel = resolvedLabel && resolvedLabel !== "—" ? resolvedLabel : m.kind === "out" ? "Я" : "—";
  const fromHandle = displayFromId ? resolveUserHandle(state, displayFromId) : "";
  const showHandle = Boolean(fromHandle && !fromLabel.includes(fromHandle));
  const titleLabel = showHandle ? `${fromLabel} ${fromHandle}` : fromLabel;
  const showFrom = true;
  const canOpenProfile = Boolean(displayFromId);
  const boardUi = Boolean(opts?.boardUi && state.selected?.kind === "board");
  const meta = buildMessageMeta(m);
  const bodyChildren: HTMLElement[] = [];
  let fileRowEl: HTMLElement | null = null;
  let selectionBtnPlacedInFileRow = false;
  if (showFrom) {
    const attrs = canOpenProfile
      ? {
          class: "msg-from msg-from-btn",
          type: "button",
          "data-action": "user-open",
          "data-user-id": displayFromId,
          title: `Профиль: ${titleLabel}`,
        }
      : { class: "msg-from" };
    const labelChildren = [el("span", { class: "msg-from-name" }, [fromLabel])];
    if (showHandle) labelChildren.push(el("span", { class: "msg-from-handle" }, [fromHandle]));
    const node = canOpenProfile ? el("button", attrs, labelChildren) : el("div", attrs, labelChildren);
    bodyChildren.push(node);
  }
  const ref = m.reply || m.forward;
  const refKind = m.reply ? "reply" : m.forward ? "forward" : undefined;
  if (ref) {
    const kind = m.reply ? "reply" : "forward";
    const refNode = renderMessageRef(state, ref, kind, friendLabels);
    if (refNode) bodyChildren.push(refNode);
  }
  const info = getFileAttachmentInfo(state, m, opts);
  const attachKind = m.attachment?.kind ? String(m.attachment.kind) : "";
  let hasCaption = false;
  let hasText = false;
  let emojiOnly = false;
  let fileKind = "";
  let sticker = false;
  let roundVideo = false;
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
    const fileName = boardUi ? { title: name, display: name } : shortenChatFileNameTelegram(name, 4, 25);
    const fileNameEl = el("div", { class: "file-name", title: fileName.title }, [fileName.display]);
    const mainChildren: HTMLElement[] = [el("div", { class: "file-title" }, [icon, fileNameEl]), ...metaEls];
    if (transfer && (transfer.status === "uploading" || transfer.status === "downloading")) {
      const progress = Math.max(0, Math.min(100, Math.round(transfer.progress || 0)));
      const label = transfer.status === "uploading" ? `Загрузка ${progress}%` : `Скачивание ${progress}%`;
      const candy = el("span", { class: "file-progress-candy", "aria-hidden": "true" });
      candy.style.setProperty("--file-progress", `${progress}%`);
      mainChildren.push(
        el(
          "div",
          {
            class: "file-progress",
            role: "progressbar",
            title: label,
            "aria-label": label,
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": String(progress),
          },
          [candy]
        )
      );
    }

    const isImage = info.isImage;
    const isVideo = info.isVideo;
    const isAudio = info.isAudio;

    if (isAudio) {
      if (url) {
        mainChildren.splice(
          1,
          0,
          el("audio", { class: "chat-file-audio", src: url, controls: "true", preload: "metadata" }) as HTMLAudioElement
        );
      } else if (info.fileId) {
        const placeholderAttrs: Record<string, string> = {
          class: "chat-file-audio-placeholder",
          "data-file-id": info.fileId,
          "data-file-kind": "audio",
          "data-name": info.name,
          "data-size": String(info.size || 0),
          "aria-hidden": "true",
        };
        if (info.mime) placeholderAttrs["data-mime"] = info.mime;
        if (opts?.msgIdx !== undefined) placeholderAttrs["data-msg-idx"] = String(opts.msgIdx);
        mainChildren.splice(1, 0, el("div", placeholderAttrs, ["Аудио"]));
      }
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
    const hasViewerCaption = Boolean(viewerCaption);
    const isVisualMedia = isImage || isVideo;
    const ratio = info.fileId ? getCachedMediaAspectRatio(info.fileId) : null;
    const canApplyMediaFlags = Boolean(!boardUi && !hasViewerCaption && ratio !== null);
    const stickerCandidate = canApplyMediaFlags && ratio !== null ? isWebpStickerCandidate(info, ratio) : false;
    const roundVideoCandidate = canApplyMediaFlags && ratio !== null ? isRoundVideoCandidate(info, ratio) : false;
    if (isVisualMedia) {
      const previewOpts = { caption: viewerCaption, msgIdx: opts?.msgIdx, mobileUi: opts?.mobileUi };
      const preview = isImage ? renderImagePreviewButton(info, previewOpts) : renderVideoPreviewButton(info, previewOpts);
      if (preview) rowChildren.unshift(preview);
    }

    const hasProgress = info.hasProgress;
    const fileRowClass = isVisualMedia
      ? `file-row file-row-chat file-row-image${isVideo ? " file-row-video" : ""}${hasProgress ? " file-row-progress" : ""}`
      : isAudio
        ? "file-row file-row-chat file-row-audio"
        : "file-row file-row-chat";
    fileRowEl = el("div", { class: fileRowClass }, rowChildren);
    if (isVisualMedia && !opts?.mobileUi) {
      if (!stickerCandidate && !roundVideoCandidate) {
        const baseW = resolvePreviewBaseWidthPx(info);
        if (baseW) {
          const scaled = Math.round(baseW * CHAT_MEDIA_PREVIEW_SCALE);
          if (scaled > 0) {
            (fileRowEl as any).style.maxWidth = `${scaled}px`;
          }
        }
      }
    }
    bodyChildren.push(fileRowEl);
    if (viewerCaption) {
      const emojiOnlyCaption = isEmojiOnlyText(viewerCaption);
      hasCaption = true;
      hasText = true;
      emojiOnly = emojiOnlyCaption;
      const boardUi = Boolean(opts?.boardUi && state.selected?.kind === "board");
      if (boardUi && !emojiOnlyCaption) {
        bodyChildren.push(el("div", { class: "msg-text msg-caption msg-text-board" }, [renderBoardPost(viewerCaption)]));
      } else {
        bodyChildren.push(el("div", { class: `msg-text msg-caption${emojiOnlyCaption ? " msg-emoji-only" : ""}` }, renderRichText(viewerCaption)));
      }
    }
    fileKind = isImage ? "image" : isVideo ? "video" : isAudio ? "audio" : "file";

    if (canApplyMediaFlags) {
      sticker = stickerCandidate;
      roundVideo = roundVideoCandidate;
    }
  } else {
    const trimmedText = String(m.text || "").trim();
    const textEmojiOnly = isEmojiOnlyText(trimmedText);
    hasText = Boolean(trimmedText);
    emojiOnly = textEmojiOnly;
    const boardUi = Boolean(opts?.boardUi && state.selected?.kind === "board");
    if (boardUi && !textEmojiOnly) {
      bodyChildren.push(el("div", { class: "msg-text msg-text-board" }, [renderBoardPost(m.text)]));
    } else {
      bodyChildren.push(el("div", { class: `msg-text${textEmojiOnly ? " msg-emoji-only" : ""}` }, renderRichText(m.text)));
    }
  }
  bodyChildren.push(el("div", { class: "msg-meta" }, meta));
  const reacts = renderReactions(m);
  if (reacts) bodyChildren.push(reacts);
  const selectionMode = Boolean(opts?.selectionMode);
  const selected = Boolean(opts?.selected);
  const selectionIdx = typeof opts?.msgIdx === "number" && Number.isFinite(opts.msgIdx) ? Math.trunc(opts.msgIdx) : null;
  const selectionDisabled =
    m.attachment?.kind === "action" || m.status === "sending" || m.status === "queued" || m.status === "error";
  const selectionBtn =
    selectionMode && selectionIdx !== null && !selectionDisabled
      ? el(
          "button",
          {
            class: `btn msg-select${selected ? " msg-select-on" : ""}`,
            type: "button",
            "data-action": "msg-select-toggle",
            "data-msg-idx": String(selectionIdx),
            title: selected ? "Снять выбор" : "Выбрать",
            "aria-label": selected ? "Снять выбор" : "Выбрать",
            ...(selected ? { "aria-pressed": "true" } : { "aria-pressed": "false" }),
          },
          [selected ? "✓" : ""]
        )
      : null;

  if (selectionBtn && fileRowEl && !Boolean(opts?.boardUi)) {
    if (fileKind === "audio" || fileKind === "file") {
      selectionBtnPlacedInFileRow = true;
      fileRowEl.prepend(selectionBtn);
    } else if (fileKind === "image" || fileKind === "video") {
      selectionBtnPlacedInFileRow = true;
      fileRowEl.append(selectionBtn);
    }
  }

  const lineChildren: HTMLElement[] = [];
  if (displayFromId) {
    const avatarNode = avatar("dm", displayFromId);
    if (canOpenProfile) {
      lineChildren.push(
        el("div", { class: "msg-avatar" }, [
          el(
            "button",
            { class: "msg-avatar-btn", type: "button", "data-action": "user-open", "data-user-id": displayFromId, title: `Профиль: ${titleLabel}` },
            [avatarNode]
          ),
        ])
      );
    } else {
      lineChildren.push(el("div", { class: "msg-avatar" }, [avatarNode]));
    }
  }
  const bodyNode = el("div", { class: "msg-body" }, bodyChildren);
  if (m.kind === "out") {
    lineChildren.push(bodyNode);
    if (selectionBtn && !selectionBtnPlacedInFileRow) lineChildren.push(selectionBtn);
  } else {
    if (selectionBtn && !selectionBtnPlacedInFileRow) lineChildren.push(selectionBtn);
    lineChildren.push(bodyNode);
  }
  const cls = m.attachment ? `msg msg-${m.kind} msg-attach` : `msg msg-${m.kind}`;
  const line = el("div", { class: cls }, lineChildren);
  applyMessageDataset(line, m.kind, {
    boardUi: Boolean(opts?.boardUi && state.selected?.kind === "board"),
    mobileUi: opts?.mobileUi,
    refKind,
    hasReacts: Boolean(reacts),
    hasCaption,
    hasText,
    emojiOnly,
    attachKind,
    fileKind,
    sticker,
    roundVideo,
  });
  const accent = resolveUserAccent(accentId);
  if (accent) {
    line.style.setProperty("--msg-accent", accent);
    line.style.setProperty("--msg-from-color", accent);
  }
  return line;
}

export function renderAlbumLine(
  state: AppState,
  items: AlbumItem[],
  friendLabels?: Map<string, string>,
  opts?: {
    selectionMode?: boolean;
    selected?: boolean;
    partial?: boolean;
    groupStartIdx?: number;
    groupEndIdx?: number;
    albumLayout?: { maxWidth: number; minWidth: number; spacing: number };
  }
): HTMLElement {
  const first = items[0];
  const last = items[items.length - 1];
  const fromId = String(first.msg.from || "").trim();
  const selfId = String(state.selfId || "").trim();
  const displayFromId = first.msg.kind === "out" ? selfId : fromId;
  const accentId = displayFromId;
  const resolvedLabel = displayFromId ? resolveUserLabel(state, displayFromId, friendLabels) : "";
  const fromLabel = resolvedLabel && resolvedLabel !== "—" ? resolvedLabel : first.msg.kind === "out" ? "Я" : "—";
  const fromHandle = displayFromId ? resolveUserHandle(state, displayFromId) : "";
  const showHandle = Boolean(fromHandle && !fromLabel.includes(fromHandle));
  const titleLabel = showHandle ? `${fromLabel} ${fromHandle}` : fromLabel;
  const showFrom = true;
  const canOpenProfile = Boolean(displayFromId);
  const bodyChildren: HTMLElement[] = [];
  if (showFrom) {
    const attrs = canOpenProfile
      ? {
          class: "msg-from msg-from-btn",
          type: "button",
          "data-action": "user-open",
          "data-user-id": displayFromId,
          title: `Профиль: ${titleLabel}`,
        }
      : { class: "msg-from" };
    const labelChildren = [el("span", { class: "msg-from-name" }, [fromLabel])];
    if (showHandle) labelChildren.push(el("span", { class: "msg-from-handle" }, [fromHandle]));
    const node = canOpenProfile ? el("button", attrs, labelChildren) : el("div", attrs, labelChildren);
    bodyChildren.push(node);
  }
  const ref = first.msg.reply || first.msg.forward;
  const refKind = first.msg.reply ? "reply" : first.msg.forward ? "forward" : undefined;
  if (ref) {
    const kind = first.msg.reply ? "reply" : "forward";
    const refNode = renderMessageRef(state, ref, kind, friendLabels);
    if (refNode) bodyChildren.push(refNode);
  }

  const selectionMode = Boolean(opts?.selectionMode);
  const selected = Boolean(opts?.selected);
  const partial = Boolean(opts?.partial);
  const selectionIdx = typeof last.idx === "number" && Number.isFinite(last.idx) ? Math.trunc(last.idx) : null;
  let selectionBtnPlacedInGrid = false;
  const selectionBtn =
    selectionMode && selectionIdx !== null
      ? el(
          "button",
          {
            class: `btn msg-select${selected || partial ? " msg-select-on" : ""}${partial ? " msg-select-partial" : ""}`,
            type: "button",
            "data-action": "msg-select-toggle",
            "data-msg-idx": String(selectionIdx),
            ...(typeof opts?.groupStartIdx === "number" && Number.isFinite(opts.groupStartIdx)
              ? { "data-msg-group-start": String(Math.trunc(opts.groupStartIdx)) }
              : {}),
            ...(typeof opts?.groupEndIdx === "number" && Number.isFinite(opts.groupEndIdx)
              ? { "data-msg-group-end": String(Math.trunc(opts.groupEndIdx)) }
              : {}),
            title: selected ? "Снять выбор" : partial ? "Выбрать всё" : "Выбрать",
            "aria-label": selected ? "Снять выбор" : partial ? "Выбрать всё" : "Выбрать",
            ...(selected ? { "aria-pressed": "true" } : partial ? { "aria-pressed": "mixed" } : { "aria-pressed": "false" }),
          },
          [selected ? "✓" : partial ? "–" : ""]
        )
      : null;

  const gridItems: HTMLElement[] = [];
  let hasCaption = false;
  let emojiOnly = false;
  const albumFileKind = items.every((it) => it && it.info && it.info.isVideo) ? "video" : "image";
  const layoutCfg = opts?.albumLayout ?? { maxWidth: 420, minWidth: 100, spacing: 1 };
  const sizes = items.map((item) => {
    const w = item.info.thumbW || item.info.mediaW;
    const h = item.info.thumbH || item.info.mediaH;
    if (w && h) return { w, h };
    const ratio =
      (item.info.fileId ? getCachedMediaAspectRatio(item.info.fileId) : null) ??
      (item.info.transfer?.localId ? getCachedLocalMediaAspectRatio(item.info.transfer.localId) : null);
    const r = typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    return { w: Math.max(1, Math.round(1000 * r)), h: 1000 };
  });
  const layout = (() => {
    try {
      return layoutTelegramAlbum(sizes, layoutCfg);
    } catch {
      return null;
    }
  })();
  const albumW = layout && Number.isFinite(layout.width) && layout.width > 0 ? layout.width : null;
  const albumH = layout && Number.isFinite(layout.height) && layout.height > 0 ? layout.height : null;
  const layoutOk = Boolean(albumW && albumH && layout && Array.isArray(layout.layout) && layout.layout.length === items.length);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const caption = String(item.msg.text || "").trim();
    const viewerCaption = caption && !caption.startsWith("[file]") ? caption : "";
    if (viewerCaption) {
      hasCaption = true;
      emojiOnly = isEmojiOnlyText(viewerCaption);
    }
    const preview = item.info.isImage
      ? renderImagePreviewButton(item.info, { className: "chat-file-preview-album", msgIdx: item.idx, caption: viewerCaption })
      : item.info.isVideo
        ? renderVideoPreviewButton(item.info, { className: "chat-file-preview-album", msgIdx: item.idx, caption: viewerCaption })
        : null;
    if (!preview) continue;
    const lay = layoutOk && layout ? layout.layout[i] : null;
    const style = lay && albumW && albumH ? `width: ${(lay.geometry.width / albumW) * 100}%; height: ${(lay.geometry.height / albumH) * 100}%; top: ${(lay.geometry.y / albumH) * 100}%; left: ${(lay.geometry.x / albumW) * 100}%;` : "";
    const wrap = el("div", { class: "chat-album-item", "data-msg-idx": String(item.idx), ...(layoutOk && style ? { style } : {}) }, [preview]);
    gridItems.push(wrap);
  }
  const grid = el("div", { class: layoutOk ? "chat-album-grid chat-album-grid-mosaic" : "chat-album-grid", "data-count": String(items.length) }, gridItems);
  if (layoutOk && albumW && albumH) {
    grid.style.width = `${Math.round(albumW)}px`;
    grid.style.height = `${Math.round(albumH)}px`;
  }
  if (selectionBtn) {
    selectionBtnPlacedInGrid = true;
    grid.append(selectionBtn);
  }
  bodyChildren.push(grid);
  bodyChildren.push(el("div", { class: "msg-meta" }, buildMessageMeta(last.msg)));
  const reacts = renderReactions(last.msg);
  if (reacts) bodyChildren.push(reacts);

  const lineChildren: HTMLElement[] = [];
  if (displayFromId) {
    const avatarNode = avatar("dm", displayFromId);
    if (canOpenProfile) {
      lineChildren.push(
        el("div", { class: "msg-avatar" }, [
          el(
            "button",
            { class: "msg-avatar-btn", type: "button", "data-action": "user-open", "data-user-id": displayFromId, title: `Профиль: ${titleLabel}` },
            [avatarNode]
          ),
        ])
      );
    } else {
      lineChildren.push(el("div", { class: "msg-avatar" }, [avatarNode]));
    }
  }
  const bodyNode = el("div", { class: "msg-body" }, bodyChildren);
  if (first.msg.kind === "out") {
    lineChildren.push(bodyNode);
    if (selectionBtn && !selectionBtnPlacedInGrid) lineChildren.push(selectionBtn);
  } else {
    if (selectionBtn && !selectionBtnPlacedInGrid) lineChildren.push(selectionBtn);
    lineChildren.push(bodyNode);
  }
  const line = el("div", { class: `msg msg-${first.msg.kind} msg-attach msg-album` }, lineChildren);
  applyMessageDataset(line, first.msg.kind, {
    refKind,
    hasReacts: Boolean(reacts),
    hasCaption,
    hasText: hasCaption,
    emojiOnly,
    attachKind: first.msg.attachment?.kind ? String(first.msg.attachment.kind) : "file",
    fileKind: albumFileKind,
    album: true,
  });
  const accent = resolveUserAccent(accentId);
  if (accent) {
    line.style.setProperty("--msg-accent", accent);
    line.style.setProperty("--msg-from-color", accent);
  }
  return line;
}
