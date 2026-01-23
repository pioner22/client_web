import { renderRichText } from "../../helpers/chat/richText";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { el } from "../../helpers/dom/el";
import { safeUrl } from "../../helpers/security/safeUrl";

export interface FileViewerMeta {
  authorId?: string | null;
  authorLabel?: string | null;
  authorHandle?: string | null;
  authorKind?: "dm" | "group" | "board";
  timestamp?: number | null;
}

export interface FileViewerModalActions {
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onJump?: () => void;
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

function normalizeFileName(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const noQuery = raw.split(/[?#]/)[0];
  const leaf = noQuery.split(/[\\/]/).pop() || "";
  return leaf.trim().toLowerCase();
}

function formatViewerDate(ts?: number | null): string {
  const value = Number(ts ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    const d = new Date(value * 1000);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const date = d.toLocaleDateString(
      "ru-RU",
      sameYear ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "numeric" }
    );
    const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return `${date} ${time}`.trim();
  } catch {
    return "";
  }
}

function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img viewer-author-avatar" : "avatar viewer-author-avatar", "aria-hidden": "true" }, [
    url ? "" : avatarMonogram(kind, id),
  ]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

const IMAGE_NAME_HINT_RE =
  /(?:^|[_\-\s\(\)\[\]])(?:img|image|photo|pic|picture|screenshot|screen[_\-\s]?shot|shot|dsc|pxl|selfie|scan|скрин(?:шот)?|фото|картин|изображ|снимок)(?:[_\-\s\(\)\[\]]|\d|$)/;
const VIDEO_NAME_HINT_RE =
  /(?:^|[_\-\s\(\)\[\]])(?:video|vid|movie|clip|screencast|screen[_\-\s]?(?:rec|record|recording)|видео|ролик)(?:[_\-\s\(\)\[\]]|\d|$)/;
const AUDIO_NAME_HINT_RE =
  /(?:^|[_\-\s\(\)\[\]])(?:audio|voice|sound|music|song|track|record|rec|memo|note|voice[_\-\s]?note|аудио|звук|музык|песня|голос|запис|диктофон|заметк)(?:[_\-\s\(\)\[\]]|\d|$)/;

function isImageFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("image/")) return true;
  const n = normalizeFileName(name);
  if (!n) return false;
  if (/\.(png|jpe?g|gif|webp|bmp|ico|svg|heic|heif)$/.test(n)) return true;
  return IMAGE_NAME_HINT_RE.test(n);
}

function isVideoFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("video/")) return true;
  const n = normalizeFileName(name);
  if (!n) return false;
  if (/\.(mp4|m4v|mov|webm|ogv|mkv|avi|3gp|3g2)$/.test(n)) return true;
  return VIDEO_NAME_HINT_RE.test(n);
}

function isAudioFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("audio/")) return true;
  const n = normalizeFileName(name);
  if (!n) return false;
  if (/\.(mp3|m4a|aac|wav|ogg|opus|flac)$/.test(n)) return true;
  return AUDIO_NAME_HINT_RE.test(n);
}

export function renderFileViewerModal(
  url: string,
  name: string,
  size: number,
  mime: string | null | undefined,
  caption: string | null | undefined,
  meta: FileViewerMeta | null | undefined,
  actions: FileViewerModalActions
): HTMLElement {
  const safeHref = safeUrl(url, { base: window.location.href, allowedProtocols: ["http:", "https:", "blob:"] });
  const titleText = String(name || "файл");
  const captionRaw = caption ? String(caption).trim() : "";
  const captionText = captionRaw && !captionRaw.startsWith("[file]") ? captionRaw : "";
  const isImage = isImageFile(titleText, mime);
  const isVideo = isVideoFile(titleText, mime);
  const isAudio = isAudioFile(titleText, mime);
  const isVisual = isImage || isVideo;

  const authorId = String(meta?.authorId || "").trim();
  const authorKind = meta?.authorKind || "dm";
  const authorLabel = String(meta?.authorLabel || authorId || "").trim();
  const authorHandleRaw = String(meta?.authorHandle || "").trim();
  const authorHandle = authorHandleRaw && authorLabel && !authorLabel.includes(authorHandleRaw) ? authorHandleRaw : "";
  const authorDate = formatViewerDate(meta?.timestamp);

  const modalClasses = ["modal", "modal-viewer"];
  if (isVisual) modalClasses.push("viewer-visual");
  if (isImage) modalClasses.push("viewer-image");
  if (isVideo) modalClasses.push("viewer-video");
  if (isAudio) modalClasses.push("viewer-audio");
  if (captionText) modalClasses.push("viewer-has-caption");
  const box = el("div", { class: modalClasses.join(" "), role: "dialog", "aria-modal": "true" });

  const IMAGE_ZOOM_SCALE = 2;

  const btnClose = el(
    "button",
    { class: "btn auth-close viewer-action-btn", type: "button", title: "Закрыть", "aria-label": "Закрыть" },
    ["×"]
  );
  btnClose.addEventListener("click", () => actions.onClose());
  const navButtons: HTMLElement[] = [];
  if (actions.onPrev) {
    const btnPrev = el("button", { class: "btn viewer-nav-btn viewer-action-btn", type: "button", "aria-label": "Предыдущее медиа" }, ["←"]);
    btnPrev.addEventListener("click", () => actions.onPrev && actions.onPrev());
    navButtons.push(btnPrev);
  }
  if (actions.onNext) {
    const btnNext = el("button", { class: "btn viewer-nav-btn viewer-action-btn", type: "button", "aria-label": "Следующее медиа" }, ["→"]);
    btnNext.addEventListener("click", () => actions.onNext && actions.onNext());
    navButtons.push(btnNext);
  }
  const headerActions = el("div", { class: "viewer-header-actions" }, [...navButtons]);
  let toggleZoom: (() => void) | null = null;
  let toggleZoomAt: ((focus?: { x: number; y: number }) => void) | null = null;
  let zoomTarget: HTMLImageElement | null = null;
  let zoomScroll: HTMLElement | null = null;
  if (isImage) {
    const zoomBtn = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-zoom-btn",
        type: "button",
        title: "Увеличить",
        "aria-label": "Увеличить",
        "aria-pressed": "false",
      },
      ["1x"]
    );
    toggleZoom = () => {
      const zoomed = box.classList.toggle("viewer-zoomed");
      zoomBtn.textContent = zoomed ? "2x" : "1x";
      zoomBtn.setAttribute("aria-pressed", zoomed ? "true" : "false");
      zoomBtn.setAttribute("aria-label", zoomed ? "Сбросить масштаб" : "Увеличить");
      zoomBtn.title = zoomed ? "Сбросить масштаб" : "Увеличить";
      if (!zoomed && zoomTarget) {
        zoomTarget.style.removeProperty("width");
        zoomTarget.style.removeProperty("height");
        zoomTarget.style.removeProperty("max-width");
        zoomTarget.style.removeProperty("max-height");
      }
      if (!zoomed && zoomScroll) {
        try {
          zoomScroll.scrollLeft = 0;
          zoomScroll.scrollTop = 0;
        } catch {
          // ignore
        }
      }
    };
    zoomBtn.addEventListener("click", () => {
      if (toggleZoomAt) {
        toggleZoomAt();
        return;
      }
      if (toggleZoom) toggleZoom();
    });
    headerActions.append(zoomBtn);
  }
  if (actions.onJump) {
    const btnJump = el(
      "button",
      { class: "btn viewer-action-btn viewer-jump-btn", type: "button", title: "Перейти к сообщению", "aria-label": "Перейти к сообщению" },
      ["↩"]
    );
    btnJump.addEventListener("click", () => actions.onJump && actions.onJump());
    headerActions.append(btnJump);
  }
  if (safeHref) {
    const btnDownload = el(
      "a",
      { class: "btn viewer-action-btn viewer-download-btn", href: safeHref, download: titleText, title: "Скачать", "aria-label": "Скачать" },
      ["↓"]
    );
    headerActions.append(btnDownload);
  }
  headerActions.append(btnClose);

  let authorNode: HTMLElement | null = null;
  if (authorLabel || authorDate) {
    const textNodes: HTMLElement[] = [];
    const titleNodes = [el("span", { class: "viewer-author-name" }, [authorLabel || "—"])];
    if (authorHandle) titleNodes.push(el("span", { class: "viewer-author-handle" }, [authorHandle]));
    textNodes.push(el("div", { class: "viewer-author-title" }, titleNodes));
    if (authorDate) textNodes.push(el("div", { class: "viewer-author-date" }, [authorDate]));
    const textWrap = el("div", { class: "viewer-author-text" }, textNodes);
    const children: HTMLElement[] = [];
    if (authorId) children.push(avatar(authorKind, authorId));
    children.push(textWrap);
    if (authorId) {
      authorNode = el(
        "button",
        { class: "viewer-author", type: "button", "data-action": "user-open", "data-user-id": authorId, title: `Профиль: ${authorLabel || authorId}` },
        children
      );
    } else {
      authorNode = el("div", { class: "viewer-author" }, children);
    }
  }

  const showFileMeta = !isVisual || !authorNode;
  const sizeLabel = Number(size) > 0 ? formatBytes(Number(size) || 0) : "";
  const fileMeta = showFileMeta
    ? el(
        "div",
        { class: "viewer-title-wrap" },
        [el("div", { class: "viewer-title", title: titleText }, [titleText])].concat(
          sizeLabel ? [el("div", { class: "viewer-sub" }, [sizeLabel])] : []
        )
      )
    : null;
  const headerInfoItems = [authorNode, fileMeta].filter((node): node is HTMLElement => Boolean(node));

  const header = el("div", { class: "viewer-header" }, [
    el("div", { class: "viewer-header-info" }, headerInfoItems),
    headerActions,
  ]);

  let body: HTMLElement;
  if (!safeHref) {
    body = el("div", { class: "viewer-empty" }, ["Не удалось открыть файл: небезопасный URL"]);
  } else if (isImage) {
    const img = el("img", { class: "viewer-img", src: safeHref, alt: titleText, decoding: "async" });
    if (toggleZoom) {
      zoomTarget = img;
      const scroll = el("div", { class: "viewer-img-scroll" }, [img]);
      zoomScroll = scroll;
      const toggleAt = (focus?: { x: number; y: number }) => {
        if (!toggleZoom) return;
        const willZoomIn = !box.classList.contains("viewer-zoomed");
        if (willZoomIn) {
          const rect = img.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const w = Math.max(1, Math.round(rect.width * IMAGE_ZOOM_SCALE));
            const h = Math.max(1, Math.round(rect.height * IMAGE_ZOOM_SCALE));
            img.style.maxWidth = "none";
            img.style.maxHeight = "none";
            img.style.width = `${w}px`;
            img.style.height = `${h}px`;

            const fx = focus ? Math.max(0, Math.min(rect.width, focus.x)) : rect.width * 0.5;
            const fy = focus ? Math.max(0, Math.min(rect.height, focus.y)) : rect.height * 0.5;
            window.requestAnimationFrame(() => {
              try {
                const cw = scroll.clientWidth || 0;
                const ch = scroll.clientHeight || 0;
                const left = Math.max(0, Math.round(fx * IMAGE_ZOOM_SCALE - cw * 0.5));
                const top = Math.max(0, Math.round(fy * IMAGE_ZOOM_SCALE - ch * 0.5));
                scroll.scrollLeft = left;
                scroll.scrollTop = top;
              } catch {
                // ignore
              }
            });
          }
        }
        toggleZoom();
      };
      toggleZoomAt = toggleAt;
      img.addEventListener("click", (event) => {
        if (event.detail > 1) return;
        event.preventDefault();
        event.stopPropagation();
        if (box.classList.contains("viewer-zoomed")) {
          toggleAt();
          return;
        }
        const rect = img.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
        toggleAt({ x, y });
      });
      body = el("div", { class: "viewer-media" }, [scroll]);
    } else {
      body = el("div", { class: "viewer-media" }, [img]);
    }
  } else if (isVideo) {
    const video = el("video", {
      class: "viewer-video",
      src: safeHref,
      controls: "true",
      playsinline: "true",
      preload: "metadata",
      "data-allow-audio": "1",
    }) as HTMLVideoElement;
    body = el("div", { class: "viewer-media" }, [video]);
  } else if (isAudio) {
    const audio = el("audio", { class: "viewer-audio", src: safeHref, controls: "true", preload: "metadata" }) as HTMLAudioElement;
    body = el("div", { class: "viewer-media viewer-media-audio" }, [audio]);
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

  const stage = el("div", { class: "viewer-stage" }, [body]);
  if (isVisual) {
    if (actions.onPrev) {
      const btnPrev = el(
        "button",
        { class: "btn viewer-switcher-btn viewer-switcher-btn-prev", type: "button", "aria-label": "Предыдущее медиа", title: "Предыдущее медиа" },
        ["←"]
      );
      btnPrev.addEventListener("click", () => actions.onPrev && actions.onPrev());
      stage.append(el("div", { class: "viewer-switcher viewer-switcher-prev" }, [btnPrev]));
    }
    if (actions.onNext) {
      const btnNext = el(
        "button",
        { class: "btn viewer-switcher-btn viewer-switcher-btn-next", type: "button", "aria-label": "Следующее медиа", title: "Следующее медиа" },
        ["→"]
      );
      btnNext.addEventListener("click", () => actions.onNext && actions.onNext());
      stage.append(el("div", { class: "viewer-switcher viewer-switcher-next" }, [btnNext]));
    }
  }
  const captionNode = captionText
    ? el("div", { class: "viewer-caption" }, [el("div", { class: "viewer-caption-body" }, renderRichText(captionText))])
    : null;

  const nodes: HTMLElement[] = [header, stage];
  if (captionNode) {
    if (isVisual) stage.append(captionNode);
    else nodes.push(captionNode);
  }
  nodes.push(actionsRow);
  box.append(...nodes);
  return box;
}
