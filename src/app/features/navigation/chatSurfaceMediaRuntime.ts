import type { ChatSurfaceDeferredDeps } from "./chatSurfaceEventsFeature";
import { recoverFromLazyImportError } from "../../bootstrap/lazyImportRecovery";

type ChatSurfaceMediaModule = typeof import("./chatSurfaceMediaActions");
type ChatSurfaceMediaActions = ReturnType<ChatSurfaceMediaModule["createChatSurfaceMediaActions"]>;

function stopEvent(event: MouseEvent): void {
  try {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  } catch {
    // ignore
  }
}

export function createLazyChatSurfaceMediaRuntime(deps: ChatSurfaceDeferredDeps) {
  let runtime: ChatSurfaceMediaActions | null = null;
  let runtimePromise: Promise<ChatSurfaceMediaActions | null> | null = null;

  const ensureRuntime = async (): Promise<ChatSurfaceMediaActions | null> => {
    if (runtime) return runtime;
    if (runtimePromise) return runtimePromise;
    runtimePromise = import("./chatSurfaceMediaActions")
      .then((mod) => {
        runtime = mod.createChatSurfaceMediaActions(deps);
        return runtime;
      })
      .catch((err) => {
        recoverFromLazyImportError(err, "chat_surface_media");
        return null;
      })
      .finally(() => {
        if (!runtime) runtimePromise = null;
      });
    return runtimePromise;
  };

  const maybeHandleChatClick = (event: MouseEvent, target: HTMLElement | null): boolean => {
    const voicePlayBtn = target?.closest("button.chat-voice-play") as HTMLButtonElement | null;
    if (voicePlayBtn) {
      const wrap = voicePlayBtn.closest("div.chat-voice") as HTMLElement | null;
      const placeholder = Boolean(wrap?.classList.contains("chat-voice-placeholder"));
      const fileId = String(wrap?.getAttribute("data-file-id") || "").trim();
      if (wrap && placeholder && fileId) {
        stopEvent(event);
        void ensureRuntime().then((loaded) => {
          loaded?.handleVoicePlaceholderClick(voicePlayBtn, wrap);
        });
        return true;
      }
    }

    const mediaToggle = target?.closest("[data-action='media-toggle']") as HTMLElement | null;
    if (mediaToggle) {
      const preview = mediaToggle.closest("button.chat-file-preview") as HTMLButtonElement | null;
      const video = preview?.querySelector("video.chat-file-video") as HTMLVideoElement | null;
      if (preview && video) {
        stopEvent(event);
        void ensureRuntime().then((loaded) => {
          loaded?.handleMediaToggleClick(preview, video);
        });
        return true;
      }
    }

    const viewBtn = target?.closest("button[data-action='open-file-viewer']") as HTMLButtonElement | null;
    if (viewBtn) {
      const url = String(viewBtn.getAttribute("data-url") || "").trim();
      const fileId = String(viewBtn.getAttribute("data-file-id") || "").trim();
      if (url || fileId) {
        stopEvent(event);
        void ensureRuntime().then((loaded) => {
          loaded?.handleOpenFileViewerClick(viewBtn);
        });
        return true;
      }
    }

    return false;
  };

  return {
    maybeHandleChatClick,
  };
}
