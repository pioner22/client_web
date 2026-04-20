import { el } from "../../helpers/dom/el";
import type { ChatVisualPreviewOptions, FileAttachmentInfo } from "./chatVisualPreviewShared";
import { isVideoNoteName } from "./chatVisualPreviewShared";

type ChatVisualPreviewModule = typeof import("./chatVisualPreviewSurface");

type RenderDeferredVisualPreviewOptions = {
  info: FileAttachmentInfo;
  opts?: ChatVisualPreviewOptions;
};

type RenderDeferredVisualPreviewSurfaceCtx = RenderDeferredVisualPreviewOptions & {
  mount: HTMLButtonElement;
};

let visualPreviewModule: ChatVisualPreviewModule | null = null;
let visualPreviewPromise: Promise<ChatVisualPreviewModule> | null = null;

function canRenderMount(mount: HTMLElement | null): mount is HTMLButtonElement {
  if (!mount) return false;
  return (mount as HTMLElement & { isConnected?: boolean }).isConnected !== false;
}

function ensureVisualPreviewModule() {
  if (visualPreviewModule) return Promise.resolve(visualPreviewModule);
  if (visualPreviewPromise) return visualPreviewPromise;
  visualPreviewPromise = import("./chatVisualPreviewSurface")
    .then((mod: ChatVisualPreviewModule) => {
      visualPreviewModule = mod;
      return mod;
    })
    .finally(() => {
      if (visualPreviewModule) visualPreviewPromise = null;
    });
  return visualPreviewPromise;
}

function renderPlaceholderProgress(info: FileAttachmentInfo): HTMLElement | null {
  const transfer = info.transfer;
  if (!transfer || (transfer.status !== "uploading" && transfer.status !== "downloading")) return null;
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

function renderDeferredVisualPlaceholder(options: RenderDeferredVisualPreviewOptions): HTMLButtonElement | null {
  const { info, opts } = options;
  if (!info.isImage && !info.isVideo) return null;
  const fixedAspect = Boolean(opts?.className && opts.className.split(/\s+/).includes("chat-file-preview-album"));
  const videoNote = Boolean(info.isVideo && !fixedAspect && isVideoNoteName(info.name));
  const previewUrl = info.isImage ? info.thumbUrl || info.url : info.thumbUrl;
  if (!previewUrl && !info.fileId) return null;

  const classes = info.isImage
    ? previewUrl
      ? ["chat-file-preview"]
      : ["chat-file-preview", "chat-file-preview-empty"]
    : previewUrl
      ? ["chat-file-preview", "chat-file-preview-video"]
      : ["chat-file-preview", "chat-file-preview-video", "chat-file-preview-empty"];
  if (opts?.className) classes.push(opts.className);
  if (videoNote) classes.push("chat-file-preview-video-note");

  const attrs: Record<string, string | undefined> = {
    class: classes.join(" "),
    type: "button",
    "data-action": "open-file-viewer",
    "data-file-kind": info.isImage ? "image" : "video",
    "data-name": info.name,
    "data-size": String(info.size || 0),
    ...(fixedAspect ? { "data-media-fixed": "1" } : {}),
    "aria-label": `Открыть: ${info.name}`,
  };
  const progressOverlay = renderPlaceholderProgress(info);
  if (progressOverlay) attrs["data-media-progress"] = "1";
  if (info.transfer?.localId) attrs["data-local-id"] = info.transfer.localId;
  if (info.url) attrs["data-url"] = info.url;
  if (info.fileId) attrs["data-file-id"] = info.fileId;
  if (info.mime) attrs["data-mime"] = info.mime;
  if (opts?.msgIdx !== undefined) attrs["data-msg-idx"] = String(opts.msgIdx);
  if (opts?.caption) attrs["data-caption"] = opts.caption;

  const child =
    previewUrl
      ? el("img", { class: "chat-file-img", src: previewUrl, alt: info.name, loading: "lazy", decoding: "async" })
      : el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, [info.isImage ? "Фото" : "Видео"]);
  const children: HTMLElement[] = [child];
  if (info.isVideo && !progressOverlay) {
    children.push(el("span", { class: "chat-file-video-toggle", "aria-hidden": "true" }, [""]));
  }
  if (progressOverlay) children.push(progressOverlay);
  const mount = el("button", attrs, children) as HTMLButtonElement;

  if (!fixedAspect) {
    if (videoNote) mount.style.aspectRatio = "1 / 1";
    else if (info.thumbW && info.thumbH) mount.style.aspectRatio = String(info.thumbW / info.thumbH);
    else if (info.mediaW && info.mediaH) mount.style.aspectRatio = String(info.mediaW / info.mediaH);
  }

  return mount;
}

export function renderDeferredVisualPreview(options: RenderDeferredVisualPreviewOptions): HTMLButtonElement | null {
  const mount = renderDeferredVisualPlaceholder(options);
  if (!mount) return null;
  const ctx: RenderDeferredVisualPreviewSurfaceCtx = { mount, ...options };
  if (visualPreviewModule) {
    visualPreviewModule.renderDeferredVisualPreviewSurface(ctx);
    return mount;
  }
  void ensureVisualPreviewModule()
    .then((mod) => {
      if (!canRenderMount(mount)) return;
      mod.renderDeferredVisualPreviewSurface(ctx);
    })
    .catch(() => {
      // Keep the lightweight placeholder if the deferred preview surface fails to load.
    });
  return mount;
}
