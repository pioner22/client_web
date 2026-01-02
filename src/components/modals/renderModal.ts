import type { AppState } from "../../stores/types";
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
import { renderInviteUserModal } from "./renderInviteUserModal";
import { renderActionModal } from "./renderActionModal";
import { renderContextMenu } from "./renderContextMenu";
import { renderBoardPostModal } from "./renderBoardPostModal";

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
    return renderFileViewerModal(modal.url, modal.name, modal.size, modal.mime, modal.caption ?? null, {
      onClose: actions.onClose,
      ...(canPrev ? { onPrev: () => actions.onFileViewerNavigate("prev") } : {}),
      ...(canNext ? { onNext: () => actions.onFileViewerNavigate("next") } : {}),
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
