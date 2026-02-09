import { sanitizeChatFoldersSnapshot } from "../../../helpers/chat/folders";
import type { Store } from "../../../stores/store";
import type { AppState, SidebarChatFilter } from "../../../stores/types";

export interface SidebarPreferencesActionsFeatureDeps {
  store: Store<AppState>;
  sidebarBody: HTMLElement;
  send: (payload: any) => void;
  saveChatFoldersForUser: (selfId: string, snapshot: any) => void;
}

export interface SidebarPreferencesActionsFeature {
  onSetSidebarChatFilter: (filter: SidebarChatFilter) => void;
  onSetSidebarFolderId: (folderId: string) => void;
  onSetSidebarQuery: (query: string) => void;
  onToggleSidebarArchive: () => void;
}

export function createSidebarPreferencesActionsFeature(
  deps: SidebarPreferencesActionsFeatureDeps
): SidebarPreferencesActionsFeature {
  const { store, sidebarBody, send, saveChatFoldersForUser } = deps;

  const onSetSidebarChatFilter = (filter: SidebarChatFilter) => {
    const next = filter === "unread" || filter === "mentions" || filter === "dms" || filter === "groups" ? filter : "all";
    if (store.get().sidebarChatFilter === next) return;
    store.set({ sidebarChatFilter: next });
  };

  const onSetSidebarFolderId = (folderId: string) => {
    const st = store.get();
    const active = String(folderId || "").trim().toLowerCase() || "all";
    const snap = sanitizeChatFoldersSnapshot({ v: 1, active, folders: st.chatFolders });
    if (st.sidebarFolderId === snap.active) return;
    store.set({ sidebarFolderId: snap.active });
    if (st.selfId) saveChatFoldersForUser(st.selfId, snap);
    if (st.conn === "connected" && st.authed) {
      send({ type: "prefs_set", values: { chat_folders: snap } });
    }
  };

  const onSetSidebarQuery = (query: string) => {
    const q = String(query ?? "");
    if (store.get().sidebarQuery === q) return;
    store.set({ sidebarQuery: q });
  };

  const onToggleSidebarArchive = () => {
    const nextOpen = !store.get().sidebarArchiveOpen;
    if (nextOpen) {
      try {
        sidebarBody.dataset.sidebarResetScroll = "1";
      } catch {
        // ignore
      }
    }
    store.set((prev) => ({ ...prev, sidebarArchiveOpen: !prev.sidebarArchiveOpen }));
  };

  return {
    onSetSidebarChatFilter,
    onSetSidebarFolderId,
    onSetSidebarQuery,
    onToggleSidebarArchive,
  };
}
