import type { Store } from "../../../stores/store";
import type { AppState, ConfirmAction } from "../../../stores/types";

type RoomTargetKind = "group" | "board";

export interface ModalOpenersFeatureDeps {
  store: Store<AppState>;
  closeMobileSidebar: () => void;
  resetCreateMembers: (scope: "group_create" | "board_create") => void;
}

export interface ModalOpenersFeature {
  openGroupCreateModal: () => void;
  openBoardCreateModal: () => void;
  openMembersAddModal: (targetKind: RoomTargetKind, targetId: string) => void;
  openMembersRemoveModal: (targetKind: RoomTargetKind, targetId: string) => void;
  openRenameModal: (targetKind: RoomTargetKind, targetId: string) => void;
  openConfirmModal: (payload: {
    title: string;
    message: string;
    action: ConfirmAction;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => void;
}

export function createModalOpenersFeature(deps: ModalOpenersFeatureDeps): ModalOpenersFeature {
  const { store, closeMobileSidebar, resetCreateMembers } = deps;

  const resolveRoomTitle = (targetKind: RoomTargetKind, targetId: string) => {
    const st = store.get();
    const entry = targetKind === "group" ? st.groups.find((group) => group.id === targetId) : st.boards.find((board) => board.id === targetId);
    const name = String(entry?.name || targetId);
    const title = targetKind === "group" ? `Чат: ${name}` : `Доска: ${name}`;
    const currentName = entry?.name ? String(entry.name) : null;
    return { title, currentName };
  };

  const openGroupCreateModal = () => {
    closeMobileSidebar();
    const st = store.get();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    resetCreateMembers("group_create");
    store.set({ page: "group_create", groupCreateMessage: "" });
  };

  const openBoardCreateModal = () => {
    closeMobileSidebar();
    const st = store.get();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    resetCreateMembers("board_create");
    store.set({ page: "board_create", boardCreateMessage: "" });
  };

  const openMembersAddModal = (targetKind: RoomTargetKind, targetId: string) => {
    const st = store.get();
    if (!st.authed) return;
    closeMobileSidebar();
    const { title } = resolveRoomTitle(targetKind, targetId);
    store.set({ modal: { kind: "members_add", targetKind, targetId, title } });
  };

  const openMembersRemoveModal = (targetKind: RoomTargetKind, targetId: string) => {
    const st = store.get();
    if (!st.authed) return;
    closeMobileSidebar();
    const { title } = resolveRoomTitle(targetKind, targetId);
    store.set({ modal: { kind: "members_remove", targetKind, targetId, title } });
  };

  const openRenameModal = (targetKind: RoomTargetKind, targetId: string) => {
    const st = store.get();
    if (!st.authed) return;
    closeMobileSidebar();
    const { title, currentName } = resolveRoomTitle(targetKind, targetId);
    store.set({ modal: { kind: "rename", targetKind, targetId, title, currentName } });
  };

  const openConfirmModal = (payload: {
    title: string;
    message: string;
    action: ConfirmAction;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => {
    closeMobileSidebar();
    store.set({ modal: { kind: "confirm", ...payload } });
  };

  return {
    openGroupCreateModal,
    openBoardCreateModal,
    openMembersAddModal,
    openMembersRemoveModal,
    openRenameModal,
    openConfirmModal,
  };
}
