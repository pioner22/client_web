import type { AppState } from "../stores/types";
import { APP_VERSION } from "../config/app";
import { getStoredSkinId } from "../helpers/skin/skin";
import { getStoredAuthId, getStoredSessionToken, isSessionAutoAuthBlocked } from "../helpers/auth/session";

export function createInitialState(): AppState {
  const rememberedId = getStoredAuthId();
  const sessionToken = getStoredSessionToken();
  const autoBlocked = isSessionAutoAuthBlocked();
  const authMode = sessionToken && !autoBlocked ? "auto" : rememberedId ? "login" : "register";
  const status = autoBlocked
    ? "Сессия активна в другом окне. Нажмите «Войти», чтобы продолжить здесь."
    : authMode === "auto"
      ? "Автовход…"
      : "Connecting…";
  return {
    conn: "connecting",
    authed: false,
    selfId: null,
    serverVersion: null,
    clientVersion: APP_VERSION,
    status,
    authMode,
    authRememberedId: rememberedId,
    skin: getStoredSkinId(),
    skins: [{ id: "default", title: "По умолчанию" }],
    mobileSidebarTab: "chats",
    friends: [],
    pendingIn: [],
    pendingOut: [],
    muted: [],
    blocked: [],
    blockedBy: [],
    pinned: [],
    pinnedMessages: {},
    pinnedMessageActive: {},
    pendingGroupInvites: [],
    pendingGroupJoinRequests: [],
    pendingBoardInvites: [],
    fileOffersIn: [],
    fileTransfers: [],
    groups: [],
    boards: [],
    selected: null,
    conversations: {},
    historyLoaded: {},
    historyCursor: {},
    historyHasMore: {},
    historyLoading: {},
    outbox: {},
    drafts: {},
    input: "",
    editing: null,
    chatSearchOpen: false,
    chatSearchQuery: "",
    chatSearchHits: [],
    chatSearchPos: 0,
    page: "main",
    searchQuery: "",
    searchResults: [],
    groupCreateMessage: "",
    boardCreateMessage: "",
    profiles: {},
    profileDraftDisplayName: "",
    profileDraftHandle: "",
    // “В тишине”: auth-модалку открываем только по явному действию пользователя («Войти»).
    toast: null,
    modal: null,
    updateLatest: null,
    updateDismissedLatest: null,
    pwaUpdateAvailable: false,

    avatarsRev: 0,
  };
}
