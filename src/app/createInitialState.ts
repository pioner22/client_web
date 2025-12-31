import type { AppState } from "../stores/types";
import { APP_VERSION } from "../config/app";
import { getStoredSkinId } from "../helpers/skin/skin";
import { resolveInitialTheme } from "../helpers/theme/theme";
import { getStoredAuthId, getStoredSessionToken, isSessionAutoAuthBlocked } from "../helpers/auth/session";
import { getPushOptOut } from "../helpers/pwa/pushPrefs";
import { getNotifyInAppEnabled, getNotifySoundEnabled } from "../helpers/notify/notifyPrefs";
import { getStoredMessageView } from "../helpers/ui/messageView";
import { getStoredContactSortMode } from "../helpers/ui/contactSort";

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
  const notifyInAppEnabled = getNotifyInAppEnabled();
  const notifySoundEnabled = getNotifySoundEnabled();
  const contactSortMode = getStoredContactSortMode();
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
    contactSortMode,
    friends: [],
    topPeers: [],
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
    historyVirtualStart: {},
    lastRead: {},
    outbox: {},
    drafts: {},
    input: "",
    editing: null,
    replyDraft: null,
    forwardDraft: null,
    boardComposerOpen: false,
    boardScheduledPosts: [],
    chatSearchOpen: false,
    chatSearchResultsOpen: false,
    chatSearchQuery: "",
    chatSearchDate: "",
    chatSearchFilter: "all",
    chatSearchHits: [],
    chatSearchPos: 0,
    chatSearchCounts: { all: 0, media: 0, files: 0, links: 0, audio: 0 },
    page: "main",
    rightPanel: null,
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
    notifyInAppEnabled,
    notifySoundEnabled,

    avatarsRev: 0,
  };
}
