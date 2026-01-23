import { el } from "../../helpers/dom/el";
import type { AppState, FileOfferIn, FileTransferEntry, TargetRef } from "../../stores/types";
import { safeUrl } from "../../helpers/security/safeUrl";
import {
  clearFileCache,
  cleanupFileCache,
  getCachedFileBlob,
  getFileCacheStats,
  listFileCacheEntries,
} from "../../helpers/files/fileBlobCache";
import { fileBadge, type FileBadgeKind } from "../../helpers/files/fileBadge";
import { CACHE_CLEAN_PRESETS, CACHE_SIZE_PRESETS, loadFileCachePrefs, saveFileCachePrefs } from "../../helpers/files/fileCachePrefs";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";

export interface FilesPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

export interface FilesPageActions {
  onFileSend: (file: File | null, target: TargetRef | null) => void;
  onFileOfferAccept: (fileId: string) => void;
  onFileOfferReject: (fileId: string) => void;
  onClearCompleted: () => void;
  onOpenUser: (id: string) => void;
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

function formatGroupTime(ts: number): string {
  if (!ts) return "";
  const dt = new Date(ts);
  const now = new Date();
  const sameDay = dt.toDateString() === now.toDateString();
  const yesterday = (() => {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    return dt.toDateString() === y.toDateString();
  })();
  const time = dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Сегодня ${time}`;
  if (yesterday) return `Вчера ${time}`;
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) + ` · ${time}`;
}

function triggerBrowserDownload(url: string, name: string) {
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    // ignore
  }
}

async function openCachedFile(userId: string, fileId: string, name: string, mode: "download" | "open") {
  const cached = await getCachedFileBlob(userId, fileId);
  if (!cached) return;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(cached.blob);
  } catch {
    url = null;
  }
  if (!url) return;
  if (mode === "download") {
    triggerBrowserDownload(url, name);
  } else {
    try {
      window.open(url, "_blank", "noopener");
    } catch {
      // ignore
    }
  }
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(url!);
    } catch {
      // ignore
    }
  }, 60_000);
}

function targetValue(target: TargetRef): string {
  return `${target.kind}:${target.id}`;
}

function parseTargetValue(value: string): TargetRef | null {
  const [kind, id] = value.split(":", 2);
  if (!id) return null;
  if (kind === "dm" || kind === "group" || kind === "board") {
    return { kind, id };
  }
  return null;
}

function roomLabel(roomId: string, state: AppState): string {
  const board = state.boards.find((b) => b.id === roomId);
  if (board) return `Доска: ${String(board.name || roomId)}`;
  const group = state.groups.find((g) => g.id === roomId);
  if (group) return `Чат: ${String(group.name || roomId)}`;
  return `Комната: ${roomId}`;
}

function transferStatus(entry: FileTransferEntry): string {
  if (entry.status === "uploading") return "Загрузка";
  if (entry.status === "downloading") return "Скачивание";
  if (entry.status === "uploaded") return "Файл загружен";
  if (entry.status === "complete") return "Готово";
  if (entry.status === "rejected") return "Отклонено";
  if (entry.status === "error") return `Ошибка: ${entry.error || "неизвестно"}`;
  return entry.direction === "out" ? "Ожидание подтверждения" : "Ожидание отправителя";
}

function isPreviewableKind(kind: FileBadgeKind): boolean {
  return kind === "image" || kind === "video";
}

function transferTimestamp(entry: FileTransferEntry): number {
  const raw = String(entry.localId || "").trim();
  const m = raw.match(/^ft-(\d+)-/);
  if (m) {
    const ts = Number(m[1]);
    return Number.isFinite(ts) ? ts : 0;
  }
  return 0;
}

interface TransferGroup {
  key: string;
  ts: number;
  direction: "in" | "out";
  peer: string;
  room: string | null;
  items: FileTransferEntry[];
}

function transferGroupKey(entry: FileTransferEntry): string {
  const room = typeof entry.room === "string" ? entry.room : "";
  const peer = String(entry.peer || "").trim();
  return `${entry.direction}:${room ? `room:${room}` : `peer:${peer}`}`;
}

function groupTransfers(entries: FileTransferEntry[]): TransferGroup[] {
  const groups: TransferGroup[] = [];
  const windowMs = 2 * 60 * 1000;
  let current: TransferGroup | null = null;
  let lastTs = 0;
  for (const entry of entries) {
    const ts = transferTimestamp(entry);
    const key = transferGroupKey(entry);
    const room = typeof entry.room === "string" ? entry.room : null;
    const peer = String(entry.peer || "").trim() || "—";
    const canGroup =
      current &&
      current.key === key &&
      (!lastTs || !ts || Math.abs(lastTs - ts) <= windowMs);
    if (!current || !canGroup) {
      if (current) groups.push(current);
      current = {
        key,
        ts,
        direction: entry.direction,
        peer,
        room,
        items: [entry],
      };
      lastTs = ts;
      continue;
    }
    current.items.push(entry);
    if (!current.ts && ts) current.ts = ts;
    if (ts) lastTs = ts;
  }
  if (current) groups.push(current);
  return groups;
}

export function createFilesPage(actions: FilesPageActions): FilesPage {
  const mobileUi = isMobileLikeUi();
  const title = el("div", { class: "chat-title" }, ["Файлы"]);

  const sendTitle = el("div", { class: "pane-section" }, ["Отправка"]);
  const fileInput = el("input", { class: "modal-input", type: "file" }) as HTMLInputElement;
  const fileMeta = el("div", { class: "file-meta" }, ["Файл не выбран"]);
  const targetSelect = el("select", { class: "modal-input" }) as HTMLSelectElement;
  const sendBtn = el("button", { class: "btn", type: "button" }, ["Отправить"]);
  const sendStack = el("div", { class: "page-stack" }, [fileInput, fileMeta, targetSelect]);
  const sendForm = el("div", { class: "page-form" }, [sendStack, sendBtn]);
  const sendBlock = el("div", { class: "page-card files-section" }, [sendTitle, sendForm]);

  const offersTitle = el("div", { class: "pane-section" }, ["Входящие предложения"]);
  const offersList = el("div", { class: "files-list" });
  const offersBlock = el("div", { class: "page-card files-section" }, [offersTitle, offersList]);

  const transfersTitle = el("div", { class: "pane-section" }, ["Передачи"]);
  const clearBtn = el("button", { class: "btn", type: "button" }, ["Очистить завершенные"]);
  const transfersHeader = el("div", { class: "files-header" }, [transfersTitle, clearBtn]);
  const transfersList = el("div", { class: "files-list" });
  const transfersBlock = el("div", { class: "page-card files-section" }, [transfersHeader, transfersList]);

  const cacheTitle = el("div", { class: "pane-section" }, ["Кэш файлов"]);
  const cacheInfo = el("div", { class: "file-cache-info" }, ["—"]);
  const cacheLimitLabel = el("label", { class: "modal-label", for: "file-cache-limit" }, ["Лимит кэша"]);
  const cacheLimitSelect = el("select", { class: "modal-input", id: "file-cache-limit" }) as HTMLSelectElement;
  const cacheCleanLabel = el("label", { class: "modal-label", for: "file-cache-clean" }, ["Автоочистка"]);
  const cacheCleanSelect = el("select", { class: "modal-input", id: "file-cache-clean" }) as HTMLSelectElement;
  const cacheHint = el("div", { class: "file-cache-hint" }, [
    "Кэш нужен, чтобы не скачивать файлы повторно. Автоочистка удаляет старые файлы по сроку.",
  ]);
  const cacheClearBtn = el("button", { class: "btn btn-danger", type: "button" }, ["Очистить кэш"]);
  const cacheActions = el("div", { class: "file-cache-actions" }, [cacheClearBtn]);
  const cacheBlock = el("div", { class: "page-card files-section" }, [
    cacheTitle,
    cacheInfo,
    cacheLimitLabel,
    cacheLimitSelect,
    cacheCleanLabel,
    cacheCleanSelect,
    cacheHint,
    cacheActions,
  ]);

  const cachedTitle = el("div", { class: "pane-section" }, ["Кэшированные файлы"]);
  const cachedHint = el("div", { class: "file-cache-hint" }, ["Это список файлов, которые реально лежат локально в кэше (CacheStorage)."]);
  const cachedList = el("div", { class: "files-list" });
  const cachedBlock = el("div", { class: "page-card files-section" }, [cachedTitle, cachedHint, cachedList]);

  const hint = mobileUi ? null : el("div", { class: "msg msg-sys page-hint" }, ["F7 — файлы | Esc — назад"]);

  const root = el("div", { class: "page page-files" }, [
    title,
    sendBlock,
    offersBlock,
    transfersBlock,
    cacheBlock,
    cachedBlock,
    ...(hint ? [hint] : []),
  ]);

  for (const opt of CACHE_SIZE_PRESETS) {
    cacheLimitSelect.append(el("option", { value: String(opt.bytes) }, [opt.label]));
  }
  for (const opt of CACHE_CLEAN_PRESETS) {
    cacheCleanSelect.append(el("option", { value: String(opt.ms) }, [opt.label]));
  }

  let lastState: AppState | null = null;
  let selectedTarget = "";
  let targetLocked = false;
  const previewUrls = new Map<string, string>();
  const previewInFlight = new Set<string>();
  let refreshTimer: number | null = null;
  let cacheStatsTimer: number | null = null;

  function updateFileMeta() {
    const file = fileInput.files?.[0];
    if (!file) {
      fileMeta.textContent = "Файл не выбран";
      return;
    }
    fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;
  }

  function displayNameForPeer(state: AppState, id: string): string {
    const profile = state.profiles[id];
    const raw = profile?.display_name ? String(profile.display_name).trim() : "";
    if (raw) return raw;
    const friend = state.friends.find((f) => f.id === id);
    if (friend) return friend.id;
    return id || "—";
  }

  function handleForPeer(state: AppState, id: string): string | null {
    const profile = state.profiles[id];
    const raw = profile?.handle ? String(profile.handle).trim() : "";
    return raw ? (raw.startsWith("@") ? raw : `@${raw}`) : null;
  }

  function renderPeerButton(state: AppState, id: string): HTMLElement {
    const name = displayNameForPeer(state, id);
    const handle = handleForPeer(state, id);
    const label = handle ? `${name} ${handle}` : name;
    return el(
      "button",
      {
        class: "file-peer-link",
        type: "button",
        "data-action": "open-peer-profile",
        "data-peer-id": id,
        title: `Открыть профиль: ${name}`,
      },
      [label]
    );
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      if (lastState) update(lastState);
    }, 0);
  }

  function scheduleCacheStatsRefresh() {
    if (cacheStatsTimer !== null) return;
    cacheStatsTimer = window.setTimeout(() => {
      cacheStatsTimer = null;
      if (lastState) refreshCacheStats(lastState);
    }, 120);
  }

  function cleanupPreviewUrls(validIds: Set<string>) {
    for (const [id, url] of previewUrls.entries()) {
      if (validIds.has(id)) continue;
      previewUrls.delete(id);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }

  async function ensureCachedPreview(userId: string, fileId: string, mime: string | null) {
    if (previewInFlight.has(fileId)) return;
    previewInFlight.add(fileId);
    try {
      const cached = await getCachedFileBlob(userId, fileId);
      if (!cached) return;
      let url: string | null = null;
      try {
        url = URL.createObjectURL(cached.blob);
      } catch {
        url = null;
      }
      if (!url) return;
      previewUrls.set(fileId, url);
      scheduleRefresh();
    } finally {
      previewInFlight.delete(fileId);
    }
  }

  function renderOffer(offer: FileOfferIn, state: AppState): HTMLElement {
    const acceptBtn = el("button", { class: "btn btn-primary file-action file-action-accept", type: "button" }, ["Принять"]);
    const rejectBtn = el("button", { class: "btn btn-danger file-action file-action-reject", type: "button" }, ["Отклонить"]);
    acceptBtn.addEventListener("click", () => actions.onFileOfferAccept(offer.id));
    rejectBtn.addEventListener("click", () => actions.onFileOfferReject(offer.id));
    const metaLines = [
      `От: ${offer.from || "—"}`,
      offer.room ? roomLabel(offer.room, state) : "",
      `Размер: ${formatBytes(offer.size)}`,
    ].filter(Boolean);
    const metaEls = metaLines.map((line) => el("div", { class: "file-meta" }, [line]));
    const badge = fileBadge(offer.name || "файл", null);
    const icon = el("span", { class: `file-icon file-icon-${badge.kind}`, "aria-hidden": "true" }, [badge.label]);
    icon.style.setProperty("--file-h", String(badge.hue));
    return el("div", { class: "file-row" }, [
      el("div", { class: "file-main" }, [el("div", { class: "file-title" }, [icon, el("div", { class: "file-name" }, [offer.name || "файл"])]), ...metaEls]),
      el("div", { class: "file-actions" }, [acceptBtn, rejectBtn]),
    ]);
  }

  function renderTransfer(entry: FileTransferEntry, state: AppState): HTMLElement {
    const hideProgressText = entry.status === "uploading" || entry.status === "downloading";
    const statusLine = hideProgressText ? "" : transferStatus(entry);
    const base = typeof location !== "undefined" ? location.href : "http://localhost/";
    const safeHref = entry.url ? safeUrl(entry.url, { base, allowedProtocols: ["http:", "https:", "blob:"] }) : null;
    const fileId = String(entry.id || "").trim();
    const metaLines: string[] = [];
    if (entry.direction === "out") {
      if (entry.room) metaLines.push(`Куда: ${roomLabel(entry.room, state)}`);
      else metaLines.push(`Кому:`);
    } else {
      if (entry.room) metaLines.push(`Канал: ${roomLabel(entry.room, state)}`);
      metaLines.push(`От:`);
    }
    metaLines.push(`Размер: ${formatBytes(entry.size)}`);
    if (statusLine) metaLines.push(statusLine);
    if (entry.acceptedBy?.length) metaLines.push(`Приняли: ${entry.acceptedBy.join(", ")}`);
    if (entry.receivedBy?.length) metaLines.push(`Получили: ${entry.receivedBy.join(", ")}`);
    const metaEls = metaLines.map((line) => {
      if (line === "Кому:" && entry.peer && entry.peer !== "—") {
        return el("div", { class: "file-meta" }, ["Кому: ", renderPeerButton(state, entry.peer)]);
      }
      if (line === "От:" && entry.peer && entry.peer !== "—") {
        return el("div", { class: "file-meta" }, ["От: ", renderPeerButton(state, entry.peer)]);
      }
      return el("div", { class: "file-meta" }, [line]);
    });
    const badge = fileBadge(entry.name || "файл", entry.mime ?? null);
    const icon = el("span", { class: `file-icon file-icon-${badge.kind}`, "aria-hidden": "true" }, [badge.label]);
    icon.style.setProperty("--file-h", String(badge.hue));
    const mainChildren: HTMLElement[] = [el("div", { class: "file-title" }, [icon, el("div", { class: "file-name" }, [entry.name || "файл"])]), ...metaEls];
    if (entry.status === "uploading" || entry.status === "downloading") {
      const progress = Math.max(0, Math.min(100, Math.round(entry.progress || 0)));
      const label = entry.status === "uploading" ? `Загрузка ${progress}%` : `Скачивание ${progress}%`;
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
    const actionsList: HTMLElement[] = [];
    const canDownload = entry.status === "complete" || entry.status === "uploaded";
    if (canDownload && safeHref) {
      actionsList.push(el("a", { class: "btn file-action file-action-download", href: safeHref, download: entry.name }, ["Скачать"]));
    } else if (canDownload && fileId) {
      actionsList.push(
        el("button", { class: "btn file-action file-action-download", type: "button", "data-action": "file-download", "data-file-id": fileId }, ["Скачать"])
      );
    }
    const statusClass = entry.status === "error" ? "is-error" : entry.status === "complete" || entry.status === "uploaded" ? "is-complete" : "";
    const rowChildren: HTMLElement[] = [];
    const canPreview = isPreviewableKind(badge.kind);
    const previewUrl = safeHref || (fileId ? previewUrls.get(fileId) || null : null);
    if (canPreview && canDownload) {
      const attrs: Record<string, string | undefined> = {
        class: "file-preview",
        type: "button",
        "data-action": fileId ? "file-download" : undefined,
        "data-file-id": fileId || undefined,
        "aria-label": `Скачать: ${entry.name || "файл"}`,
      };
      const media =
        badge.kind === "video"
          ? previewUrl
            ? (() => {
                const video = el("video", {
                  class: "file-preview-media file-preview-video",
                  src: previewUrl,
                  preload: "metadata",
                  muted: "true",
                  playsinline: "true",
                }) as HTMLVideoElement;
                video.muted = true;
                video.defaultMuted = true;
                return video;
              })()
            : el("div", { class: "file-preview-placeholder" }, ["Видео"])
          : previewUrl
            ? el("img", {
                class: "file-preview-media file-preview-img",
                src: previewUrl,
                alt: entry.name || "изображение",
                loading: "lazy",
                decoding: "async",
              })
            : el("div", { class: "file-preview-placeholder" }, ["Фото"]);
      const overlay = badge.kind === "video" ? el("div", { class: "file-preview-overlay" }, ["▶"]) : null;
      const children = overlay ? [media, overlay] : [media];
      rowChildren.push(el("button", attrs, children));
      const userId = state.selfId;
      if (!previewUrl && fileId && userId) {
        void ensureCachedPreview(userId, fileId, entry.mime ?? null);
      }
    }
    rowChildren.push(
      el("div", { class: "file-main" }, mainChildren),
      actionsList.length ? el("div", { class: "file-actions" }, actionsList) : el("div", { class: "file-actions" })
    );
    return el("div", { class: `file-row ${statusClass}` }, rowChildren);
  }

  function renderTransferGroup(group: TransferGroup, state: AppState): HTMLElement {
    const dirLabel = group.direction === "out" ? "Отправлено" : "Получено";
    const countLabel = `${group.items.length} ${group.items.length === 1 ? "файл" : group.items.length < 5 ? "файла" : "файлов"}`;
    const title = `${dirLabel} · ${countLabel}`;
    const timeLabel = formatGroupTime(group.ts);
    const targetLabel = group.room ? roomLabel(group.room, state) : group.peer ? displayNameForPeer(state, group.peer) : "";
    const metaParts = [targetLabel, timeLabel].filter(Boolean).join(" · ");
    const header = el("div", { class: "files-group-head" }, [
      el("div", { class: "files-group-title" }, [title]),
      metaParts ? el("div", { class: "files-group-meta" }, [metaParts]) : el("div", { class: "files-group-meta" }, [""]),
    ]);
    const body = el("div", { class: "files-group-list" }, group.items.map((entry) => renderTransfer(entry, state)));
    return el("div", { class: "files-group" }, [header, body]);
  }

  function refreshCacheStats(state: AppState) {
    if (!state.selfId) {
      cacheInfo.textContent = "Кэш доступен после входа.";
      cacheInfo.classList.remove("file-cache-warning");
      return;
    }
    const prefs = loadFileCachePrefs(state.selfId);
    const stats = getFileCacheStats(state.selfId);
    const used = formatBytes(stats.totalBytes);
    const limit = formatBytes(prefs.maxBytes);
    cacheInfo.textContent = `Используется: ${used} / ${limit} · файлов: ${stats.count}`;
    const warn = prefs.maxBytes > 0 && stats.totalBytes >= prefs.maxBytes * 0.85;
    cacheInfo.classList.toggle("file-cache-warning", warn);
  }

  fileInput.addEventListener("change", updateFileMeta);
  targetSelect.addEventListener("change", () => {
    selectedTarget = targetSelect.value;
    targetLocked = true;
  });
  sendBtn.addEventListener("click", () => {
    const file = fileInput.files?.[0] ?? null;
    const target = targetSelect.value ? parseTargetValue(targetSelect.value) : null;
    actions.onFileSend(file, target ?? lastState?.selected ?? null);
  });
  clearBtn.addEventListener("click", () => actions.onClearCompleted());
  cacheLimitSelect.addEventListener("change", () => {
    const st = lastState;
    const userId = st?.selfId;
    if (!st || !userId) return;
    const prefs = loadFileCachePrefs(userId);
    prefs.maxBytes = Number(cacheLimitSelect.value || prefs.maxBytes) || prefs.maxBytes;
    saveFileCachePrefs(userId, prefs);
    void cleanupFileCache(userId, { maxBytes: prefs.maxBytes, ttlMs: prefs.autoCleanMs }).then(() => refreshCacheStats(st));
  });
  cacheCleanSelect.addEventListener("change", () => {
    const st = lastState;
    const userId = st?.selfId;
    if (!st || !userId) return;
    const prefs = loadFileCachePrefs(userId);
    prefs.autoCleanMs = Number(cacheCleanSelect.value || prefs.autoCleanMs) || prefs.autoCleanMs;
    saveFileCachePrefs(userId, prefs);
    void cleanupFileCache(userId, { maxBytes: prefs.maxBytes, ttlMs: prefs.autoCleanMs }).then(() => {
      prefs.lastCleanAt = Date.now();
      saveFileCachePrefs(userId, prefs);
      refreshCacheStats(st);
    });
  });
  cacheClearBtn.addEventListener("click", () => {
    const st = lastState;
    const userId = st?.selfId;
    if (!st || !userId) return;
    void clearFileCache(userId).then(() => refreshCacheStats(st));
  });

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const btn = t?.closest("button[data-action='open-peer-profile']") as HTMLButtonElement | null;
    if (!btn) return;
    const peerId = String(btn.getAttribute("data-peer-id") || "").trim();
    if (!peerId) return;
    e.preventDefault();
    actions.onOpenUser(peerId);
  });

  function update(state: AppState) {
    lastState = state;
    updateFileMeta();

    const userId = state.selfId;
    const canUseCache = Boolean(userId && state.authed);
    cacheLimitSelect.disabled = !canUseCache;
    cacheCleanSelect.disabled = !canUseCache;
    cacheClearBtn.disabled = !canUseCache;
    if (canUseCache && userId) {
      const prefs = loadFileCachePrefs(userId);
      cacheLimitSelect.value = String(prefs.maxBytes);
      cacheCleanSelect.value = String(prefs.autoCleanMs);
      const now = Date.now();
      if (prefs.autoCleanMs > 0 && now - prefs.lastCleanAt >= prefs.autoCleanMs) {
        void cleanupFileCache(userId, { maxBytes: prefs.maxBytes, ttlMs: prefs.autoCleanMs }).then(() => {
          prefs.lastCleanAt = now;
          saveFileCachePrefs(userId, prefs);
          refreshCacheStats(state);
        });
      } else {
        scheduleCacheStatsRefresh();
      }
    } else {
      cacheInfo.textContent = "Кэш доступен после входа.";
    }

    const options: HTMLElement[] = [el("option", { value: "" }, ["— адресат —"])];
    const dmOptions = state.friends.map((f) => el("option", { value: targetValue({ kind: "dm", id: f.id }) }, [f.id]));
    if (dmOptions.length) options.push(el("optgroup", { label: "Контакты" }, dmOptions));
    const groupOptions = state.groups.map((g) =>
      el("option", { value: targetValue({ kind: "group", id: g.id }) }, [String(g.name || g.id)])
    );
    if (groupOptions.length) options.push(el("optgroup", { label: "Чаты" }, groupOptions));
    const boardOptions = state.boards.map((b) =>
      el("option", { value: targetValue({ kind: "board", id: b.id }) }, [String(b.name || b.id)])
    );
    if (boardOptions.length) options.push(el("optgroup", { label: "Доски" }, boardOptions));
    targetSelect.replaceChildren(...options);

    const fallback = state.selected ? targetValue(state.selected) : "";
    let preferred = targetLocked ? selectedTarget : fallback;
    const hasPreferred = Array.from(targetSelect.options).some((opt) => opt.value === preferred);
    if (!hasPreferred) {
      preferred = fallback;
      targetLocked = false;
    }
    if (Array.from(targetSelect.options).some((opt) => opt.value === preferred)) {
      targetSelect.value = preferred;
    }
    selectedTarget = targetSelect.value;

    if (!state.fileOffersIn.length) {
      offersList.replaceChildren(
        el("div", { class: "page-empty" }, [
          el("div", { class: "page-empty-title" }, ["Нет входящих файлов"]),
          el("div", { class: "page-empty-sub" }, ["Когда вам отправят файл, он появится здесь"]),
        ])
      );
    } else {
      offersList.replaceChildren(...state.fileOffersIn.map((offer) => renderOffer(offer, state)));
    }

    if (!state.fileTransfers.length) {
      transfersList.replaceChildren(
        el("div", { class: "page-empty" }, [
          el("div", { class: "page-empty-title" }, ["Нет передач"]),
          el("div", { class: "page-empty-sub" }, ["Отправьте файл через «Скрепку» в чате или выберите адресата выше"]),
        ])
      );
    } else {
      const groups = groupTransfers(state.fileTransfers);
      transfersList.replaceChildren(...groups.map((group) => renderTransferGroup(group, state)));
    }

    if (!canUseCache || !userId) {
      cachedList.replaceChildren(
        el("div", { class: "page-empty" }, [
          el("div", { class: "page-empty-title" }, ["Кэш недоступен"]),
          el("div", { class: "page-empty-sub" }, ["Войдите, чтобы увидеть локально закэшированные файлы"]),
        ])
      );
    } else {
      const cached = listFileCacheEntries(userId, { limit: 240 });
      const inTransfers = new Set(state.fileTransfers.map((e) => String(e.id || "").trim()).filter(Boolean));
      const extra = cached.filter((e) => Boolean(e.fileId) && !inTransfers.has(e.fileId));
      if (!extra.length) {
        cachedList.replaceChildren(
          el("div", { class: "page-empty" }, [
            el("div", { class: "page-empty-title" }, ["Нет отдельных кэшированных файлов"]),
            el("div", { class: "page-empty-sub" }, ["Кэшированные файлы обычно видны в «Передачи» после загрузки"]),
          ])
        );
      } else {
        cachedList.replaceChildren(
          ...extra.map((entry) => {
            const name = entry.name || entry.fileId;
            const badge = fileBadge(name, entry.mime);
            const icon = el("span", { class: `file-icon file-icon-${badge.kind}`, "aria-hidden": "true" }, [badge.label]);
            icon.style.setProperty("--file-h", String(badge.hue));
            const meta = [
              entry.ts ? `Кэш: ${formatGroupTime(entry.ts)}` : "",
              entry.size > 0 ? `Размер: ${formatBytes(entry.size)}` : "",
            ]
              .filter(Boolean)
              .map((line) => el("div", { class: "file-meta" }, [line]));
            const btnOpen = el("button", { class: "btn", type: "button" }, ["Открыть"]);
            const btnDownload = el("button", { class: "btn btn-primary", type: "button" }, ["Скачать"]);
            btnOpen.addEventListener("click", () => void openCachedFile(userId, entry.fileId, name || "файл", "open"));
            btnDownload.addEventListener("click", () => void openCachedFile(userId, entry.fileId, name || "файл", "download"));
            return el("div", { class: "file-row" }, [
              el("div", { class: "file-main" }, [el("div", { class: "file-title" }, [icon, el("div", { class: "file-name" }, [name])]), ...meta]),
              el("div", { class: "file-actions" }, [btnOpen, btnDownload]),
            ]);
          })
        );
      }
    }

    const validPreviewIds = new Set(state.fileTransfers.map((entry) => String(entry.id || "").trim()).filter(Boolean));
    cleanupPreviewUrls(validPreviewIds);

    const hasClearable = state.fileTransfers.some((entry) => ["complete", "uploaded", "error", "rejected"].includes(entry.status));
    clearBtn.disabled = !hasClearable;
  }

  return {
    root,
    update,
    focus: () => fileInput.focus(),
  };
}
