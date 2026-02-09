import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface ModalSubmitFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
}

export interface ModalSubmitFeature {
  inviteUserSubmit: () => void;
  confirmSubmit: () => void;
}

export function createModalSubmitFeature(deps: ModalSubmitFeatureDeps): ModalSubmitFeature {
  const { store, send } = deps;

  const inviteUserSubmit = () => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "invite_user") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const peer = String(modal.peer || "").trim();
    if (!peer) {
      store.set({ modal: { ...modal, message: "Некорректный ID пользователя" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ modal: { ...modal, message: "Нет соединения" }, status: "Нет соединения" });
      return;
    }

    const form = document.getElementById("invite-user-form");
    const groupIds = Array.from(form?.querySelectorAll("input[type='checkbox'][data-invite-kind='group']:checked") || [])
      .map((node) => String((node as HTMLInputElement).value || "").trim())
      .filter(Boolean);
    const boardIds = Array.from(form?.querySelectorAll("input[type='checkbox'][data-invite-kind='board']:checked") || [])
      .map((node) => String((node as HTMLInputElement).value || "").trim())
      .filter(Boolean);

    if (!groupIds.length && !boardIds.length) {
      store.set({ modal: { ...modal, message: "Выберите хотя бы один чат или доску" } });
      return;
    }

    for (const groupId of groupIds) {
      send({ type: "group_add", group_id: groupId, members: [peer] });
    }
    for (const boardId of boardIds) {
      send({ type: "board_invite", board_id: boardId, members: [peer] });
    }

    const total = groupIds.length + boardIds.length;
    store.set({ modal: null, status: `Приглашения отправляются (${total}): ${peer}` });
  };

  const confirmSubmit = () => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "confirm") return;
    if (st.conn !== "connected" || !st.authed) {
      store.set({ modal: null, status: "Нет соединения" });
      return;
    }
    const close = () => store.set({ modal: null });

    if (modal.action.kind === "chat_clear") {
      send({ type: "chat_clear", peer: modal.action.peer });
      store.set({ status: `Очистка истории: ${modal.action.peer}` });
      close();
      return;
    }
    if (modal.action.kind === "room_clear") {
      send({ type: "room_clear", room: modal.action.roomId });
      store.set({ status: `Очистка истории: ${modal.action.roomId}` });
      close();
      return;
    }
    if (modal.action.kind === "friend_remove") {
      send({ type: "friend_remove", peer: modal.action.peer });
      store.set({ status: `Удаление контакта: ${modal.action.peer}` });
      close();
      return;
    }
    if (modal.action.kind === "group_member_remove") {
      send({ type: "group_remove", group_id: modal.action.groupId, members: [modal.action.memberId] });
      store.set({ status: `Удаление участника: ${modal.action.memberId}` });
      close();
      return;
    }
    if (modal.action.kind === "board_member_remove") {
      send({ type: "board_remove", board_id: modal.action.boardId, members: [modal.action.memberId] });
      store.set({ status: `Удаление участника: ${modal.action.memberId}` });
      close();
      return;
    }
    if (modal.action.kind === "group_leave") {
      send({ type: "group_leave", group_id: modal.action.groupId });
      store.set({ status: `Выход из чата: ${modal.action.groupId}` });
      close();
      return;
    }
    if (modal.action.kind === "board_leave") {
      send({ type: "board_leave", board_id: modal.action.boardId });
      store.set({ status: `Выход из доски: ${modal.action.boardId}` });
      close();
      return;
    }
    if (modal.action.kind === "group_disband") {
      send({ type: "group_disband", group_id: modal.action.groupId });
      store.set({ status: `Удаление чата: ${modal.action.groupId}` });
      close();
      return;
    }
    if (modal.action.kind === "board_disband") {
      send({ type: "board_disband", board_id: modal.action.boardId });
      store.set({ status: `Удаление доски: ${modal.action.boardId}` });
      close();
      return;
    }

    close();
  };

  return {
    inviteUserSubmit,
    confirmSubmit,
  };
}
