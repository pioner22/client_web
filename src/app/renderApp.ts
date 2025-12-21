import type { Layout } from "../components/layout/types";
import type { ActionModalPayload, AppState, PageKind, TargetRef } from "../stores/types";
import { APP_MSG_MAX_LEN } from "../config/app";
import { renderHeader } from "../components/header/renderHeader";
import { renderSidebar } from "../components/sidebar/renderSidebar";
import { renderChat } from "../components/chat/renderChat";
import { renderFooter } from "../components/footer/renderFooter";
import { renderModal } from "../components/modals/renderModal";
import { renderToast } from "../components/toast/renderToast";
import { el } from "../helpers/dom/el";
import { conversationKey } from "../helpers/chat/conversationKey";
import { preserveAuthModalInputs } from "../helpers/auth/preserveAuthModalInputs";
import { createSearchPage, type SearchPage } from "../pages/search/createSearchPage";
import { createProfilePage, type ProfilePage } from "../pages/profile/createProfilePage";
import { createFilesPage, type FilesPage } from "../pages/files/createFilesPage";
import { createHelpPage, type HelpPage } from "../pages/help/createHelpPage";
import { createGroupCreatePage, type CreateGroupPage } from "../pages/create/createGroupCreatePage";
import { createBoardCreatePage, type CreateBoardPage } from "../pages/create/createBoardCreatePage";

let searchPage: SearchPage | null = null;
let profilePage: ProfilePage | null = null;
let filesPage: FilesPage | null = null;
let helpPage: HelpPage | null = null;
let groupCreatePage: CreateGroupPage | null = null;
let boardCreatePage: CreateBoardPage | null = null;
let lastPage: PageKind | null = null;

function mountChat(layout: Layout, node: HTMLElement) {
  if (layout.chat.childNodes.length === 1 && layout.chat.firstChild === node) return;
  layout.chat.replaceChildren(node);
}

export interface RenderActions {
  onSelectTarget: (t: TargetRef) => void;
  onOpenActionModal: (payload: ActionModalPayload) => void;
  onOpenHelp: () => void;
  onOpenGroupCreate: () => void;
  onOpenBoardCreate: () => void;
  onSetPage: (page: PageKind) => void;
  onAuthLogin: () => void;
  onAuthRegister: () => void;
  onAuthModeChange: (mode: "register" | "login") => void;
  onCloseModal: () => void;
  onConfirmModal: () => void;
  onDismissUpdate: () => void;
  onReloadUpdate: () => void;
  onApplyPwaUpdate: () => void;
  onSkinChange: (skinId: string) => void;
  onGroupCreate: () => void;
  onBoardCreate: () => void;
  onMembersAdd: () => void;
  onMembersRemove: () => void;
  onRename: () => void;
  onAuthRequest: (peer: string) => void;
  onAuthAccept: (peer: string) => void;
  onAuthDecline: (peer: string) => void;
  onAuthCancel: (peer: string) => void;
  onGroupJoin: (groupId: string) => void;
  onBoardJoin: (boardId: string) => void;
  onGroupInviteAccept: (groupId: string) => void;
  onGroupInviteDecline: (groupId: string) => void;
  onGroupJoinAccept: (groupId: string, peer: string) => void;
  onGroupJoinDecline: (groupId: string, peer: string) => void;
  onBoardInviteJoin: (boardId: string) => void;
  onBoardInviteDecline: (boardId: string) => void;
  onFileOfferAccept: (fileId: string) => void;
  onFileOfferReject: (fileId: string) => void;
  onFileSend: (file: File | null, target: TargetRef | null) => void;
  onClearCompletedFiles: () => void;
  onSearchQueryChange: (query: string) => void;
  onSearchSubmit: (query: string) => void;
  onProfileDraftChange: (draft: { displayName: string; handle: string }) => void;
  onProfileSave: (draft: { displayName: string; handle: string }) => void;
  onProfileRefresh: () => void;
  onProfileAvatarSelect: (file: File | null) => void;
  onProfileAvatarClear: () => void;
  onContextMenuAction: (itemId: string) => void;
}

export function renderApp(layout: Layout, state: AppState, actions: RenderActions) {
  const pageChanged = state.page !== lastPage;
  lastPage = state.page;

  // Контекстное меню не должно "ломать" макет и прятать composer.
  const chatInputVisible = state.page === "main" && (!state.modal || state.modal.kind === "context_menu");
  layout.inputWrap.classList.toggle("hidden", !chatInputVisible);

  const rawInput = (layout.input.value || state.input || "").toString();
  const sendText = rawInput.trimEnd();
  const sendLen = sendText.length;
  const tooLong = sendLen > APP_MSG_MAX_LEN;
  const nearLimit = sendLen >= APP_MSG_MAX_LEN - 200;

  const countEl = layout.inputWrap.querySelector(".composer-count") as HTMLElement | null;
  if (countEl) countEl.textContent = `${sendLen}/${APP_MSG_MAX_LEN}`;
  layout.inputWrap.classList.toggle("composer-too-long", tooLong);
  layout.inputWrap.classList.toggle("composer-near-limit", nearLimit && !tooLong);

  const sel = state.selected;
  const selectedKey = sel ? conversationKey(sel) : "";
  const editing = state.editing && state.editing.key === selectedKey ? state.editing : null;
  const isBoardReadOnly = (() => {
    if (!chatInputVisible) return false;
    if (!sel || sel.kind !== "board") return false;
    const b = (state.boards || []).find((x) => x.id === sel.id);
    const owner = String(b?.owner_id || "").trim();
    const me = String(state.selfId || "").trim();
    return Boolean(owner && me && owner !== me);
  })();

  let composerDisabledReason: string | null = null;
  if (!chatInputVisible) composerDisabledReason = null;
  else if (state.conn !== "connected") composerDisabledReason = "Нет соединения";
  else if (!state.authed) composerDisabledReason = "Нажмите «Войти», чтобы писать";
  else if (!sel) composerDisabledReason = "Выберите чат слева";
  else if (isBoardReadOnly) composerDisabledReason = "На доске пишет только владелец";

  const composerEnabled = chatInputVisible && composerDisabledReason === null;
  layout.input.disabled = !composerEnabled;
  layout.input.placeholder = composerDisabledReason || (editing ? "Изменить сообщение" : "Сообщение");

  const canSendNow = composerEnabled && Boolean(sel);
  const composerText = sendText.trim();
  layout.sendBtn.disabled = !canSendNow || !composerText || tooLong;
  layout.attachBtn.disabled = !canSendNow || !sel || isBoardReadOnly || Boolean(editing);
  layout.inputWrap.classList.toggle("composer-editing", Boolean(editing));
  layout.sendBtn.setAttribute("aria-label", editing ? "Сохранить" : "Отправить");

  const editBar = layout.inputWrap.querySelector("#composer-edit") as HTMLElement | null;
  const editText = layout.inputWrap.querySelector("#composer-edit-text") as HTMLElement | null;
  if (editBar) {
    editBar.classList.toggle("hidden", !editing);
    if (editing && editText) {
      const conv = selectedKey ? state.conversations[selectedKey] : null;
      const msg = conv ? conv.find((m) => typeof m.id === "number" && m.id === editing.id) : null;
      const preview = String(msg?.text || "").trim() || `#${editing.id}`;
      editText.textContent = preview.length > 140 ? `${preview.slice(0, 137)}…` : preview;
    } else if (editText) {
      editText.textContent = "";
    }
  }

  renderHeader(layout, state);
  const sidebarScrollTop = layout.sidebar.scrollTop;
  const sidebarScrollLeft = layout.sidebar.scrollLeft;
  renderSidebar(
    layout.sidebar,
    state,
    actions.onSelectTarget,
    actions.onOpenActionModal,
    actions.onOpenHelp,
    actions.onOpenGroupCreate,
    actions.onOpenBoardCreate
  );
  if (layout.sidebar.scrollTop !== sidebarScrollTop) layout.sidebar.scrollTop = sidebarScrollTop;
  if (layout.sidebar.scrollLeft !== sidebarScrollLeft) layout.sidebar.scrollLeft = sidebarScrollLeft;

  const prevAuthIdInput = state.modal?.kind === "auth" ? (document.getElementById("auth-id") as HTMLInputElement | null) : null;
  const prevAuthPwInput = state.modal?.kind === "auth" ? (document.getElementById("auth-pw") as HTMLInputElement | null) : null;
  const prevAuthPw1Input = state.modal?.kind === "auth" ? (document.getElementById("auth-pw1") as HTMLInputElement | null) : null;
  const prevAuthPw2Input = state.modal?.kind === "auth" ? (document.getElementById("auth-pw2") as HTMLInputElement | null) : null;
  const prevAuthSkinSelect = state.modal?.kind === "auth" ? (document.getElementById("auth-skin") as HTMLSelectElement | null) : null;
  const prevMembersAddInput = state.modal?.kind === "members_add" ? (document.getElementById("members-add-input") as HTMLInputElement | null) : null;
  const prevMembersAddEntryInput = state.modal?.kind === "members_add" ? (document.getElementById("members-add-entry") as HTMLInputElement | null) : null;
  const prevMembersRemoveInput =
    state.modal?.kind === "members_remove" ? (document.getElementById("members-remove-input") as HTMLInputElement | null) : null;
  const prevRenameInput = state.modal?.kind === "rename" ? (document.getElementById("rename-name") as HTMLInputElement | null) : null;
  const hadAuthModal = Boolean(prevAuthIdInput || prevAuthPwInput || prevAuthPw1Input || prevAuthPw2Input || prevAuthSkinSelect);
  const prevAuthId = prevAuthIdInput?.value ?? "";
  const prevAuthPw = prevAuthPwInput?.value ?? "";
  const prevAuthPw1 = prevAuthPw1Input?.value ?? "";
  const prevAuthPw2 = prevAuthPw2Input?.value ?? "";
  const prevActiveId = (document.activeElement as HTMLElement | null)?.id ?? "";
  const prevMembersAdd = prevMembersAddInput?.value ?? "";
  const prevMembersAddEntry = prevMembersAddEntryInput?.value ?? "";
  const prevMembersRemove = prevMembersRemoveInput?.value ?? "";
  const prevRename = prevRenameInput?.value ?? "";

  const modalNode = state.modal
    ? renderModal(state, {
        onAuthLogin: actions.onAuthLogin,
        onAuthRegister: actions.onAuthRegister,
        onAuthModeChange: actions.onAuthModeChange,
        onClose: actions.onCloseModal,
        onConfirm: actions.onConfirmModal,
        onDismissUpdate: actions.onDismissUpdate,
        onReloadUpdate: actions.onReloadUpdate,
        onApplyPwaUpdate: actions.onApplyPwaUpdate,
        onSkinChange: actions.onSkinChange,
        onMembersAdd: actions.onMembersAdd,
        onMembersRemove: actions.onMembersRemove,
        onRename: actions.onRename,
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
        onContextMenuAction: actions.onContextMenuAction,
      })
    : null;

  const inlineModal = Boolean(state.modal && state.modal.kind !== "context_menu");
  layout.chat.classList.toggle("chat-page", state.page !== "main" || inlineModal);
  if (inlineModal && modalNode) {
    mountChat(
      layout,
      el("div", { class: "page modal-page" }, [modalNode, el("div", { class: "msg msg-sys" }, ["Esc — назад"])])
    );
  } else if (state.page === "main") {
    const prevSearch = layout.chat.querySelector("#chat-search-input") as HTMLInputElement | null;
    const searchHadFocus = Boolean(prevSearch && document.activeElement === prevSearch);
    const searchSelStart = prevSearch?.selectionStart ?? null;
    const searchSelEnd = prevSearch?.selectionEnd ?? null;
    renderChat(layout.chat, state);
    if (state.chatSearchOpen && searchHadFocus) {
      const nextSearch = layout.chat.querySelector("#chat-search-input") as HTMLInputElement | null;
      if (nextSearch) {
        try {
          nextSearch.focus({ preventScroll: true });
        } catch {
          // ignore
        }
        try {
          const len = nextSearch.value.length;
          const start = searchSelStart === null ? len : Math.max(0, Math.min(len, searchSelStart));
          const end = searchSelEnd === null ? len : Math.max(0, Math.min(len, searchSelEnd));
          nextSearch.setSelectionRange(start, end);
        } catch {
          // ignore
        }
      }
    }
  } else if (state.page === "help") {
    if (!helpPage) helpPage = createHelpPage();
    mountChat(layout, helpPage.root);
    helpPage.update(state);
    if (pageChanged) helpPage.focus();
  } else if (state.page === "group_create") {
    if (!groupCreatePage) {
      groupCreatePage = createGroupCreatePage({
        onCreate: actions.onGroupCreate,
        onCancel: () => actions.onSetPage("main"),
      });
    }
    mountChat(layout, groupCreatePage.root);
    groupCreatePage.update(state);
    if (pageChanged) groupCreatePage.focus();
  } else if (state.page === "board_create") {
    if (!boardCreatePage) {
      boardCreatePage = createBoardCreatePage({
        onCreate: actions.onBoardCreate,
        onCancel: () => actions.onSetPage("main"),
      });
    }
    mountChat(layout, boardCreatePage.root);
    boardCreatePage.update(state);
    if (pageChanged) boardCreatePage.focus();
  } else if (state.page === "search") {
    if (!searchPage) {
      searchPage = createSearchPage({
        onQueryChange: actions.onSearchQueryChange,
        onSubmit: actions.onSearchSubmit,
        onSelectTarget: actions.onSelectTarget,
        onAuthRequest: actions.onAuthRequest,
        onAuthAccept: actions.onAuthAccept,
        onAuthDecline: actions.onAuthDecline,
        onAuthCancel: actions.onAuthCancel,
        onGroupJoin: actions.onGroupJoin,
        onBoardJoin: actions.onBoardJoin,
      });
    }
    mountChat(layout, searchPage.root);
    searchPage.update(state);
    if (pageChanged) searchPage.focus();
  } else if (state.page === "profile") {
    if (!profilePage) {
      profilePage = createProfilePage({
        onDraftChange: actions.onProfileDraftChange,
        onSave: actions.onProfileSave,
        onRefresh: actions.onProfileRefresh,
        onSkinChange: actions.onSkinChange,
        onAvatarSelect: actions.onProfileAvatarSelect,
        onAvatarClear: actions.onProfileAvatarClear,
      });
    }
    mountChat(layout, profilePage.root);
    profilePage.update(state);
    if (pageChanged) profilePage.focus();
  } else if (state.page === "files") {
    if (!filesPage) {
      filesPage = createFilesPage({
        onFileSend: actions.onFileSend,
        onFileOfferAccept: actions.onFileOfferAccept,
        onFileOfferReject: actions.onFileOfferReject,
        onClearCompleted: actions.onClearCompletedFiles,
      });
    }
    mountChat(layout, filesPage.root);
    filesPage.update(state);
    if (pageChanged) filesPage.focus();
  }

  renderFooter(layout.footer, state);
  renderToast(layout.toastHost, state.toast);

  if (state.modal?.kind === "context_menu" && modalNode) {
    layout.overlay.classList.remove("hidden");
    layout.overlay.classList.add("overlay-context");
    layout.overlay.replaceChildren(modalNode);
  } else {
    layout.overlay.classList.add("hidden");
    layout.overlay.classList.remove("overlay-context");
    layout.overlay.replaceChildren();
  }

  if (state.modal?.kind === "auth") {
    // Preserve typed credentials across re-renders (e.g. connection status updates, skin list load).
    const idEl = document.getElementById("auth-id") as HTMLInputElement | null;
    const pwEl = document.getElementById("auth-pw") as HTMLInputElement | null;
    const pw1El = document.getElementById("auth-pw1") as HTMLInputElement | null;
    const pw2El = document.getElementById("auth-pw2") as HTMLInputElement | null;
    preserveAuthModalInputs({
      hadAuthModal,
      prev: { id: prevAuthId, pw: prevAuthPw, pw1: prevAuthPw1, pw2: prevAuthPw2 },
      next: { idEl, pwEl, pw1El, pw2El },
    });

    queueMicrotask(() => {
      const id = document.getElementById("auth-id") as HTMLInputElement | null;
      const pw = document.getElementById("auth-pw") as HTMLInputElement | null;
      const pw1 = document.getElementById("auth-pw1") as HTMLInputElement | null;
      const pw2 = document.getElementById("auth-pw2") as HTMLInputElement | null;
      const skin = document.getElementById("auth-skin") as HTMLSelectElement | null;
      if (prevActiveId === "auth-skin" && skin) skin.focus();
      else if (prevActiveId === "auth-pw2" && pw2) pw2.focus();
      else if (prevActiveId === "auth-pw1" && pw1) pw1.focus();
      else if (prevActiveId === "auth-pw" && pw) pw.focus();
      else if (prevActiveId === "auth-id" && id) id.focus();
      else if (!hadAuthModal) {
        if (state.authMode === "register" && pw1) pw1.focus();
        else if (state.authMode === "login") {
          if (id && !id.value) id.focus();
          else if (pw) pw.focus();
          else if (id) id.focus();
        } else if (id) {
          id.focus();
        }
      }
    });
  }

  if (state.modal?.kind === "members_add") {
    const input = document.getElementById("members-add-input") as HTMLInputElement | null;
    const entry = document.getElementById("members-add-entry") as HTMLInputElement | null;
    if (input && input.value !== prevMembersAdd) input.value = prevMembersAdd;
    if (entry && entry.value !== prevMembersAddEntry) entry.value = prevMembersAddEntry;
    queueMicrotask(() => {
      if (entry) entry.focus();
    });
  }

  if (state.modal?.kind === "members_remove") {
    const input = document.getElementById("members-remove-input") as HTMLInputElement | null;
    if (input && input.value !== prevMembersRemove) input.value = prevMembersRemove;
    queueMicrotask(() => {
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  if (state.modal?.kind === "rename") {
    const input = document.getElementById("rename-name") as HTMLInputElement | null;
    if (input && input.value !== prevRename) input.value = prevRename;
    queueMicrotask(() => {
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  if (state.modal?.kind === "confirm") {
    queueMicrotask(() => {
      const host = inlineModal ? layout.chat : layout.overlay;
      const btn = host.querySelector(".modal .btn") as HTMLButtonElement | null;
      if (btn) btn.focus();
    });
  }

  if (state.modal?.kind === "action") {
    queueMicrotask(() => {
      const host = inlineModal ? layout.chat : layout.overlay;
      const btn = host.querySelector(".modal .btn") as HTMLButtonElement | null;
      if (btn) btn.focus();
    });
  }
}
