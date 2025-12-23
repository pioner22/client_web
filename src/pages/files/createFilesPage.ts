import { el } from "../../helpers/dom/el";
import type { AppState, FileOfferIn, FileTransferEntry, TargetRef } from "../../stores/types";
import { safeUrl } from "../../helpers/security/safeUrl";
import { fileBadge } from "../../helpers/files/fileBadge";

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
  const pct = Math.max(0, Math.min(100, Math.round(entry.progress || 0)));
  if (entry.status === "uploading") return `Загрузка на сервер (${pct}%)`;
  if (entry.status === "downloading") return `Скачивание (${pct}%)`;
  if (entry.status === "uploaded") return "Файл загружен";
  if (entry.status === "complete") return "Готово";
  if (entry.status === "rejected") return "Отклонено";
  if (entry.status === "error") return `Ошибка: ${entry.error || "неизвестно"}`;
  return entry.direction === "out" ? "Ожидание подтверждения" : "Ожидание отправителя";
}

function isImageFile(name: string): boolean {
  const n = String(name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/.test(n);
}

export function createFilesPage(actions: FilesPageActions): FilesPage {
  const title = el("div", { class: "chat-title" }, ["Файлы"]);

  const sendTitle = el("div", { class: "pane-section" }, ["Отправка"]);
  const fileInput = el("input", { class: "modal-input", type: "file" }) as HTMLInputElement;
  const fileMeta = el("div", { class: "file-meta" }, ["Файл не выбран"]);
  const targetSelect = el("select", { class: "modal-input" }) as HTMLSelectElement;
  const sendBtn = el("button", { class: "btn", type: "button" }, ["Отправить"]);
  const sendStack = el("div", { class: "page-stack" }, [fileInput, fileMeta, targetSelect]);
  const sendForm = el("div", { class: "page-form" }, [sendStack, sendBtn]);
  const sendBlock = el("div", { class: "files-section" }, [sendTitle, sendForm]);

  const offersTitle = el("div", { class: "pane-section" }, ["Входящие предложения"]);
  const offersList = el("div", { class: "files-list" });
  const offersBlock = el("div", { class: "files-section" }, [offersTitle, offersList]);

  const transfersTitle = el("div", { class: "pane-section" }, ["Передачи"]);
  const clearBtn = el("button", { class: "btn", type: "button" }, ["Очистить завершенные"]);
  const transfersHeader = el("div", { class: "files-header" }, [transfersTitle, clearBtn]);
  const transfersList = el("div", { class: "files-list" });
  const transfersBlock = el("div", { class: "files-section" }, [transfersHeader, transfersList]);

  const hint = el("div", { class: "msg msg-sys page-hint" }, ["F7 — файлы | Esc — назад"]);

  const root = el("div", { class: "page" }, [title, sendBlock, offersBlock, transfersBlock, hint]);

  let lastState: AppState | null = null;
  let selectedTarget = "";
  let targetLocked = false;

  function updateFileMeta() {
    const file = fileInput.files?.[0];
    if (!file) {
      fileMeta.textContent = "Файл не выбран";
      return;
    }
    fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;
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
    const statusLine = transferStatus(entry);
    const base = typeof location !== "undefined" ? location.href : "http://localhost/";
    const safeHref = entry.url ? safeUrl(entry.url, { base, allowedProtocols: ["http:", "https:", "blob:"] }) : null;
    const fileId = String(entry.id || "").trim();
    const metaLines: string[] = [];
    if (entry.direction === "out") {
      if (entry.room) metaLines.push(`Куда: ${roomLabel(entry.room, state)}`);
      else metaLines.push(`Кому: ${entry.peer || "—"}`);
    } else {
      if (entry.room) metaLines.push(`Канал: ${roomLabel(entry.room, state)}`);
      metaLines.push(`От: ${entry.peer || "—"}`);
    }
    metaLines.push(`Размер: ${formatBytes(entry.size)}`);
    metaLines.push(statusLine);
    if (entry.acceptedBy?.length) metaLines.push(`Приняли: ${entry.acceptedBy.join(", ")}`);
    if (entry.receivedBy?.length) metaLines.push(`Получили: ${entry.receivedBy.join(", ")}`);
    const metaEls = metaLines.map((line) => el("div", { class: "file-meta" }, [line]));
    const badge = fileBadge(entry.name || "файл", null);
    const icon = el("span", { class: `file-icon file-icon-${badge.kind}`, "aria-hidden": "true" }, [badge.label]);
    icon.style.setProperty("--file-h", String(badge.hue));
    const mainChildren: HTMLElement[] = [el("div", { class: "file-title" }, [icon, el("div", { class: "file-name" }, [entry.name || "файл"])]), ...metaEls];
    if (entry.status === "uploading" || entry.status === "downloading") {
      const bar = el("div", { class: "file-progress-bar" });
      bar.style.width = `${Math.max(0, Math.min(100, Math.round(entry.progress || 0)))}%`;
      mainChildren.push(el("div", { class: "file-progress" }, [bar]));
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
    if (canDownload && isImageFile(entry.name || "")) {
      const attrs: Record<string, string | undefined> = {
        class: safeHref ? "chat-file-preview file-file-preview" : "chat-file-preview file-file-preview chat-file-preview-empty",
        type: "button",
        "data-action": "open-file-viewer",
        "data-name": entry.name || "файл",
        "data-size": String(entry.size || 0),
        "aria-label": `Открыть: ${entry.name || "файл"}`,
      };
      if (safeHref) attrs["data-url"] = safeHref;
      if (!safeHref && fileId) attrs["data-file-id"] = fileId;

      const child = safeHref
        ? el("img", { class: "chat-file-img file-file-img", src: safeHref, alt: entry.name || "изображение", loading: "lazy", decoding: "async" })
        : el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Фото"]);
      if (safeHref || fileId) rowChildren.push(el("button", attrs, [child]));
    }
    rowChildren.push(
      el("div", { class: "file-main" }, mainChildren),
      actionsList.length ? el("div", { class: "file-actions" }, actionsList) : el("div", { class: "file-actions" })
    );
    return el("div", { class: `file-row ${statusClass}` }, rowChildren);
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

  return {
    root,
    update: (state: AppState) => {
      lastState = state;
      updateFileMeta();

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
        transfersList.replaceChildren(...state.fileTransfers.map((entry) => renderTransfer(entry, state)));
      }

      const hasClearable = state.fileTransfers.some((entry) => ["complete", "uploaded", "error", "rejected"].includes(entry.status));
      clearBtn.disabled = !hasClearable;
    },
    focus: () => fileInput.focus(),
  };
}
