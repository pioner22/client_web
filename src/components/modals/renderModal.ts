import type { AppState, TargetRef } from "../../stores/types";
import { renderAuthModal } from "./renderAuthModal";
import { renderUpdateModal } from "./renderUpdateModal";
import { renderPwaUpdateModal } from "./renderPwaUpdateModal";
import { renderWelcomeModal } from "./renderWelcomeModal";
import { renderLogoutModal } from "./renderLogoutModal";
import { renderMembersAddModal } from "./renderMembersAddModal";
import { renderMembersRemoveModal } from "./renderMembersRemoveModal";
import { renderRenameModal } from "./renderRenameModal";
import { renderConfirmModal } from "./renderConfirmModal";
import { renderFileSendModal } from "./renderFileSendModal";
import { renderFileViewerModal } from "./renderFileViewerModal";
import type { FileViewerMeta } from "./renderFileViewerModal";
import { renderInviteUserModal } from "./renderInviteUserModal";
import { renderActionModal } from "./renderActionModal";
import { renderContextMenu } from "./renderContextMenu";
import { renderBoardPostModal } from "./renderBoardPostModal";
import { renderSendScheduleModal } from "./renderSendScheduleModal";
import { renderForwardModal } from "./renderForwardModal";

function formatUserLabel(displayName: string, handle: string, fallback: string): string {
  const dn = String(displayName || "").trim();
  if (dn) return dn;
  const h = String(handle || "").trim();
  if (h) return h.startsWith("@") ? h : `@${h}`;
  return fallback || "—";
}

function normalizeHandle(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function resolveUserLabel(state: AppState, id: string): { label: string; handle: string } {
  const pid = String(id || "").trim();
  if (!pid) return { label: "—", handle: "" };
  const p = state.profiles?.[pid];
  if (p) {
    return {
      label: formatUserLabel(p.display_name || "", p.handle || "", pid),
      handle: normalizeHandle(String(p.handle || "")),
    };
  }
  const friend = (state.friends || []).find((f) => f.id === pid);
  if (friend) {
    return {
      label: formatUserLabel(friend.display_name || "", friend.handle || "", pid),
      handle: normalizeHandle(String(friend.handle || "")),
    };
  }
  return { label: pid, handle: "" };
}

function buildFileViewerMeta(state: AppState, modal: Extract<AppState["modal"], { kind: "file_viewer" }>): FileViewerMeta | null {
  const chatKey = modal.chatKey ? String(modal.chatKey) : "";
  const msgIdx = typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx) ? Math.trunc(modal.msgIdx) : null;
  if (!chatKey || msgIdx === null) return null;
  const conv = state.conversations[chatKey] || [];
  if (msgIdx < 0 || msgIdx >= conv.length) return null;
  const msg = conv[msgIdx];
  if (!msg || msg.kind === "sys") return null;
  const authorId = String((msg.kind === "out" ? state.selfId || msg.from : msg.from) || "").trim();
  if (!authorId) return null;
  const identity = resolveUserLabel(state, authorId);
  const ts = Number(msg.ts);
  return {
    authorId,
    authorLabel: identity.label,
    authorHandle: identity.handle,
    authorKind: "dm",
    timestamp: Number.isFinite(ts) ? ts : null,
  };
}

export interface ModalActions {
  onAuthLogin: () => void;
  onAuthRegister: () => void;
  onAuthModeChange: (mode: "register" | "login") => void;
  onClose: () => void;
  onConfirm: () => void;
  onBoardPostPublish: (text: string) => void;
  onDismissUpdate: () => void;
  onReloadUpdate: () => void;
  onApplyPwaUpdate: () => void;
  onSkinChange: (skinId: string) => void;
  onMembersAdd: () => void;
  onMembersRemove: () => void;
  onRename: () => void;
  onSendSchedule: () => void;
  onInviteUser: () => void;
  onFileSendConfirm: (captionText: string) => void;
  onAuthAccept: (peer: string) => void;
  onAuthDecline: (peer: string) => void;
  onAuthCancel: (peer: string) => void;
  onGroupInviteAccept: (groupId: string) => void;
  onGroupInviteDecline: (groupId: string) => void;
  onGroupJoinAccept: (groupId: string, peer: string) => void;
  onGroupJoinDecline: (groupId: string, peer: string) => void;
  onBoardInviteJoin: (boardId: string) => void;
  onBoardInviteDecline: (boardId: string) => void;
  onFileOfferAccept: (fileId: string) => void;
  onFileOfferReject: (fileId: string) => void;
  onContextMenuAction: (itemId: string) => void;
  onFileViewerNavigate: (dir: "prev" | "next") => void;
  onFileViewerJump: () => void;
  onForwardSend: (targets: TargetRef[]) => void;
}

export function renderModal(state: AppState, actions: ModalActions): HTMLElement | null {
  const modal = state.modal;
  if (!modal) return null;
  const kind = modal.kind;
  if (kind === "auth") {
    return renderAuthModal(state.authMode, state.authRememberedId, modal.message, state.skins, state.skin, {
      onLogin: actions.onAuthLogin,
      onRegister: actions.onAuthRegister,
      onModeChange: actions.onAuthModeChange,
      onSkinChange: actions.onSkinChange,
      onClose: actions.onClose,
    });
  }
  if (kind === "welcome") {
    return renderWelcomeModal(state.status);
  }
  if (kind === "logout") {
    return renderLogoutModal(state.status, { onClose: actions.onClose });
  }
  if (kind === "update") {
    return renderUpdateModal(state.clientVersion, state.updateLatest ?? "", {
      onDismiss: actions.onDismissUpdate,
      onReload: actions.onReloadUpdate,
    });
  }
  if (kind === "pwa_update") {
    return renderPwaUpdateModal(state.clientVersion, {
      onDismiss: actions.onClose,
      onApply: actions.onApplyPwaUpdate,
    });
  }
  if (kind === "send_schedule") {
    return renderSendScheduleModal(modal.text, modal.suggestedAt, modal.message, modal.title, modal.confirmLabel, {
      onSchedule: actions.onSendSchedule,
      onCancel: actions.onClose,
    });
  }
  if (kind === "forward_select") {
    const drafts =
      Array.isArray(modal.forwardDrafts) && modal.forwardDrafts.length
        ? modal.forwardDrafts
        : modal.forwardDraft
          ? [modal.forwardDraft]
          : [];
    if (!drafts.length) return null;
    return renderForwardModal(drafts, state.friends || [], state.groups || [], state.boards || [], state.profiles || {}, modal.message, {
      onSend: actions.onForwardSend,
      onCancel: actions.onClose,
    });
  }
  if (kind === "board_post") {
    const bid = String(modal.boardId || "").trim();
    const b = bid ? (state.boards || []).find((x) => x.id === bid) : null;
    const label = String(b?.name || bid || "—");
    return renderBoardPostModal(label, {
      onPublish: actions.onBoardPostPublish,
      onCancel: actions.onClose,
    });
  }
  if (kind === "members_add") {
    return renderMembersAddModal(modal.title, modal.targetKind, modal.message, {
      onAdd: actions.onMembersAdd,
      onCancel: actions.onClose,
    });
  }
  if (kind === "members_remove") {
    return renderMembersRemoveModal(modal.title, modal.targetKind, modal.message, {
      onRemove: actions.onMembersRemove,
      onCancel: actions.onClose,
    });
  }
  if (kind === "rename") {
    return renderRenameModal(modal.title, modal.targetKind, modal.currentName, modal.message, {
      onRename: actions.onRename,
      onCancel: actions.onClose,
    });
  }
  if (kind === "confirm") {
    return renderConfirmModal(modal.title, modal.message, modal.confirmLabel, modal.cancelLabel, modal.danger, {
      onConfirm: actions.onConfirm,
      onCancel: actions.onClose,
    });
  }
  if (kind === "file_send") {
    return renderFileSendModal(modal.files, modal.caption ?? "", { previewUrls: modal.previewUrls, captionDisabled: modal.captionDisabled, captionHint: modal.captionHint }, {
      onSend: actions.onFileSendConfirm,
      onCancel: actions.onClose,
    });
  }
  if (kind === "file_viewer") {
    const canPrev = typeof modal.prevIdx === "number" && Number.isFinite(modal.prevIdx);
    const canNext = typeof modal.nextIdx === "number" && Number.isFinite(modal.nextIdx);
    const canJump = Boolean(modal.chatKey && typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx));
    const meta = buildFileViewerMeta(state, modal);
    return renderFileViewerModal(modal.url, modal.name, modal.size, modal.mime, modal.caption ?? null, meta, {
      onClose: actions.onClose,
      ...(canPrev ? { onPrev: () => actions.onFileViewerNavigate("prev") } : {}),
      ...(canNext ? { onNext: () => actions.onFileViewerNavigate("next") } : {}),
      ...(canJump ? { onJump: () => actions.onFileViewerJump() } : {}),
    });
  }
  if (kind === "invite_user") {
    return renderInviteUserModal(modal.peer, state.selfId ?? null, state.groups || [], state.boards || [], modal.message, {
      onInvite: actions.onInviteUser,
      onCancel: actions.onClose,
    });
  }
  if (kind === "action") {
    return renderActionModal(modal.payload, modal.message, {
      onClose: actions.onClose,
      onAuthAccept: actions.onAuthAccept,
      onAuthDecline: actions.onAuthDecline,
      onAuthCancel: actions.onAuthCancel,
      onGroupInviteAccept: actions.onGroupInviteAccept,
      onGroupInviteDecline: actions.onGroupInviteDecline,
      onGroupJoinAccept: actions.onGroupJoinAccept,
      onGroupJoinDecline: actions.onGroupJoinDecline,
      onBoardInviteJoin: actions.onBoardInviteJoin,
      onBoardInviteDecline: actions.onBoardInviteDecline,
      onFileOfferAccept: actions.onFileOfferAccept,
      onFileOfferReject: actions.onFileOfferReject,
    });
  }
  if (kind === "context_menu") {
    return renderContextMenu(modal.payload, {
      onClose: actions.onClose,
      onSelect: actions.onContextMenuAction,
    });
  }
  return null;
}
