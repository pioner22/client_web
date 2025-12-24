import type { AppState } from "../stores/types";
import { APP_VERSION } from "../config/app";
import { getStoredSkinId } from "../helpers/skin/skin";
import { resolveInitialTheme } from "../helpers/theme/theme";
import { getStoredAuthId, getStoredSessionToken, isSessionAutoAuthBlocked } from "../helpers/auth/session";
import { getPushOptOut } from "../helpers/pwa/pushPrefs";
import { getStoredMessageView } from "../helpers/ui/messageView";

export function createInitialState(): AppState {
  const skin = getStoredSkinId();
  const theme = resolveInitialTheme(skin);
  const messageView = getStoredMessageView();
  const rememberedId = getStoredAuthId();
  const sessionToken = getStoredSessionToken();
  const autoBlocked = isSessionAutoAuthBlocked();
  const authMode = sessionToken && !autoBlocked ? "auto" : rememberedId ? "login" : "register";
  const status = autoBlocked
    ? "Сессия активна в другом окне. Нажмите «Войти», чтобы продолжить здесь."
    : authMode === "auto"
      ? "Автовход…"
      : "Connecting…";
  const pushSupported = (() => {
    try {
      return Boolean(
        typeof window !== "undefined" &&
          "serviceWorker" in navigator &&
          "PushManager" in window &&
          "Notification" in window
      );
    } catch {
      return false;
    }
  })();
  const pushPermission = (() => {
    try {
      return (Notification?.permission ?? "default") as "default" | "granted" | "denied";
    } catch {
      return "default";
    }
  })();
  const pushOptOut = getPushOptOut();
  return {
    conn: "connecting",
    authed: false,
    selfId: null,
    serverVersion: null,
    clientVersion: APP_VERSION,
    status,
    authMode,
    authRememberedId: rememberedId,
    skin,
    skins: [{ id: "default", title: "По умолчанию" }],
    theme,
    messageView,
    mobileSidebarTab: "chats",
    sidebarQuery: "",
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
    userViewId: null,
    groupViewId: null,
    boardViewId: null,
    searchQuery: "",
    searchResults: [],
    groupCreateMessage: "",
    boardCreateMessage: "",
    profiles: {},
    profileDraftDisplayName: "",
    profileDraftHandle: "",
    profileDraftBio: "",
    profileDraftStatus: "",
    // “В тишине”: auth-модалку открываем только по явному действию пользователя («Войти»).
    toast: null,
    modal: null,
    updateLatest: null,
    updateDismissedLatest: null,
    pwaUpdateAvailable: false,
    pwaPushSupported: pushSupported,
    pwaPushPermission: pushPermission,
    pwaPushSubscribed: false,
    pwaPushPublicKey: null,
    pwaPushStatus: null,
    pwaPushOptOut: pushOptOut,

    avatarsRev: 0,
  };
}
