import { el } from "../../helpers/dom/el";
import { getCachedMediaAspectRatio } from "../../helpers/chat/mediaAspectCache";
import { getCachedLocalMediaAspectRatio } from "../../helpers/chat/localMediaAspectCache";
import type { FileTransferEntry } from "../../stores/types";
import { type ChatVisualPreviewOptions, type FileAttachmentInfo, isVideoNoteName } from "./chatVisualPreviewShared";

type RenderDeferredVisualPreviewSurfaceCtx = {
  mount: HTMLButtonElement;
  info: FileAttachmentInfo;
  opts?: ChatVisualPreviewOptions;
};

function resolveKnownPreviewAspectRatio(info: FileAttachmentInfo): number | null {
  const previewRatio =
    info.thumbW && info.thumbH ? info.thumbW / info.thumbH : info.mediaW && info.mediaH ? info.mediaW / info.mediaH : null;
  const cachedRatio = info.fileId ? getCachedMediaAspectRatio(info.fileId) : null;
  const cachedLocalRatio = !cachedRatio && info.transfer?.localId ? getCachedLocalMediaAspectRatio(info.transfer.localId) : null;
  // Server-provided thumb/media geometry is more stable for inline video previews than
  // runtime video metadata, especially for rotated mobile MP4 files on desktop engines.
  const ratio = info.isVideo ? previewRatio ?? cachedRatio ?? cachedLocalRatio : cachedRatio ?? cachedLocalRatio ?? previewRatio;
  if (typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0) return ratio;
  return null;
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

export function renderImagePreviewButton(info: FileAttachmentInfo, opts?: ChatVisualPreviewOptions): HTMLButtonElement | null {
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
    const ratio = resolveKnownPreviewAspectRatio(info);
    if (ratio) btn.style.aspectRatio = String(ratio);
  }
  return btn;
}

export function renderVideoPreviewButton(info: FileAttachmentInfo, opts?: ChatVisualPreviewOptions): HTMLButtonElement | null {
  if (!info.isVideo) return null;
  const fixedAspect = Boolean(opts?.className && opts.className.split(/\s+/).includes("chat-file-preview-album"));
  const videoNote = !fixedAspect && isVideoNoteName(info.name);
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
  if (videoNote) classes.push("chat-file-preview-video-note");
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
    if (videoNote) {
      btn.style.aspectRatio = "1 / 1";
    } else {
      const ratio = resolveKnownPreviewAspectRatio(info);
      if (ratio) btn.style.aspectRatio = String(ratio);
    }
  }
  return btn;
}

function getMountChildren(node: HTMLButtonElement): Array<Node | HTMLElement> {
  if (Array.isArray((node as any)._children)) return [...(node as any)._children];
  if ("childNodes" in node && node.childNodes) return Array.from(node.childNodes);
  return [];
}

function syncPreviewMount(mount: HTMLButtonElement, finalNode: HTMLButtonElement) {
  mount.className = finalNode.className;
  const attrNames = [
    "type",
    "data-action",
    "data-file-kind",
    "data-name",
    "data-size",
    "data-media-fixed",
    "data-video-state",
    "data-media-progress",
    "data-url",
    "data-file-id",
    "data-mime",
    "data-msg-idx",
    "data-caption",
    "data-local-id",
    "aria-label",
  ];
  for (const name of attrNames) {
    const value = finalNode.getAttribute(name);
    if (value === null) {
      try {
        mount.removeAttribute(name);
      } catch {
        // ignore stub limitations
      }
      continue;
    }
    mount.setAttribute(name, value);
  }
  mount.replaceChildren(...getMountChildren(finalNode));
  (mount.style as any).aspectRatio = (finalNode.style as any).aspectRatio || (mount.style as any).aspectRatio || "";
}

export function renderDeferredVisualPreviewSurface(ctx: RenderDeferredVisualPreviewSurfaceCtx) {
  const finalNode = ctx.info.isImage ? renderImagePreviewButton(ctx.info, ctx.opts) : renderVideoPreviewButton(ctx.info, ctx.opts);
  if (!finalNode) {
    ctx.mount.replaceChildren();
    return;
  }
  syncPreviewMount(ctx.mount, finalNode);
}
