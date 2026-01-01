import type { Layout } from "../components/layout/types";
import type {
  ActionModalPayload,
  AppState,
  ContactSortMode,
  MessageViewMode,
  MobileSidebarTab,
  PageKind,
  SearchResultEntry,
  TargetRef,
  ThemeMode,
} from "../stores/types";
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
import { focusElement } from "../helpers/ui/focus";
import { isIOS } from "../helpers/ui/iosInputAssistant";
import { isMobileLikeUi } from "../helpers/ui/mobileLike";
import { maxBoardScheduleDelayMs } from "../helpers/boards/boardSchedule";
import { createSearchPage, type SearchPage } from "../pages/search/createSearchPage";
import { createProfilePage, type ProfilePage } from "../pages/profile/createProfilePage";
import { createUserPage, type UserPage } from "../pages/user/createUserPage";
import { createRoomPage, type RoomPage } from "../pages/room/createRoomPage";
import { createFilesPage, type FilesPage } from "../pages/files/createFilesPage";
import { createHelpPage, type HelpPage } from "../pages/help/createHelpPage";
import { createGroupCreatePage, type CreateGroupPage } from "../pages/create/createGroupCreatePage";
import { createBoardCreatePage, type CreateBoardPage } from "../pages/create/createBoardCreatePage";

let searchPage: SearchPage | null = null;
let profilePage: ProfilePage | null = null;
let userPage: UserPage | null = null;
let groupPage: RoomPage | null = null;
let boardPage: RoomPage | null = null;
let filesPage: FilesPage | null = null;
let helpPage: HelpPage | null = null;
let groupCreatePage: CreateGroupPage | null = null;
let boardCreatePage: CreateBoardPage | null = null;
let lastPage: PageKind | null = null;
let rightUserPage: UserPage | null = null;
let rightGroupPage: RoomPage | null = null;
let rightBoardPage: RoomPage | null = null;
let rightPanelShell: HTMLElement | null = null;
let rightPanelTitleEl: HTMLElement | null = null;
let rightPanelBodyEl: HTMLElement | null = null;

function formatDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

function parseDatetimeLocal(value: string): number | null {
  const v = String(value || "").trim();
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mon = Number(m[2]);
  const day = Number(m[3]);
  const h = Number(m[4]);
  const min = Number(m[5]);
  if (!Number.isFinite(y) || !Number.isFinite(mon) || !Number.isFinite(day) || !Number.isFinite(h) || !Number.isFinite(min)) return null;
  const d = new Date(y, mon - 1, day, h, min, 0, 0);
  const ts = d.getTime();
  return Number.isFinite(ts) ? ts : null;
}

function formatSenderLabel(state: AppState, senderId: string): string {
  const id = String(senderId || "").trim();
  if (!id) return "";
  if (String(state.selfId || "") === id) return "Я";
  const friend = state.friends.find((f) => f.id === id);
  const profile = state.profiles?.[id];
  const displayName = String(friend?.display_name || profile?.display_name || "").trim();
  const handleRaw = String(friend?.handle || profile?.handle || "").trim();
  const handle = handleRaw ? (handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`) : "";
  if (displayName) return displayName;
  if (handle) return handle;
  return id;
}

function mountChat(layout: Layout, node: HTMLElement) {
  if (layout.chatHost.childNodes.length === 1 && layout.chatHost.firstChild === node) return;
  layout.chatHost.replaceChildren(node);
}

function mountRightCol(layout: Layout, node: HTMLElement) {
  if (layout.rightCol.childNodes.length === 1 && layout.rightCol.firstChild === node) return;
  layout.rightCol.replaceChildren(node);
}

function ensureRightPanelShell(actions: RenderActions): { shell: HTMLElement; title: HTMLElement; body: HTMLElement } {
  if (rightPanelShell && rightPanelTitleEl && rightPanelBodyEl) {
    return { shell: rightPanelShell, title: rightPanelTitleEl, body: rightPanelBodyEl };
  }
  const title = el("div", { class: "right-col-title" }, [""]);
  const closeBtn = el(
    "button",
    { class: "btn right-col-close", type: "button", "aria-label": "Закрыть панель", "data-action": "right-col-close" },
    ["×"]
  ) as HTMLButtonElement;
  closeBtn.addEventListener("click", () => actions.onCloseRightPanel());
  const head = el("div", { class: "right-col-head" }, [title, closeBtn]);
  const body = el("div", { class: "right-col-body" }, []);
  const shell = el("div", { class: "right-col-shell" }, [head, body]);
  rightPanelShell = shell;
  rightPanelTitleEl = title;
  rightPanelBodyEl = body;
  return { shell, title, body };
}

export interface RenderActions {
  onSelectTarget: (t: TargetRef) => void;
  onOpenUser: (id: string) => void;
  onRoomMemberRemove: (kind: TargetRef["kind"], roomId: string, memberId: string) => void;
  onBlockToggle: (memberId: string) => void;
  onRoomWriteToggle: (kind: TargetRef["kind"], roomId: string, memberId: string, value: boolean) => void;
  onRoomRefresh: (kind: TargetRef["kind"], roomId: string) => void;
  onRoomInfoSave: (kind: TargetRef["kind"], roomId: string, description: string, rules: string) => void;
  onRoomLeave: (kind: TargetRef["kind"], roomId: string) => void;
  onRoomDisband: (kind: TargetRef["kind"], roomId: string) => void;
  onCloseRightPanel: () => void;
  onOpenActionModal: (payload: ActionModalPayload) => void;
  onOpenHelp: () => void;
  onOpenGroupCreate: () => void;
  onOpenBoardCreate: () => void;
  onSetPage: (page: PageKind) => void;
  onSetMobileSidebarTab: (tab: MobileSidebarTab) => void;
  onSetSidebarQuery: (query: string) => void;
  onContactSortChange: (mode: ContactSortMode) => void;
  onAuthLogin: () => void;
  onAuthRegister: () => void;
  onAuthModeChange: (mode: "register" | "login") => void;
  onAuthOpen: () => void;
  onAuthLogout: () => void;
  onCloseModal: () => void;
  onConfirmModal: () => void;
  onDismissUpdate: () => void;
  onReloadUpdate: () => void;
  onApplyPwaUpdate: () => void;
  onSkinChange: (skinId: string) => void;
  onThemeChange: (theme: ThemeMode) => void;
  onMessageViewChange: (view: MessageViewMode) => void;
  onGroupCreate: () => void;
  onBoardCreate: () => void;
  onMembersAdd: () => void;
  onMembersRemove: () => void;
  onRename: () => void;
  onInviteUser: () => void;
  onAuthRequest: (peer: string) => void;
  onAuthAccept: (peer: string) => void;
  onAuthDecline: (peer: string) => void;
  onAuthCancel: (peer: string) => void;
  onGroupJoin: (groupId: string) => void;
  onBoardJoin: (boardId: string) => void;
  onOpenHistoryHit: (t: TargetRef, query: string, msgIdx?: number) => void;
  onSearchHistoryDelete: (items: Array<{ target: TargetRef; idx: number }>, mode: "local" | "remote") => void;
  onSearchHistoryForward: (items: Array<{ target: TargetRef; idx: number }>) => void;
  onSearchServerForward: (items: SearchResultEntry[]) => void;
  onGroupInviteAccept: (groupId: string) => void;
  onGroupInviteDecline: (groupId: string) => void;
  onGroupJoinAccept: (groupId: string, peer: string) => void;
  onGroupJoinDecline: (groupId: string, peer: string) => void;
  onBoardInviteJoin: (boardId: string) => void;
  onBoardInviteDecline: (boardId: string) => void;
  onFileOfferAccept: (fileId: string) => void;
  onFileOfferReject: (fileId: string) => void;
  onFileSendConfirm: (captionText: string) => void;
  onFileSend: (file: File | null, target: TargetRef | null) => void;
  onClearCompletedFiles: () => void;
  onSearchQueryChange: (query: string) => void;
  onSearchSubmit: (query: string) => void;
  onBoardPostPublish: (text: string) => void;
  onProfileDraftChange: (draft: { displayName: string; handle: string; bio: string; status: string }) => void;
  onProfileSave: (draft: { displayName: string; handle: string; bio: string; status: string }) => void;
  onProfileRefresh: () => void;
  onProfileAvatarSelect: (file: File | null) => void;
  onProfileAvatarClear: () => void;
  onPushEnable: () => void;
  onPushDisable: () => void;
  onNotifyInAppEnable: () => void;
  onNotifyInAppDisable: () => void;
  onNotifySoundEnable: () => void;
  onNotifySoundDisable: () => void;
  onForcePwaUpdate: () => void;
  onContextMenuAction: (itemId: string) => void;
  onFileViewerNavigate: (dir: "prev" | "next") => void;
}

export function renderApp(layout: Layout, state: AppState, actions: RenderActions) {
  const pageChanged = state.page !== lastPage;
  lastPage = state.page;

  // Контекстное меню не должно "ломать" макет и прятать composer.
  // Composer показываем только когда выбран чат/контакт/доска (как в tweb).
  const chatInputVisible = state.page === "main" && Boolean(state.selected) && (!state.modal || state.modal.kind === "context_menu");
  const mobileUi = isMobileLikeUi();
  const rightTarget = state.rightPanel;
  const showRightPanel = Boolean(rightTarget && state.page === "main" && !mobileUi);
  if (typeof document !== "undefined") {
    document.body.classList.toggle("has-right-col", showRightPanel);
    document.body.classList.toggle("has-auth-pages", !state.authed);
    document.documentElement.classList.toggle("has-auth-pages", !state.authed);
  }
  layout.rightCol.classList.toggle("hidden", !showRightPanel);
  layout.rightCol.setAttribute("aria-hidden", showRightPanel ? "false" : "true");
  layout.inputWrap.classList.toggle("hidden", !chatInputVisible);
  layout.inputWrap.classList.toggle("input-wrap-no-composer", !chatInputVisible);

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
  const replyDraft = !editing && state.replyDraft && state.replyDraft.key === selectedKey ? state.replyDraft : null;
  const forwardDraft = !editing && state.forwardDraft && state.forwardDraft.key === selectedKey ? state.forwardDraft : null;
  const helperDraft = replyDraft || forwardDraft;
  const helperKind = replyDraft ? "reply" : forwardDraft ? "forward" : null;
  const isBoardReadOnly = (() => {
    if (!chatInputVisible) return false;
    if (!sel || sel.kind !== "board") return false;
    const b = (state.boards || []).find((x) => x.id === sel.id);
    const owner = String(b?.owner_id || "").trim();
    const me = String(state.selfId || "").trim();
    return Boolean(owner && me && owner !== me);
  })();
  const isGroupWriteBlocked = (() => {
    if (!chatInputVisible) return false;
    if (!sel || sel.kind !== "group") return false;
    const g = (state.groups || []).find((x) => x.id === sel.id);
    const owner = String(g?.owner_id || "").trim();
    const me = String(state.selfId || "").trim();
    if (!me || (owner && owner === me)) return false;
    const banned = (g?.post_banned || []).map((x) => String(x || "").trim()).filter(Boolean);
    return banned.includes(me);
  })();

  let composerDisabledReason: string | null = null;
  if (!chatInputVisible) composerDisabledReason = null;
  else if (state.conn !== "connected") composerDisabledReason = "Нет соединения";
  else if (!state.authed) composerDisabledReason = "Нажмите «Войти», чтобы писать";
  else if (!sel) composerDisabledReason = "Выберите чат слева";
  else if (isGroupWriteBlocked) composerDisabledReason = "Вам запрещено писать в чате";
  else if (isBoardReadOnly) composerDisabledReason = "На доске пишет только владелец";

  const composerEnabled = chatInputVisible && composerDisabledReason === null;
  const boardEditorAvailable = composerEnabled && Boolean(sel && sel.kind === "board") && !isBoardReadOnly && !editing;
  const boardEditorOpen = Boolean(boardEditorAvailable && state.boardComposerOpen);
  layout.boardEditorBtn.classList.toggle("hidden", !boardEditorAvailable);
  layout.boardEditorBtn.classList.toggle("btn-active", boardEditorOpen);
  layout.boardEditorBtn.disabled = !boardEditorAvailable;
  layout.boardEditorWrap.classList.toggle("hidden", !boardEditorOpen);
  layout.inputWrap.classList.toggle("board-editor-open", boardEditorOpen);

  if (boardEditorOpen && sel?.kind === "board") {
    const kbdOpen = (() => {
      if (typeof document === "undefined") return false;
      const de = document.documentElement;
      return Boolean(de && (de as any).classList?.contains?.("kbd-open"));
    })();
    // iOS/Safari: the keyboard accessory bar (prev/next/✓) appears when multiple form fields exist.
    // While the keyboard is open we hide scheduling UI; disabling the datetime input also helps reduce
    // the accessory bar to a minimal “Done” control.
    layout.boardScheduleInput.disabled = kbdOpen;

    const now = Date.now();
    const maxAt = now + maxBoardScheduleDelayMs();
    layout.boardScheduleInput.min = formatDatetimeLocal(now);
    layout.boardScheduleInput.max = formatDatetimeLocal(maxAt);

    const scheduleTs = parseDatetimeLocal(layout.boardScheduleInput.value);
    const scheduleOk = scheduleTs !== null && scheduleTs >= now && scheduleTs <= maxAt;
    const scheduleHasValue = Boolean(layout.boardScheduleInput.value);
    layout.boardScheduleInput.classList.toggle("is-invalid", scheduleHasValue && !scheduleOk);
    if (scheduleHasValue && !scheduleOk) layout.boardScheduleInput.setAttribute("aria-invalid", "true");
    else layout.boardScheduleInput.removeAttribute("aria-invalid");
    const scheduleCanSendNow = composerEnabled && Boolean(sel);
    const scheduleText = sendText.trim();
    layout.boardScheduleBtn.disabled = !scheduleCanSendNow || !scheduleText || tooLong || !scheduleOk;
    layout.boardScheduleClearBtn.disabled = !layout.boardScheduleInput.value;

    const scheduled = (state.boardScheduledPosts || []).filter((x) => x.boardId === sel.id).sort((a, b) => a.scheduleAt - b.scheduleAt);
    if (!scheduled.length) {
      layout.boardScheduleList.replaceChildren(el("div", { class: "board-editor-preview-empty" }, ["Нет запланированных публикаций."]));
    } else {
      const visible = scheduled.slice(0, 12);
      const list = visible.map((it) => {
        const when = (() => {
          try {
            return new Date(it.scheduleAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
          } catch {
            return String(it.scheduleAt);
          }
        })();
        const firstLine = String(it.text || "").trim().split("\n")[0] || "—";
        const label = firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
        return el("div", { class: "board-sched-item" }, [
          el("div", { class: "board-sched-meta" }, [el("div", { class: "board-sched-time" }, [when]), el("div", { class: "board-sched-text" }, [label])]),
          el("button", { class: "btn board-sched-cancel", type: "button", "data-action": "board-schedule-cancel", "data-sched-id": it.id, "aria-label": "Отменить" }, ["×"]),
        ]);
      });
      if (scheduled.length > visible.length) {
        list.push(el("div", { class: "board-sched-more" }, [`И ещё ${scheduled.length - visible.length}…`]));
      }
      layout.boardScheduleList.replaceChildren(...list);
    }
  } else {
    // Keep hidden scheduling field disabled when the board editor is closed.
    // This also helps iOS reduce the keyboard accessory bar (prev/next/✓) while typing in composer.
    layout.boardScheduleInput.disabled = true;
    layout.boardScheduleBtn.disabled = true;
    layout.boardScheduleClearBtn.disabled = true;
    layout.boardScheduleInput.classList.remove("is-invalid");
    layout.boardScheduleInput.removeAttribute("aria-invalid");
    layout.boardScheduleList.replaceChildren(el("div", { class: "board-editor-preview-empty" }, [""]));
  }

  layout.input.disabled = !composerEnabled;
  layout.input.placeholder = composerDisabledReason || (editing ? "Изменить сообщение" : boardEditorOpen ? "Текст объявления…" : "Сообщение");
  layout.input.setAttribute("enterkeyhint", boardEditorOpen ? "enter" : "send");

  const canSendNow = composerEnabled && Boolean(sel);
  const composerText = sendText.trim();
  layout.boardPublishBtn.disabled = !boardEditorOpen || !canSendNow || !composerText || tooLong;
  layout.attachBtn.disabled = !canSendNow || !sel || isBoardReadOnly || Boolean(editing);
  layout.emojiBtn.disabled = !canSendNow || !sel || isBoardReadOnly;
  layout.inputWrap.classList.toggle("composer-editing", Boolean(editing));
  const hint = layout.inputWrap.querySelector(".composer-hint") as HTMLElement | null;
  if (hint) hint.textContent = editing ? "Enter — сохранить, Shift+Enter — новая строка" : boardEditorOpen ? (mobileUi ? "«Опубликовать» — в редакторе" : "Ctrl+Enter — опубликовать") : "Shift+Enter — новая строка";

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

  const helperBar = layout.inputWrap.querySelector("#composer-helper") as HTMLElement | null;
  const helperIcon = layout.inputWrap.querySelector("#composer-helper-icon") as HTMLElement | null;
  const helperTitle = layout.inputWrap.querySelector("#composer-helper-title") as HTMLElement | null;
  const helperText = layout.inputWrap.querySelector("#composer-helper-text") as HTMLElement | null;
  if (helperBar) {
    helperBar.classList.toggle("hidden", !helperDraft);
    helperBar.classList.toggle("composer-helper-forward", helperKind === "forward");
    if (helperIcon) helperIcon.textContent = helperKind === "forward" ? "↪" : "↩";
    if (helperTitle) {
      const sender = helperDraft?.from ? formatSenderLabel(state, helperDraft.from) : "";
      const titleBase = helperKind === "forward" ? "Переслано" : "Ответ";
      helperTitle.textContent = sender ? `${titleBase}: ${sender}` : titleBase;
    }
    if (helperText) helperText.textContent = helperDraft?.preview || "";
  }

  renderHeader(layout, state);
  const sidebarScrollTop = layout.sidebarBody.scrollTop;
  const sidebarScrollLeft = layout.sidebarBody.scrollLeft;
  const prevSidebarSearch = layout.sidebar.querySelector("input.sidebar-search-input") as HTMLInputElement | null;
  const sidebarSearchHadFocus = Boolean(prevSidebarSearch && document.activeElement === prevSidebarSearch);
  const sidebarSearchSelStart = prevSidebarSearch?.selectionStart ?? null;
  const sidebarSearchSelEnd = prevSidebarSearch?.selectionEnd ?? null;
  renderSidebar(
    layout.sidebar,
    state,
    actions.onSelectTarget,
    actions.onOpenUser,
    actions.onOpenActionModal,
    actions.onSetPage,
    actions.onOpenGroupCreate,
    actions.onOpenBoardCreate,
    actions.onSetMobileSidebarTab,
    actions.onSetSidebarQuery,
    actions.onContactSortChange,
    actions.onAuthOpen,
    actions.onAuthLogout,
    layout.sidebarDock
  );
  const shouldResetSidebarScroll = layout.sidebarBody.dataset.sidebarResetScroll === "1";
  if (shouldResetSidebarScroll) {
    delete layout.sidebarBody.dataset.sidebarResetScroll;
    layout.sidebarBody.scrollTop = 0;
    layout.sidebarBody.scrollLeft = 0;
  } else {
    if (layout.sidebarBody.scrollTop !== sidebarScrollTop) layout.sidebarBody.scrollTop = sidebarScrollTop;
    if (layout.sidebarBody.scrollLeft !== sidebarScrollLeft) layout.sidebarBody.scrollLeft = sidebarScrollLeft;
  }
  if (sidebarSearchHadFocus) {
    const nextSidebarSearch = layout.sidebar.querySelector("input.sidebar-search-input") as HTMLInputElement | null;
    if (nextSidebarSearch) {
      focusElement(nextSidebarSearch);
      try {
        const len = nextSidebarSearch.value.length;
        const start = sidebarSearchSelStart === null ? len : Math.max(0, Math.min(len, sidebarSearchSelStart));
        const end = sidebarSearchSelEnd === null ? len : Math.max(0, Math.min(len, sidebarSearchSelEnd));
        nextSidebarSearch.setSelectionRange(start, end);
      } catch {
        // ignore
      }
    }
  }

  const disableSidebarSearchForIosKbdNav = (() => {
    try {
      if (!isIOS()) return false;
      return document.activeElement === layout.input;
    } catch {
      return false;
    }
  })();
  const sidebarSearchNow = layout.sidebar.querySelector("input.sidebar-search-input") as HTMLInputElement | null;
  if (sidebarSearchNow) sidebarSearchNow.disabled = disableSidebarSearchForIosKbdNav;

  const prevAuthIdInput = state.modal?.kind === "auth" ? (document.getElementById("auth-id") as HTMLInputElement | null) : null;
  const prevAuthPwInput = state.modal?.kind === "auth" ? (document.getElementById("auth-pw") as HTMLInputElement | null) : null;
  const prevAuthPw1Input = state.modal?.kind === "auth" ? (document.getElementById("auth-pw1") as HTMLInputElement | null) : null;
  const prevAuthPw2Input = state.modal?.kind === "auth" ? (document.getElementById("auth-pw2") as HTMLInputElement | null) : null;
  const prevAuthSkinSelect = state.modal?.kind === "auth" ? (document.getElementById("auth-skin") as HTMLSelectElement | null) : null;
  const prevFileSendCaptionInput =
    state.modal?.kind === "file_send" ? (document.getElementById("file-send-caption") as HTMLTextAreaElement | null) : null;
  const prevBoardPostInput =
    state.modal?.kind === "board_post" ? (document.getElementById("board-post-text") as HTMLTextAreaElement | null) : null;
  const prevMembersAddInput = state.modal?.kind === "members_add" ? (document.getElementById("members-add-input") as HTMLInputElement | null) : null;
  const prevMembersAddEntryInput = state.modal?.kind === "members_add" ? (document.getElementById("members-add-entry") as HTMLInputElement | null) : null;
  const prevMembersRemoveInput =
    state.modal?.kind === "members_remove" ? (document.getElementById("members-remove-input") as HTMLInputElement | null) : null;
  const prevRenameInput = state.modal?.kind === "rename" ? (document.getElementById("rename-name") as HTMLInputElement | null) : null;
  const hadAuthModal = Boolean(prevAuthIdInput || prevAuthPwInput || prevAuthPw1Input || prevAuthPw2Input || prevAuthSkinSelect);
  const hadFileSendModal = Boolean(prevFileSendCaptionInput);
  const hadBoardPostModal = Boolean(prevBoardPostInput);
  const prevAuthId = prevAuthIdInput?.value ?? "";
  const prevAuthPw = prevAuthPwInput?.value ?? "";
  const prevAuthPw1 = prevAuthPw1Input?.value ?? "";
  const prevAuthPw2 = prevAuthPw2Input?.value ?? "";
  const prevActiveId = (document.activeElement as HTMLElement | null)?.id ?? "";
  const prevFileSendCaption = prevFileSendCaptionInput?.value ?? "";
  const prevBoardPostText = prevBoardPostInput?.value ?? "";
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
        onBoardPostPublish: actions.onBoardPostPublish,
        onDismissUpdate: actions.onDismissUpdate,
        onReloadUpdate: actions.onReloadUpdate,
        onApplyPwaUpdate: actions.onApplyPwaUpdate,
        onSkinChange: actions.onSkinChange,
        onMembersAdd: actions.onMembersAdd,
        onMembersRemove: actions.onMembersRemove,
        onRename: actions.onRename,
        onInviteUser: actions.onInviteUser,
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
      onFileSendConfirm: actions.onFileSendConfirm,
      onFileViewerNavigate: actions.onFileViewerNavigate,
      onContextMenuAction: actions.onContextMenuAction,
    })
    : null;

  // Большинство модалок рендерим inline (в теле чата), чтобы не перекрывать всё приложение.
  // Исключения:
  // - context_menu: всегда поверх (overlay) из-за позиционирования по курсору/тапу
  // - file_viewer: поверх (overlay) как fullscreen viewer (Telegram‑паттерн)
  const inlineModal = Boolean(state.modal && state.modal.kind !== "context_menu" && state.modal.kind !== "file_viewer");
  layout.chat.classList.toggle("chat-page", state.page !== "main" || inlineModal);
  const showChatTop = state.page === "main" && !inlineModal && Boolean(state.selected);
  layout.chatTop.classList.toggle("hidden", !showChatTop);
  if (!showChatTop) {
    // When switching to pages/modals, clear chat header state so returning to chat is treated as "fresh".
    layout.chatTop.replaceChildren();
    layout.chatHost.removeAttribute("data-chat-key");
    layout.chatJump.classList.add("hidden");
    if (pageChanged) {
      try {
        layout.chatHost.scrollTop = 0;
      } catch {
        // ignore
      }
    }
  }
  if (inlineModal && modalNode) {
    mountChat(
      layout,
      el("div", { class: "page modal-page" }, mobileUi ? [modalNode] : [modalNode, el("div", { class: "msg msg-sys" }, ["Esc — назад"])])
    );
  } else if (state.page === "main") {
    const prevSearch = layout.chatTop.querySelector("#chat-search-input") as HTMLInputElement | null;
    const searchHadFocus = Boolean(prevSearch && document.activeElement === prevSearch);
    const searchSelStart = prevSearch?.selectionStart ?? null;
    const searchSelEnd = prevSearch?.selectionEnd ?? null;
    renderChat(layout, state);
    if (state.chatSearchOpen && searchHadFocus) {
      const nextSearch = layout.chatTop.querySelector("#chat-search-input") as HTMLInputElement | null;
      if (nextSearch) {
        focusElement(nextSearch);
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
        onSearchServerForward: actions.onSearchServerForward,
        onOpenHistoryHit: actions.onOpenHistoryHit,
        onSearchHistoryDelete: actions.onSearchHistoryDelete,
        onSearchHistoryForward: actions.onSearchHistoryForward,
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
        onThemeChange: actions.onThemeChange,
        onMessageViewChange: actions.onMessageViewChange,
        onAvatarSelect: actions.onProfileAvatarSelect,
        onAvatarClear: actions.onProfileAvatarClear,
        onPushEnable: actions.onPushEnable,
        onPushDisable: actions.onPushDisable,
        onNotifyInAppEnable: actions.onNotifyInAppEnable,
        onNotifyInAppDisable: actions.onNotifyInAppDisable,
        onNotifySoundEnable: actions.onNotifySoundEnable,
        onNotifySoundDisable: actions.onNotifySoundDisable,
        onForcePwaUpdate: actions.onForcePwaUpdate,
      });
    }
    mountChat(layout, profilePage.root);
    profilePage.update(state);
    if (pageChanged) profilePage.focus();
  } else if (state.page === "user") {
    if (!userPage) {
      userPage = createUserPage({
        onBack: () => actions.onSetPage("main"),
        onOpenChat: (id: string) => {
          actions.onSetPage("main");
          actions.onSelectTarget({ kind: "dm", id });
        },
      });
    }
    mountChat(layout, userPage.root);
    userPage.update(state);
    if (pageChanged) userPage.focus();
  } else if (state.page === "group") {
    if (!groupPage) {
      groupPage = createRoomPage("group", {
        onBack: () => actions.onSetPage("main"),
        onOpenChat: (id: string) => {
          actions.onSetPage("main");
          actions.onSelectTarget({ kind: "group", id });
        },
        onOpenUser: (id: string) => actions.onOpenUser(id),
        onRemoveMember: (kind, roomId, memberId) => actions.onRoomMemberRemove(kind, roomId, memberId),
        onBlockToggle: (memberId) => actions.onBlockToggle(memberId),
        onWriteToggle: (kind, roomId, memberId, value) => actions.onRoomWriteToggle(kind, roomId, memberId, value),
        onRefresh: (kind, roomId) => actions.onRoomRefresh(kind, roomId),
        onInfoSave: (kind, roomId, description, rules) => actions.onRoomInfoSave(kind, roomId, description, rules),
        onLeave: (kind, roomId) => actions.onRoomLeave(kind, roomId),
        onDisband: (kind, roomId) => actions.onRoomDisband(kind, roomId),
      });
    }
    mountChat(layout, groupPage.root);
    groupPage.update(state);
    if (pageChanged) groupPage.focus();
  } else if (state.page === "board") {
    if (!boardPage) {
      boardPage = createRoomPage("board", {
        onBack: () => actions.onSetPage("main"),
        onOpenChat: (id: string) => {
          actions.onSetPage("main");
          actions.onSelectTarget({ kind: "board", id });
        },
        onOpenUser: (id: string) => actions.onOpenUser(id),
        onRemoveMember: (kind, roomId, memberId) => actions.onRoomMemberRemove(kind, roomId, memberId),
        onBlockToggle: (memberId) => actions.onBlockToggle(memberId),
        onWriteToggle: (kind, roomId, memberId, value) => actions.onRoomWriteToggle(kind, roomId, memberId, value),
        onRefresh: (kind, roomId) => actions.onRoomRefresh(kind, roomId),
        onInfoSave: (kind, roomId, description, rules) => actions.onRoomInfoSave(kind, roomId, description, rules),
        onLeave: (kind, roomId) => actions.onRoomLeave(kind, roomId),
        onDisband: (kind, roomId) => actions.onRoomDisband(kind, roomId),
      });
    }
    mountChat(layout, boardPage.root);
    boardPage.update(state);
    if (pageChanged) boardPage.focus();
  } else if (state.page === "files") {
    if (!filesPage) {
      filesPage = createFilesPage({
        onFileSend: actions.onFileSend,
        onFileOfferAccept: actions.onFileOfferAccept,
        onFileOfferReject: actions.onFileOfferReject,
        onClearCompleted: actions.onClearCompletedFiles,
        onOpenUser: actions.onOpenUser,
      });
    }
    mountChat(layout, filesPage.root);
    filesPage.update(state);
    if (pageChanged) filesPage.focus();
  }

  if (showRightPanel && rightTarget) {
    const { shell, title, body } = ensureRightPanelShell(actions);
    if (rightTarget.kind === "dm") {
      if (!rightUserPage) {
        rightUserPage = createUserPage({
          onBack: actions.onCloseRightPanel,
          onOpenChat: (id: string) => actions.onSelectTarget({ kind: "dm", id }),
        });
      }
      title.textContent = "Контакт";
      const viewState = { ...state, userViewId: rightTarget.id, groupViewId: null, boardViewId: null };
      rightUserPage.update(viewState);
      body.replaceChildren(rightUserPage.root);
    } else if (rightTarget.kind === "group") {
      if (!rightGroupPage) {
        rightGroupPage = createRoomPage("group", {
          onBack: actions.onCloseRightPanel,
          onOpenChat: (id: string) => actions.onSelectTarget({ kind: "group", id }),
          onOpenUser: (id: string) => actions.onOpenUser(id),
          onRemoveMember: (kind, roomId, memberId) => actions.onRoomMemberRemove(kind, roomId, memberId),
          onBlockToggle: (memberId) => actions.onBlockToggle(memberId),
          onWriteToggle: (kind, roomId, memberId, value) => actions.onRoomWriteToggle(kind, roomId, memberId, value),
          onRefresh: (kind, roomId) => actions.onRoomRefresh(kind, roomId),
          onInfoSave: (kind, roomId, description, rules) => actions.onRoomInfoSave(kind, roomId, description, rules),
          onLeave: (kind, roomId) => actions.onRoomLeave(kind, roomId),
          onDisband: (kind, roomId) => actions.onRoomDisband(kind, roomId),
        });
      }
      title.textContent = "Чат";
      const viewState = { ...state, groupViewId: rightTarget.id, userViewId: null, boardViewId: null };
      rightGroupPage.update(viewState);
      body.replaceChildren(rightGroupPage.root);
    } else if (rightTarget.kind === "board") {
      if (!rightBoardPage) {
        rightBoardPage = createRoomPage("board", {
          onBack: actions.onCloseRightPanel,
          onOpenChat: (id: string) => actions.onSelectTarget({ kind: "board", id }),
          onOpenUser: (id: string) => actions.onOpenUser(id),
          onRemoveMember: (kind, roomId, memberId) => actions.onRoomMemberRemove(kind, roomId, memberId),
          onBlockToggle: (memberId) => actions.onBlockToggle(memberId),
          onWriteToggle: (kind, roomId, memberId, value) => actions.onRoomWriteToggle(kind, roomId, memberId, value),
          onRefresh: (kind, roomId) => actions.onRoomRefresh(kind, roomId),
          onInfoSave: (kind, roomId, description, rules) => actions.onRoomInfoSave(kind, roomId, description, rules),
          onLeave: (kind, roomId) => actions.onRoomLeave(kind, roomId),
          onDisband: (kind, roomId) => actions.onRoomDisband(kind, roomId),
        });
      }
      title.textContent = "Доска";
      const viewState = { ...state, boardViewId: rightTarget.id, userViewId: null, groupViewId: null };
      rightBoardPage.update(viewState);
      body.replaceChildren(rightBoardPage.root);
    }
    mountRightCol(layout, shell);
  } else {
    layout.rightCol.replaceChildren();
  }

  renderFooter(layout.footer, state);
  renderToast(layout.toastHost, state.toast);

  if (state.modal?.kind === "file_viewer" && modalNode) {
    layout.overlay.classList.remove("hidden");
    layout.overlay.classList.remove("overlay-context");
    layout.overlay.classList.remove("overlay-context-sheet");
    layout.overlay.classList.add("overlay-viewer");
    layout.overlay.replaceChildren(modalNode);
  } else if (state.modal?.kind === "context_menu" && modalNode) {
    layout.overlay.classList.remove("hidden");
    layout.overlay.classList.remove("overlay-viewer");
    layout.overlay.classList.add("overlay-context");
    layout.overlay.classList.toggle("overlay-context-sheet", modalNode.classList.contains("ctx-menu-sheet"));
    layout.overlay.replaceChildren(modalNode);
  } else {
    layout.overlay.classList.add("hidden");
    layout.overlay.classList.remove("overlay-context");
    layout.overlay.classList.remove("overlay-context-sheet");
    layout.overlay.classList.remove("overlay-viewer");
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
      else if (prevActiveId === "auth-pw2" && pw2) focusElement(pw2);
      else if (prevActiveId === "auth-pw1" && pw1) focusElement(pw1);
      else if (prevActiveId === "auth-pw" && pw) focusElement(pw);
      else if (prevActiveId === "auth-id" && id) focusElement(id);
      else if (!hadAuthModal) {
        if (state.authMode === "register" && pw1) focusElement(pw1);
        else if (state.authMode === "login") {
          if (id && !id.value) focusElement(id);
          else if (pw) focusElement(pw);
          else if (id) focusElement(id);
        } else if (id) {
          focusElement(id);
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
      focusElement(entry);
    });
  }

  if (state.modal?.kind === "members_remove") {
    const input = document.getElementById("members-remove-input") as HTMLInputElement | null;
    if (input && input.value !== prevMembersRemove) input.value = prevMembersRemove;
    queueMicrotask(() => {
      focusElement(input, { select: true });
    });
  }

  if (state.modal?.kind === "file_send") {
    const input = document.getElementById("file-send-caption") as HTMLTextAreaElement | null;
    if (input && prevFileSendCaption && input.value !== prevFileSendCaption) input.value = prevFileSendCaption;
    queueMicrotask(() => {
      if (!input) return;
      if (prevActiveId === "file-send-caption") {
        focusElement(input);
      } else if (!hadFileSendModal && !input.disabled) {
        focusElement(input);
      }
    });
  }

  if (state.modal?.kind === "board_post") {
    const input = document.getElementById("board-post-text") as HTMLTextAreaElement | null;
    if (input && input.value !== prevBoardPostText) {
      input.value = prevBoardPostText;
      try {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } catch {
        // ignore
      }
    }
    queueMicrotask(() => {
      if (!input) return;
      if (prevActiveId === "board-post-text") {
        focusElement(input);
      } else if (!hadBoardPostModal) {
        focusElement(input);
      }
    });
  }

  if (state.modal?.kind === "rename") {
    const input = document.getElementById("rename-name") as HTMLInputElement | null;
    if (input && input.value !== prevRename) input.value = prevRename;
    queueMicrotask(() => {
      focusElement(input, { select: true });
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
