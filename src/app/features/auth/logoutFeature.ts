import { createChatSearchCounts } from "../../../helpers/chat/chatSearch";
import { clearStoredSessionToken, getStoredSessionToken, storeAuthId } from "../../../helpers/auth/session";
import { clearOutboxForUser } from "../../../helpers/pwa/outboxSync";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { flushDrafts, flushHistoryCache, flushOutbox, flushPinnedMessages } from "../persistence/localPersistenceTimers";

export interface LogoutFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  clearToast: () => void;
  resetAutoAuthAttempt: () => void;
  onHistoryLogout: () => void;
  onPwaPushLogout: () => void;
  resetFileGet: () => void;
  resetFileDownloadActions: () => void;
  resetPreviewWarmup: () => void;
  resetLoadedForUser: () => void;
  clearBoardScheduleTimer: () => void;
  resetInput: () => void;
  reconnectGateway: () => void;
  lastReadSentAt: Map<string, number>;
  cachedPreviewsAttempted: Map<string, number>;
  cachedThumbsAttempted: Map<string, number>;
  previewPrefetchAttempted: Map<string, number>;
}

export interface LogoutFeature {
  logout: () => void;
}

export function createLogoutFeature(deps: LogoutFeatureDeps): LogoutFeature {
  const {
    store,
    send,
    clearToast,
    resetAutoAuthAttempt,
    onHistoryLogout,
    onPwaPushLogout,
    resetFileGet,
    resetFileDownloadActions,
    resetPreviewWarmup,
    resetLoadedForUser,
    clearBoardScheduleTimer,
    resetInput,
    reconnectGateway,
    lastReadSentAt,
    cachedPreviewsAttempted,
    cachedThumbsAttempted,
    previewPrefetchAttempted,
  } = deps;

  function logout() {
    flushDrafts(store);
    flushPinnedMessages(store);
    flushOutbox(store);
    flushHistoryCache(store);
    clearToast();

    const st = store.get();
    const id = String(st.selfId || "").trim();
    const rememberedId = id || String(st.authRememberedId || "").trim() || null;

    const session = getStoredSessionToken();
    if (st.conn === "connected" && st.authed) {
      send({ type: "logout", ...(session ? { session } : {}) });
    }

    if (id) storeAuthId(id);
    if (id) void clearOutboxForUser(id);
    clearStoredSessionToken();

    resetAutoAuthAttempt();
    onHistoryLogout();
    lastReadSentAt.clear();
    cachedPreviewsAttempted.clear();
    cachedThumbsAttempted.clear();
    previewPrefetchAttempted.clear();
    onPwaPushLogout();
    resetFileGet();
    resetFileDownloadActions();
    resetPreviewWarmup();

    const toRevoke = (st.fileTransfers || [])
      .map((entry) => entry.url)
      .filter((url): url is string => Boolean(url));
    for (const url of toRevoke) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }

    const thumbToRevoke = Object.values(st.fileThumbs || {})
      .map((entry) => entry?.url)
      .filter((url): url is string => Boolean(url));
    for (const url of thumbToRevoke) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }

    store.set((prev) => ({
      ...prev,
      authed: false,
      selfId: null,
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
      fileThumbs: {},
      groups: [],
      boards: [],
      selected: null,
      conversations: {},
      historyLoaded: {},
      historyCursor: {},
      historyHasMore: {},
      historyLoading: {},
      historyVirtualStart: {},
      outbox: {},
      drafts: {},
      input: "",
      editing: null,
      boardComposerOpen: false,
      boardScheduledPosts: [],
      chatSearchOpen: false,
      chatSearchResultsOpen: false,
      chatSearchQuery: "",
      chatSearchDate: "",
      chatSearchFilter: "all",
      chatSearchHits: [],
      chatSearchPos: 0,
      chatSearchCounts: createChatSearchCounts(),
      profiles: {},
      profileDraftDisplayName: "",
      profileDraftHandle: "",
      toast: null,
      page: "main",
      modal: { kind: "logout" },
      authMode: rememberedId ? "login" : "register",
      authRememberedId: rememberedId,
      status: "Вы вышли из мессенджера. Нажмите «Войти», чтобы вернуться.",
    }));

    resetLoadedForUser();
    clearBoardScheduleTimer();
    resetInput();

    // Сбрасываем серверную авторизацию через переподключение.
    reconnectGateway();
  }

  return { logout };
}

