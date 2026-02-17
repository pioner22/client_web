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
  rail?: Array<{ msgIdx: number; name: string; kind: "image" | "video"; thumbUrl: string | null; active?: boolean }>;
}

export interface FileViewerModalActions {
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onJump?: () => void;
  onRecover?: () => void;
  onShare?: () => void;
  onForward?: () => void;
  onDelete?: () => void;
  onOpenAt?: (msgIdx: number) => void;
  canShare?: boolean;
  canForward?: boolean;
  canDelete?: boolean;
}

export interface FileViewerModalOptions {
  autoplay?: boolean;
  posterUrl?: string | null;
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

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg|heic|heif)$/;
const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|ogv|mkv|avi|3gp|3g2)$/;
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/;

function isImageFile(name: string, mime?: string | null): boolean {
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

function isVideoFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("video/")) return true;
  if (mt.startsWith("image/") || mt.startsWith("audio/")) return false;
  const n = normalizeFileName(name);
  if (!n) return false;
  if (VIDEO_EXT_RE.test(n)) return true;
  if (IMAGE_EXT_RE.test(n) || AUDIO_EXT_RE.test(n)) return false;
  return VIDEO_NAME_HINT_RE.test(n);
}

function isAudioFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("audio/")) return true;
  if (mt.startsWith("image/") || mt.startsWith("video/")) return false;
  const n = normalizeFileName(name);
  if (!n) return false;
  if (AUDIO_EXT_RE.test(n)) return true;
  if (IMAGE_EXT_RE.test(n) || VIDEO_EXT_RE.test(n)) return false;
  return AUDIO_NAME_HINT_RE.test(n);
}

export function renderFileViewerModal(
  url: string,
  name: string,
  size: number,
  mime: string | null | undefined,
  caption: string | null | undefined,
  meta: FileViewerMeta | null | undefined,
  actions: FileViewerModalActions,
  opts?: FileViewerModalOptions | null
): HTMLElement {
  const safeHref = safeUrl(url, { base: window.location.href, allowedProtocols: ["http:", "https:", "blob:"] });
  const titleText = String(name || "файл");
  const captionRaw = caption ? String(caption).trim() : "";
  const captionText = captionRaw && !captionRaw.startsWith("[file]") ? captionRaw : "";
  const isImage = isImageFile(titleText, mime);
  const isVideo = isVideoFile(titleText, mime);
  const isAudio = isAudioFile(titleText, mime);
  const isVisual = isImage || isVideo;
  const shouldAutoplay = Boolean(isVideo && opts?.autoplay);
  const posterRaw = isVideo ? String(opts?.posterUrl || "").trim() : "";
  const posterUrl = posterRaw ? safeUrl(posterRaw, { base: window.location.href, allowedProtocols: ["http:", "https:", "blob:"] }) : null;

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

  const IMAGE_ZOOM_DEFAULT_SCALE = 2;
  const IMAGE_ZOOM_MAX_SCALE = 4;
  const IMAGE_ZOOM_STEP = 0.5;

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
  let zoomTarget: HTMLImageElement | null = null;
  let zoomScroll: HTMLElement | null = null;
  let zoomScale = 1;
  let zoomBaseW = 0;
  let zoomBaseH = 0;
  let suppressImageClickUntil = 0;
  let setZoom: ((nextScale: number, focus?: { x: number; y: number } | null) => void) | null = null;
  let imageEl: HTMLImageElement | null = null;
  let videoEl: HTMLVideoElement | null = null;
  if (isImage) {
    const zoomBtnOut = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-zoom-btn viewer-zoom-out",
        type: "button",
        title: "Уменьшить",
        "aria-label": "Уменьшить",
      },
      ["−"]
    );
    const zoomBtn = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-zoom-btn viewer-zoom-level",
        type: "button",
        title: "Увеличить",
        "aria-label": "Увеличить",
      },
      ["100%"]
    );
    const zoomBtnIn = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-zoom-btn viewer-zoom-in",
        type: "button",
        title: "Увеличить",
        "aria-label": "Увеличить",
      },
      ["+"]
    );

    const clampZoom = (raw: number): number => {
      const v = Number(raw ?? 1);
      if (!Number.isFinite(v)) return 1;
      const rounded = Math.round((Math.max(1, Math.min(IMAGE_ZOOM_MAX_SCALE, v)) / IMAGE_ZOOM_STEP)) * IMAGE_ZOOM_STEP;
      return Math.max(1, Math.min(IMAGE_ZOOM_MAX_SCALE, rounded));
    };
    const zoomLabel = (scale: number): string => `${Math.round(scale * 100)}%`;

    const updateZoomUi = () => {
      const zoomed = zoomScale > 1;
      box.classList.toggle("viewer-zoomed", zoomed);
      zoomBtn.textContent = zoomLabel(zoomScale);
      zoomBtn.title = zoomed ? "Сбросить масштаб" : "Увеличить";
      zoomBtn.setAttribute("aria-label", zoomed ? "Сбросить масштаб" : "Увеличить");
      (zoomBtnOut as HTMLButtonElement).disabled = zoomScale <= 1;
      (zoomBtnIn as HTMLButtonElement).disabled = zoomScale >= IMAGE_ZOOM_MAX_SCALE;
    };

    const doSetZoom = (nextScale: number, focus?: { x: number; y: number } | null) => {
      const img = zoomTarget;
      const scroll = zoomScroll;
      if (!img || !scroll) return;
      const next = clampZoom(nextScale);
      const prevScale = zoomScale;
      const prevZoomed = prevScale > 1;
      const nextZoomed = next > 1;
      if (!nextZoomed) {
        zoomScale = 1;
        updateZoomUi();
        img.style.removeProperty("width");
        img.style.removeProperty("height");
        img.style.removeProperty("max-width");
        img.style.removeProperty("max-height");
        zoomBaseW = 0;
        zoomBaseH = 0;
        try {
          scroll.scrollLeft = 0;
          scroll.scrollTop = 0;
        } catch {
          // ignore
        }
        return;
      }

      let baseW = zoomBaseW;
      let baseH = zoomBaseH;
      if (!prevZoomed || !baseW || !baseH) {
        const rect = img.getBoundingClientRect();
        baseW = rect.width > 0 ? rect.width : 0;
        baseH = rect.height > 0 ? rect.height : 0;
      }
      if (!baseW || !baseH) return;

      const cw = scroll.clientWidth || 0;
      const ch = scroll.clientHeight || 0;
      const baseFocus = (() => {
        if (focus && Number.isFinite(focus.x) && Number.isFinite(focus.y)) {
          const x = Math.max(0, Math.min(baseW, focus.x));
          const y = Math.max(0, Math.min(baseH, focus.y));
          return { x, y };
        }
        if (prevZoomed) {
          const x = Math.max(0, (scroll.scrollLeft + cw * 0.5) / Math.max(1, prevScale));
          const y = Math.max(0, (scroll.scrollTop + ch * 0.5) / Math.max(1, prevScale));
          return { x: Math.min(baseW, x), y: Math.min(baseH, y) };
        }
        return { x: baseW * 0.5, y: baseH * 0.5 };
      })();

      zoomBaseW = baseW;
      zoomBaseH = baseH;
      zoomScale = next;
      updateZoomUi();
      img.style.maxWidth = "none";
      img.style.maxHeight = "none";
      img.style.width = `${Math.max(1, Math.round(baseW * zoomScale))}px`;
      img.style.height = `${Math.max(1, Math.round(baseH * zoomScale))}px`;

      window.requestAnimationFrame(() => {
        try {
          const cw2 = scroll.clientWidth || 0;
          const ch2 = scroll.clientHeight || 0;
          scroll.scrollLeft = Math.max(0, Math.round(baseFocus.x * zoomScale - cw2 * 0.5));
          scroll.scrollTop = Math.max(0, Math.round(baseFocus.y * zoomScale - ch2 * 0.5));
        } catch {
          // ignore
        }
      });
    };

    setZoom = doSetZoom;

    zoomBtnOut.addEventListener("click", () => doSetZoom(zoomScale - IMAGE_ZOOM_STEP, null));
    zoomBtnIn.addEventListener("click", () => doSetZoom(zoomScale + IMAGE_ZOOM_STEP, null));
    zoomBtn.addEventListener("click", () => doSetZoom(zoomScale > 1 ? 1 : IMAGE_ZOOM_DEFAULT_SCALE, null));

    headerActions.append(zoomBtnOut, zoomBtn, zoomBtnIn);
    updateZoomUi();
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
  if (actions.onForward) {
    const btnForward = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-forward-btn",
        type: "button",
        title: "Переслать",
        "aria-label": "Переслать",
      },
      ["↪"]
    ) as HTMLButtonElement;
    btnForward.disabled = actions.canForward === false;
    btnForward.addEventListener("click", () => actions.onForward && actions.onForward());
    headerActions.append(btnForward);
  }
  if (actions.onDelete) {
    const btnDelete = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-delete-btn",
        type: "button",
        title: "Удалить",
        "aria-label": "Удалить",
      },
      ["🗑️"]
    ) as HTMLButtonElement;
    btnDelete.disabled = actions.canDelete === false;
    btnDelete.addEventListener("click", () => actions.onDelete && actions.onDelete());
    headerActions.append(btnDelete);
  }
  if (actions.onShare) {
    const btnShare = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-share-btn",
        type: "button",
        title: "Поделиться",
        "aria-label": "Поделиться",
      },
      ["⤴"]
    ) as HTMLButtonElement;
    btnShare.disabled = actions.canShare === false;
    btnShare.addEventListener("click", () => actions.onShare && actions.onShare());
    headerActions.append(btnShare);
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
    const img = el("img", { class: "viewer-img", src: safeHref, alt: titleText, decoding: "async" }) as HTMLImageElement;
    imageEl = img;
    zoomTarget = img;
    const scroll = el("div", { class: "viewer-img-scroll" }, [img]);
    zoomScroll = scroll;
    const preloaderText = el("div", { class: "viewer-preloader-text" }, ["Загрузка…"]);
    const preloaderRetryBtn = actions.onRecover
      ? (el("button", { class: "btn viewer-preloader-retry", type: "button" }, ["Попробовать ещё раз"]) as HTMLButtonElement)
      : null;
    if (preloaderRetryBtn) {
      preloaderRetryBtn.addEventListener("click", () => actions.onRecover && actions.onRecover());
    }
    const preloaderActions = preloaderRetryBtn ? el("div", { class: "viewer-preloader-actions" }, [preloaderRetryBtn]) : null;
    const preloader = el("div", { class: "viewer-preloader", "aria-live": "polite" }, [
      el("div", { class: "viewer-preloader-spinner", "aria-hidden": "true" }, [""]),
      preloaderText,
      ...(preloaderActions ? [preloaderActions] : []),
    ]);
    let panActive = false;
    let panMoved = false;
    let pinchActive = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartLeft = 0;
    let panStartTop = 0;
    let panPointerId: number | null = null;
    const touchPoints = new Map<number, { x: number; y: number }>();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    img.addEventListener("click", (event) => {
      if (Date.now() < suppressImageClickUntil) return;
      if (event.detail > 1) return;
      if (!setZoom) return;
      event.preventDefault();
      event.stopPropagation();
      if (zoomScale > 1) {
        setZoom(1, null);
        return;
      }
      const rect = img.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      setZoom(IMAGE_ZOOM_DEFAULT_SCALE, { x, y });
    });
    scroll.addEventListener("pointerdown", (e) => {
      const ev = e as PointerEvent;
      const pt = ev.pointerType;
      const isMouse = pt === "mouse";
      const isTouch = pt === "touch";
      const isPen = pt === "pen";
      if (!isMouse && !isTouch && !isPen) return;
      if (isMouse && !box.classList.contains("viewer-zoomed")) return;
      if (isMouse && ev.button !== 0) return;
      if (isTouch || isPen) {
        touchPoints.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (touchPoints.size >= 2) {
          pinchActive = true;
          panActive = false;
          panPointerId = null;
          const pts = Array.from(touchPoints.values()).slice(0, 2);
          const dx = pts[0].x - pts[1].x;
          const dy = pts[0].y - pts[1].y;
          pinchStartDist = Math.hypot(dx, dy);
          pinchStartScale = zoomScale;
        } else if (box.classList.contains("viewer-zoomed")) {
          pinchActive = false;
          panActive = true;
          panPointerId = ev.pointerId;
          panMoved = false;
          panStartX = ev.clientX;
          panStartY = ev.clientY;
          panStartLeft = scroll.scrollLeft;
          panStartTop = scroll.scrollTop;
        } else {
          pinchActive = false;
          panActive = false;
          panPointerId = null;
        }
      } else {
        pinchActive = false;
        panActive = true;
        panPointerId = ev.pointerId;
        panMoved = false;
        panStartX = ev.clientX;
        panStartY = ev.clientY;
        panStartLeft = scroll.scrollLeft;
        panStartTop = scroll.scrollTop;
      }
      if (panActive || pinchActive) scroll.classList.add("viewer-panning");
      try {
        scroll.setPointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
      if (panActive || pinchActive) e.preventDefault();
    });
    scroll.addEventListener("pointermove", (e) => {
      const ev = e as PointerEvent;
      if (ev.pointerType === "touch" || ev.pointerType === "pen") {
        if (touchPoints.has(ev.pointerId)) touchPoints.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pinchActive && touchPoints.size >= 2 && setZoom) {
          const pts = Array.from(touchPoints.values()).slice(0, 2);
          const dx = pts[0].x - pts[1].x;
          const dy = pts[0].y - pts[1].y;
          const dist = Math.hypot(dx, dy);
          if (pinchStartDist > 0 && dist > 0) {
            const mx = (pts[0].x + pts[1].x) * 0.5;
            const my = (pts[0].y + pts[1].y) * 0.5;
            const rect = img.getBoundingClientRect();
            const relX = mx - rect.left;
            const relY = my - rect.top;
            const baseX = relX / Math.max(1, zoomScale);
            const baseY = relY / Math.max(1, zoomScale);
            const nextScale = pinchStartScale * (dist / pinchStartDist);
            setZoom(nextScale, { x: baseX, y: baseY });
            suppressImageClickUntil = Date.now() + 500;
          }
          e.preventDefault();
          return;
        }
      }
      if (!panActive) return;
      if (panPointerId !== null && ev.pointerId !== panPointerId) return;
      const dx = ev.clientX - panStartX;
      const dy = ev.clientY - panStartY;
      if (!panMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) panMoved = true;
      try {
        scroll.scrollLeft = Math.max(0, Math.round(panStartLeft - dx));
        scroll.scrollTop = Math.max(0, Math.round(panStartTop - dy));
      } catch {
        // ignore
      }
      if (panMoved) e.preventDefault();
    });
    const stopPan = (e?: Event) => {
      if (!panActive && !pinchActive && !touchPoints.size) return;
      const wasPinch = pinchActive;
      if (e && ((e as PointerEvent).pointerType === "touch" || (e as PointerEvent).pointerType === "pen")) {
        const ev = e as PointerEvent;
        touchPoints.delete(ev.pointerId);
      }
      if (pinchActive && touchPoints.size >= 2) {
        if (e) e.preventDefault();
        return;
      }
      pinchActive = false;
      pinchStartDist = 0;
      pinchStartScale = zoomScale;
      if (wasPinch && touchPoints.size === 1 && box.classList.contains("viewer-zoomed")) {
        const [id, pt] = Array.from(touchPoints.entries())[0];
        panActive = true;
        panPointerId = id;
        panMoved = false;
        panStartX = pt.x;
        panStartY = pt.y;
        panStartLeft = scroll.scrollLeft;
        panStartTop = scroll.scrollTop;
        scroll.classList.add("viewer-panning");
        if (e) e.preventDefault();
        return;
      }
      panActive = false;
      panPointerId = null;
      scroll.classList.remove("viewer-panning");
      if (panMoved) suppressImageClickUntil = Date.now() + 400;
      if (e) e.preventDefault();
    };
    scroll.addEventListener("pointerup", (e) => stopPan(e));
    scroll.addEventListener("pointercancel", (e) => stopPan(e));
    img.addEventListener(
      "load",
      () => {
        preloader.classList.add("hidden");
      },
      { once: true }
    );
    img.addEventListener(
      "error",
      () => {
        preloader.classList.add("viewer-preloader-failed");
        const canRecover = Boolean(actions.onRecover);
        preloaderText.textContent = canRecover ? "Не удалось загрузить. Пробуем восстановить…" : "Не удалось загрузить";
        if (actions.onRecover) {
          try {
            actions.onRecover();
          } catch {
            // ignore
          }
        }
      },
      { once: true }
    );
    body = el("div", { class: "viewer-media viewer-media-image" }, [scroll, preloader]);
  } else if (isVideo) {
    const video = el("video", {
      class: "viewer-video",
      src: safeHref,
      controls: "true",
      playsinline: "true",
      preload: shouldAutoplay ? "auto" : "metadata",
      ...(posterUrl ? { poster: posterUrl } : {}),
      ...(shouldAutoplay ? { autoplay: "true" } : {}),
      "data-allow-audio": "1",
    }) as HTMLVideoElement;
    videoEl = video;
    if (shouldAutoplay) {
      const attemptPlay = (muted: boolean) => {
        try {
          video.muted = muted;
          if (muted) {
            video.defaultMuted = true;
            video.setAttribute("muted", "true");
          } else {
            video.defaultMuted = false;
            video.removeAttribute("muted");
          }
          const p = video.play();
          if (p && typeof (p as Promise<void>).catch === "function") {
            void (p as Promise<void>).catch(() => {
              if (!muted) attemptPlay(true);
            });
          }
        } catch {
          if (!muted) attemptPlay(true);
        }
      };
      attemptPlay(false);
    }
    video.addEventListener(
      "error",
      () => {
        if (!actions.onRecover) return;
        try {
          actions.onRecover();
        } catch {
          // ignore
        }
      },
      { once: true }
    );
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
  const railItems = (meta?.rail || []).filter((x) => x && Number.isFinite(x.msgIdx) && (x.kind === "image" || x.kind === "video"));
  if (isVisual && actions.onOpenAt && railItems.length > 1) {
    box.classList.add("viewer-has-rail");
    const railButtons = railItems.map((item) => {
      const thumbUrl = item.thumbUrl ? safeUrl(item.thumbUrl, { base: window.location.href, allowedProtocols: ["http:", "https:", "blob:"] }) : null;
      const classes = ["viewer-rail-item"];
      if (item.active) classes.push("active");
      if (item.kind === "video") classes.push("viewer-rail-item-video");
      const btn = el(
        "button",
        {
          class: classes.join(" "),
          type: "button",
          title: item.name,
          "aria-label": `Открыть: ${item.name}`,
        },
        [
          thumbUrl
            ? el("img", { class: "viewer-rail-thumb", src: thumbUrl, alt: "", loading: "lazy", decoding: "async" })
            : el("div", { class: "viewer-rail-thumb viewer-rail-thumb-empty", "aria-hidden": "true" }, [item.kind === "video" ? "Видео" : "Фото"]),
          item.kind === "video" ? el("div", { class: "viewer-rail-video-badge", "aria-hidden": "true" }, ["▶"]) : "",
        ]
      ) as HTMLButtonElement;
      btn.disabled = Boolean(item.active);
      btn.addEventListener("click", () => {
        if (item.active) return;
        actions.onOpenAt && actions.onOpenAt(item.msgIdx);
      });
      return btn;
    });
    stage.append(el("div", { class: "viewer-rail" }, railButtons));
  }
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

  if (isVisual) {
    const measureBottomUi = () => {
      const railEl = stage.querySelector(".viewer-rail") as HTMLElement | null;
      const captionEl = stage.querySelector(".viewer-caption") as HTMLElement | null;
      const railH = railEl ? railEl.getBoundingClientRect().height : 0;
      const capH = captionEl ? captionEl.getBoundingClientRect().height : 0;
      const total = Math.max(0, Math.ceil(railH + capH));
      box.style.setProperty("--viewer-bottom-ui-h", `${total}px`);
    };

    const scheduleMeasure = (connectAttempt = 0, reflowAttempt = 0) => {
      if (!box.isConnected) {
        if (connectAttempt < 12) {
          try {
            window.requestAnimationFrame(() => scheduleMeasure(connectAttempt + 1, reflowAttempt));
          } catch {
            scheduleMeasure(connectAttempt + 1, reflowAttempt);
          }
        }
        return;
      }
      measureBottomUi();
      if (reflowAttempt < 4) {
        try {
          window.requestAnimationFrame(() => scheduleMeasure(connectAttempt, reflowAttempt + 1));
        } catch {
          scheduleMeasure(connectAttempt, reflowAttempt + 1);
        }
      }
    };

    try {
      window.requestAnimationFrame(() => scheduleMeasure());
    } catch {
      scheduleMeasure();
    }

    imageEl?.addEventListener("load", () => scheduleMeasure(), { once: true });
    videoEl?.addEventListener("loadedmetadata", () => scheduleMeasure(), { once: true });
  }

  return box;
}
