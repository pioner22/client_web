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
import { safeUrl } from "../../helpers/security/safeUrl";
import { renderInviteUserModal } from "./renderInviteUserModal";
import { renderActionModal } from "./renderActionModal";
import { renderContextMenu } from "./renderContextMenu";
import { renderBoardPostModal } from "./renderBoardPostModal";
import { renderSendScheduleModal } from "./renderSendScheduleModal";
import { renderForwardModal } from "./renderForwardModal";
import { renderReactionsModal } from "./renderReactionsModal";
import { isMessageContinuation } from "../../helpers/chat/messageGrouping";
import { renderCallModal } from "./renderCallModal";

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
  onSendScheduleWhenOnline: () => void;
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
  onFileViewerShare: () => void;
  onFileViewerForward: () => void;
  onFileViewerDelete: () => void;
  onFileViewerOpenAt: (msgIdx: number) => void;
  onForwardSend: (targets: TargetRef[]) => void;
}

export function renderModal(state: AppState, actions: ModalActions): HTMLElement | null {
  const modal = state.modal;
  if (!modal) return null;
  const kind = modal.kind;
  if (kind === "call") {
    return renderCallModal(state, modal, {
      onHangup: actions.onClose,
      onOpenExternal: (url) => {
        try {
          window.open(url, "_blank", "noopener,noreferrer");
        } catch {
          // ignore
        }
      },
    });
  }
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
  if (kind === "reactions") {
    return renderReactionsModal(state, modal, { onClose: actions.onClose });
  }
  if (kind === "send_schedule") {
    const canWhenOnline = (() => {
      const t = modal.target;
      if (modal.edit) return false;
      if (!t || t.kind !== "dm") return false;
      const peerId = String(t.id || "").trim();
      if (!peerId) return false;
      const friend = (state.friends || []).find((f) => String(f.id || "").trim() === peerId);
      return Boolean(friend && !friend.online);
    })();
    return renderSendScheduleModal(modal.text, modal.suggestedAt, modal.message, modal.title, modal.confirmLabel, {
      onSchedule: actions.onSendSchedule,
      ...(canWhenOnline ? { onWhenOnline: actions.onSendScheduleWhenOnline } : {}),
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
    const metaBase = buildFileViewerMeta(state, modal);
    const base = typeof location !== "undefined" ? location.href : "http://localhost/";
    const viewerMessage = (() => {
      const chatKey = modal.chatKey ? String(modal.chatKey) : "";
      const msgIdx = typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx) ? Math.trunc(modal.msgIdx) : null;
      if (!chatKey || msgIdx === null) return null;
      const conv = state.conversations[chatKey] || [];
      if (msgIdx < 0 || msgIdx >= conv.length) return null;
      const msg = conv[msgIdx];
      if (!msg || msg.kind === "sys") return null;
      return { chatKey, msgIdx, msg };
    })();
    const posterUrl = (() => {
      if (!viewerMessage) return null;
      const att = viewerMessage.msg?.attachment;
      if (!att || att.kind !== "file") return null;
      const fileId = String(att.fileId || "").trim();
      if (!fileId) return null;
      const raw = state.fileThumbs?.[fileId]?.url ? state.fileThumbs[fileId].url : null;
      if (!raw) return null;
      return safeUrl(raw, { base, allowedProtocols: ["http:", "https:", "blob:"] });
    })();
    const rail = (() => {
      if (!viewerMessage) return [];
      const conv = state.conversations[viewerMessage.chatKey] || [];
      const isMedia = (msg: any): "image" | "video" | null => {
        const att = msg?.attachment;
        if (!att || att.kind !== "file") return null;
        const mt = String(att.mime || "").toLowerCase();
        if (mt.startsWith("image/")) return "image";
        if (mt.startsWith("video/")) return "video";
        const n = String(att.name || "").toLowerCase();
        if (/\.(png|jpe?g|gif|webp|bmp|ico|svg|heic|heif)$/.test(n)) return "image";
        if (/\.(mp4|m4v|mov|webm|ogv|mkv|avi|3gp|3g2)$/.test(n)) return "video";
        return null;
      };
      const isAlbumCandidate = (idx: number): boolean => {
        const msg = conv[idx];
        const kind = isMedia(msg);
        if (!msg || !kind) return false;
        const text = String(msg.text || "").trim();
        if (text && !text.startsWith("[file]")) return false;
        return true;
      };
      const buildItem = (idx: number) => {
        const msg = conv[idx];
        const kind = isMedia(msg);
        if (!msg || !kind) return null;
        const att = msg.attachment;
        if (!att || att.kind !== "file") return null;
        const name = String(att.name || "файл");
        const fileId = att.fileId ? String(att.fileId) : "";
        const thumbRaw = fileId && state.fileThumbs?.[fileId]?.url ? state.fileThumbs[fileId].url : null;
        const transferUrl =
          fileId && state.fileTransfers?.length
            ? state.fileTransfers.find((t) => String(t.id || "").trim() === fileId && Boolean(t.url))?.url || null
            : null;
        const thumbUrl = thumbRaw
          ? safeUrl(thumbRaw, { base, allowedProtocols: ["http:", "https:", "blob:"] })
          : kind === "image" && transferUrl
            ? safeUrl(transferUrl, { base, allowedProtocols: ["http:", "https:", "blob:"] })
            : null;
        return { msgIdx: idx, name, kind, thumbUrl, active: idx === viewerMessage.msgIdx };
      };

      const albumIndices = (() => {
        const ALBUM_MAX = 12;
        const ALBUM_GAP_SECONDS = 121;
        const idx = viewerMessage.msgIdx;
        if (!isAlbumCandidate(idx)) return null;
        const out: number[] = [idx];
        for (let i = idx - 1; i >= 0 && out.length < ALBUM_MAX; i -= 1) {
          if (!isAlbumCandidate(i)) break;
          if (!isMessageContinuation(conv[i], conv[i + 1], { maxGapSeconds: ALBUM_GAP_SECONDS })) break;
          out.unshift(i);
        }
        for (let i = idx + 1; i < conv.length && out.length < ALBUM_MAX; i += 1) {
          if (!isAlbumCandidate(i)) break;
          if (!isMessageContinuation(conv[i - 1], conv[i], { maxGapSeconds: ALBUM_GAP_SECONDS })) break;
          out.push(i);
        }
        return out.length >= 2 ? out : null;
      })();

      if (albumIndices) {
        return albumIndices.map((idx) => buildItem(idx)).filter((x): x is NonNullable<ReturnType<typeof buildItem>> => Boolean(x));
      }
      const before: Array<NonNullable<ReturnType<typeof buildItem>>> = [];
      const after: Array<NonNullable<ReturnType<typeof buildItem>>> = [];
      for (let i = viewerMessage.msgIdx - 1; i >= 0 && before.length < 4; i -= 1) {
        const item = buildItem(i);
        if (item) before.unshift(item);
      }
      for (let i = viewerMessage.msgIdx + 1; i < conv.length && after.length < 4; i += 1) {
        const item = buildItem(i);
        if (item) after.push(item);
      }
      const cur = buildItem(viewerMessage.msgIdx);
      if (!cur) return [];
      return [...before, cur, ...after];
    })();
    const meta: FileViewerMeta | null = (() => {
      if (!rail.length) return metaBase;
      const base = metaBase ? metaBase : {};
      return { ...base, rail };
    })();
    const canForward = Boolean(viewerMessage && !state.editing);
    const canDelete = (() => {
      if (!viewerMessage) return false;
      const msg = viewerMessage.msg;
      const msgId = typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : 0;
      const canAct = state.conn === "connected" && state.authed;
      const canOwner = Boolean(msg.kind === "out" && state.selfId && String(msg.from) === String(state.selfId));
      return Boolean(canAct && canOwner && msgId > 0);
    })();
    return renderFileViewerModal(
      modal.url,
      modal.name,
      modal.size,
      modal.mime,
      modal.caption ?? null,
      meta,
      {
        onClose: actions.onClose,
        ...(canPrev ? { onPrev: () => actions.onFileViewerNavigate("prev") } : {}),
        ...(canNext ? { onNext: () => actions.onFileViewerNavigate("next") } : {}),
        ...(canJump ? { onJump: () => actions.onFileViewerJump() } : {}),
        ...(actions.onFileViewerShare ? { onShare: () => actions.onFileViewerShare() } : {}),
        ...(viewerMessage ? { onForward: () => actions.onFileViewerForward(), canForward } : {}),
        ...(canDelete ? { onDelete: () => actions.onFileViewerDelete(), canDelete } : {}),
        ...(viewerMessage ? { onOpenAt: (msgIdx: number) => actions.onFileViewerOpenAt(msgIdx) } : {}),
      },
      { autoplay: Boolean(modal.autoplay), posterUrl }
    );
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
