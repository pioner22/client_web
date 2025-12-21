import { el } from "../../helpers/dom/el";
import { safeUrl } from "../../helpers/security/safeUrl";

export interface FileViewerModalActions {
  onClose: () => void;
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
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/.test(n);
}

export function renderFileViewerModal(url: string, name: string, size: number, mime: string | null | undefined, actions: FileViewerModalActions): HTMLElement {
  const safeHref = safeUrl(url, { base: window.location.href, allowedProtocols: ["http:", "https:", "blob:"] });
  const titleText = String(name || "файл");

  const box = el("div", { class: "modal modal-viewer", role: "dialog", "aria-modal": "true" });

  const btnClose = el("button", { class: "btn auth-close", type: "button", title: "Закрыть", "aria-label": "Закрыть" }, ["×"]);
  btnClose.addEventListener("click", () => actions.onClose());

  const header = el("div", { class: "viewer-header" }, [
    el("div", { class: "viewer-title-wrap" }, [
      el("div", { class: "viewer-title", title: titleText }, [titleText]),
      el("div", { class: "viewer-sub" }, [`${formatBytes(Number(size) || 0)}`]),
    ]),
    btnClose,
  ]);

  let body: HTMLElement;
  if (!safeHref) {
    body = el("div", { class: "viewer-empty" }, ["Не удалось открыть файл: небезопасный URL"]);
  } else if (isImageFile(titleText, mime)) {
    const img = el("img", { class: "viewer-img", src: safeHref, alt: titleText, decoding: "async" });
    body = el("div", { class: "viewer-media" }, [img]);
  } else {
    body = el("div", { class: "viewer-file" }, [
      el("div", { class: "viewer-file-icon", "aria-hidden": "true" }, ["FILE"]),
      el("div", { class: "viewer-file-name" }, [titleText]),
    ]);
  }

  const actionsRow = el("div", { class: "modal-actions viewer-actions" });
  const btnCloseBottom = el("button", { class: "btn", type: "button" }, ["Закрыть"]);
  btnCloseBottom.addEventListener("click", () => actions.onClose());

  if (safeHref) {
    const btnDownload = el("a", { class: "btn btn-primary", href: safeHref, download: titleText }, ["Скачать"]);
    actionsRow.append(btnDownload, btnCloseBottom);
  } else {
    actionsRow.append(btnCloseBottom);
  }

  box.append(header, body, actionsRow);
  return box;
}
