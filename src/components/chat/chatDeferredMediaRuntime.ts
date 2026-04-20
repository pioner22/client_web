import { el } from "../../helpers/dom/el";
import type { AppState } from "../../stores/types";
import type { AlbumItem } from "./renderChatHelpers";

type ChatDeferredMediaModule = typeof import("./chatDeferredMediaSurface");

export type RenderDeferredVoicePlayerOptions = {
  url: string | null;
  fileId?: string | null;
  name?: string | null;
  size?: number | null;
  mime?: string | null;
  msgIdx?: number | null;
};

export type RenderDeferredAlbumLineOptions = {
  state: AppState;
  items: AlbumItem[];
  friendLabels?: Map<string, string>;
  opts?: {
    selectionMode?: boolean;
    selected?: boolean;
    partial?: boolean;
    groupStartIdx?: number;
    groupEndIdx?: number;
    albumLayout?: { maxWidth: number; minWidth: number; spacing: number };
  };
};

type RenderDeferredVoicePlayerCtx = {
  mount: HTMLElement;
  opts: RenderDeferredVoicePlayerOptions;
};

type RenderDeferredAlbumLineCtx = RenderDeferredAlbumLineOptions & {
  mount: HTMLElement;
};

let deferredMediaModule: ChatDeferredMediaModule | null = null;
let deferredMediaPromise: Promise<ChatDeferredMediaModule> | null = null;
let deferredMediaLoadFailed = false;

function canRenderMount(mount: HTMLElement | null): mount is HTMLElement {
  if (!mount) return false;
  return (mount as HTMLElement & { isConnected?: boolean }).isConnected !== false;
}

function ensureDeferredMediaModule() {
  if (deferredMediaModule) return Promise.resolve(deferredMediaModule);
  if (deferredMediaPromise) return deferredMediaPromise;
  deferredMediaPromise = import("./chatDeferredMediaSurface")
    .then((mod: ChatDeferredMediaModule) => {
      deferredMediaModule = mod;
      deferredMediaLoadFailed = false;
      return mod;
    })
    .catch((err) => {
      deferredMediaLoadFailed = true;
      deferredMediaPromise = null;
      throw err;
    })
    .finally(() => {
      if (deferredMediaModule) deferredMediaPromise = null;
    });
  return deferredMediaPromise;
}

function renderDeferredVoicePlaceholder(opts: RenderDeferredVoicePlayerOptions, message: string) {
  const track = el("button", { class: "btn chat-voice-track", type: "button", "aria-label": "Перемотка", disabled: "true" }, [
    el("span", { class: "chat-voice-progress", "aria-hidden": "true" }, [""]),
  ]);
  const wrap = el(
    "div",
    {
      class: "chat-voice chat-voice-placeholder chat-voice-loading",
      "data-voice-state": "paused",
      role: "status",
      "aria-live": "polite",
    },
    [
      el("button", { class: "btn chat-voice-play", type: "button", "aria-label": message, disabled: "true" }, [""]),
      track,
      el("div", { class: "chat-voice-time" }, ["—"]),
    ]
  );
  wrap.style.setProperty("--voice-progress", "0%");
  if (String(opts.fileId || "").trim()) {
    wrap.setAttribute("data-file-kind", "audio");
    wrap.setAttribute("data-file-id", String(opts.fileId || "").trim());
  }
  return wrap;
}

function renderDeferredAlbumPlaceholder(kind: string, message: string) {
  return [
    el("div", { class: "msg-avatar" }, [el("span", { class: "avatar avatar-skel", "aria-hidden": "true" }, [""])]),
    el("div", { class: "msg-body" }, [
      el("div", { class: "chat-album-surface chat-album-surface-loading", role: "status", "aria-live": "polite", "aria-busy": "true" }, [
        el("div", { class: `msg msg-${kind} msg-sys chat-album-loading-text` }, [message]),
      ]),
    ]),
  ];
}

export function renderDeferredVoicePlayer(opts: RenderDeferredVoicePlayerOptions): HTMLElement {
  const mount = el("div", { class: "chat-deferred-media-mount chat-deferred-voice-mount" });
  const ctx: RenderDeferredVoicePlayerCtx = { mount, opts };
  if (deferredMediaModule) {
    deferredMediaModule.renderDeferredVoicePlayerSurface(ctx);
    return mount;
  }
  mount.replaceChildren(
    renderDeferredVoicePlaceholder(opts, deferredMediaLoadFailed ? "Не удалось загрузить аудио" : "Загрузка аудио...")
  );
  void ensureDeferredMediaModule()
    .then((mod) => {
      if (!canRenderMount(mount)) return;
      mod.renderDeferredVoicePlayerSurface(ctx);
    })
    .catch(() => {
      if (!canRenderMount(mount)) return;
      mount.replaceChildren(renderDeferredVoicePlaceholder(opts, "Не удалось загрузить аудио"));
    });
  return mount;
}

export function renderDeferredAlbumLine(options: RenderDeferredAlbumLineOptions): HTMLElement {
  const first = options.items[0];
  const kind = String(first?.msg?.kind || "in");
  const mount = el("div", { class: `msg msg-${kind} msg-attach msg-album msg-album-loading` });
  const ctx: RenderDeferredAlbumLineCtx = { mount, ...options };
  if (deferredMediaModule) {
    deferredMediaModule.renderDeferredAlbumLineSurface(ctx);
    return mount;
  }
  mount.replaceChildren(
    ...renderDeferredAlbumPlaceholder(kind, deferredMediaLoadFailed ? "Не удалось загрузить альбом" : "Загрузка альбома...")
  );
  void ensureDeferredMediaModule()
    .then((mod) => {
      if (!canRenderMount(mount)) return;
      mod.renderDeferredAlbumLineSurface(ctx);
    })
    .catch(() => {
      if (!canRenderMount(mount)) return;
      mount.replaceChildren(...renderDeferredAlbumPlaceholder(kind, "Не удалось загрузить альбом"));
    });
  return mount;
}
