import type { AppState } from "../../../stores/types";

export type FullScreenModalKind = "auth" | "welcome" | "logout" | "update" | "pwa_update";
export type OverlaySurface = "overlay-auth" | "overlay-context" | "overlay-viewer";
export type OverlayBackdropAction = "none" | "consume" | "close";

export interface ModalPresentation {
  fullScreenKind: FullScreenModalKind | null;
  fullScreenActive: boolean;
  authModalVisible: boolean;
  inlineModal: boolean;
  overlaySurface: OverlaySurface | null;
}

type ModalStateLike = Pick<AppState, "authed" | "modal">;

export function resolveModalPresentation(state: ModalStateLike): ModalPresentation {
  const authOnly = !state.authed;
  const modalKind = state.modal?.kind ?? null;
  const fullScreenKind =
    modalKind === "welcome" ||
    modalKind === "logout" ||
    modalKind === "update" ||
    modalKind === "pwa_update" ||
    modalKind === "auth"
      ? modalKind
      : authOnly
        ? "auth"
        : null;

  let overlaySurface: OverlaySurface | null = null;
  if (fullScreenKind) overlaySurface = "overlay-auth";
  else if (modalKind === "context_menu") overlaySurface = "overlay-context";
  else if (modalKind === "file_viewer" || modalKind === "call") overlaySurface = "overlay-viewer";

  return {
    fullScreenKind,
    fullScreenActive: Boolean(fullScreenKind),
    authModalVisible: fullScreenKind === "auth",
    inlineModal: Boolean(state.modal && !overlaySurface),
    overlaySurface,
  };
}

export function resolveOverlayBackdropAction(modal: AppState["modal"] | null | undefined, nowMs = Date.now()): OverlayBackdropAction {
  if (!modal) return "none";
  if (modal.kind === "context_menu") return "close";
  if (modal.kind !== "file_viewer") return "none";

  const openedAt = typeof modal.openedAtMs === "number" && Number.isFinite(modal.openedAtMs) ? modal.openedAtMs : 0;
  if (openedAt > 0) {
    const age = nowMs - openedAt;
    if (age >= 0 && age < 420) return "consume";
  }
  return "close";
}

export function applyOverlaySurface(overlay: HTMLElement, surface: OverlaySurface | null, modalNode: HTMLElement | null) {
  const nextNode = surface && modalNode ? modalNode : null;
  const hasOverlay = Boolean(nextNode);
  overlay.classList.toggle("hidden", !hasOverlay);
  overlay.classList.toggle("overlay-context", hasOverlay && surface === "overlay-context");
  overlay.classList.toggle(
    "overlay-context-sheet",
    hasOverlay && surface === "overlay-context" && Boolean(nextNode?.classList.contains("ctx-menu-sheet"))
  );
  overlay.classList.toggle("overlay-viewer", hasOverlay && surface === "overlay-viewer");
  overlay.classList.toggle("overlay-auth", hasOverlay && surface === "overlay-auth");

  if (!nextNode) {
    overlay.replaceChildren();
    return;
  }

  if (overlay.firstElementChild !== nextNode) {
    overlay.replaceChildren(nextNode);
  }
}
