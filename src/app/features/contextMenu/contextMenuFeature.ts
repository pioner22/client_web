import { conversationKey, dmKey, roomKey } from "../../../helpers/chat/conversationKey";
import { messageSelectionKey } from "../../../helpers/chat/chatSelection";
import { isPinnedMessage } from "../../../helpers/chat/pinnedMessages";
import { getStoredAvatar } from "../../../helpers/avatar/avatarStore";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, ContextMenuItem, ContextMenuTargetKind } from "../../../stores/types";
import { OUTBOX_SCHEDULE_GRACE_MS } from "../outbox/outboxFeature";
import { avatarKindForTarget } from "../avatar/avatarFeature";

export interface ContextMenuFeatureDeps {
  store: Store<AppState>;
  markUserActivity: () => void;
  isChatMessageSelectable: (msg: ChatMessage | null | undefined) => msg is ChatMessage;
  getSelectedMessageText: (selKey: string, idx: number) => string;
}

export interface ContextMenuFeature {
  openContextMenu: (target: { kind: ContextMenuTargetKind; id: string }, x: number, y: number) => void;
}

export function createContextMenuFeature(deps: ContextMenuFeatureDeps): ContextMenuFeature {
  const { store, markUserActivity, isChatMessageSelectable, getSelectedMessageText } = deps;

  function openContextMenu(target: { kind: ContextMenuTargetKind; id: string }, x: number, y: number) {
    const st = store.get();
    if (st.modal) return;
    markUserActivity();

    const canAct = st.conn === "connected" && st.authed;
    const items: ContextMenuItem[] = [];
    let reactionBar: { emojis: string[]; active?: string | null } | undefined;
    let title = "";
    const ak = avatarKindForTarget(target.kind);
    const hasAvatar = ak ? Boolean(getStoredAvatar(ak, target.id)) : false;
    let sepId = 0;
    const addSeparator = () => {
      if (!items.length) return;
      const last = items[items.length - 1];
      if (last?.separator) return;
      sepId += 1;
      items.push({ id: `sep-${sepId}`, label: "", separator: true });
    };
    const addGroup = (group: ContextMenuItem[]) => {
      if (!group.length) return;
      if (items.length) addSeparator();
      items.push(...group);
    };
    const makeItem = (
      id: string,
      label: string,
      icon: string,
      opts: Pick<ContextMenuItem, "danger" | "disabled"> = {}
    ): ContextMenuItem => ({
      id,
      label,
      icon,
      ...opts,
    });

    if (target.kind === "sidebar_tools") {
      title = "Меню";
      const statusLabel = st.conn === "connected" ? "Подключено" : "Нет соединения";
      addGroup([makeItem("sidebar_status", statusLabel, st.conn === "connected" ? "●" : "○", { disabled: true })]);
      addGroup([
        makeItem("sidebar_profile", "Профиль", "☺", { disabled: !canAct }),
        makeItem("sidebar_search", "Поиск", "🔍", { disabled: !canAct }),
        makeItem("sidebar_files", "Файлы", "▦", { disabled: !canAct }),
        makeItem("sidebar_info", "Info", "?", { disabled: false }),
      ]);
      addGroup([
        makeItem("sidebar_create_chat", "Создать чат", "+", { disabled: !canAct }),
        makeItem("sidebar_create_board", "Создать доску", "+", { disabled: !canAct }),
      ]);
      const folders = Array.isArray(st.chatFolders) ? st.chatFolders : [];
      const folderLabel = (f: any): string => {
        const title = String(f?.title || "").trim();
        const emoji = typeof f?.emoji === "string" ? String(f.emoji).trim() : "";
        return emoji ? `${emoji} ${title || "Папка"}` : title || "Папка";
      };
      addGroup([makeItem("folder_create", "Создать папку…", "📁", { disabled: !st.authed })]);
      if (folders.length) {
        addGroup(
          folders.map((f) =>
            makeItem(`folder_rename:${String(f.id || "").trim()}`, `Переименовать: ${folderLabel(f)}`, "🏷️", { disabled: !st.authed })
          )
        );
        addGroup(
          folders.map((f) =>
            makeItem(`folder_delete:${String(f.id || "").trim()}`, `Удалить: ${folderLabel(f)}`, "🗑️", { danger: true, disabled: !st.authed })
          )
        );
      }
      if (st.conn === "connected" && !st.authed) {
        addGroup([makeItem("sidebar_login", "Войти", "→")]);
      } else if (st.authed) {
        addGroup([makeItem("sidebar_logout", "Выход", "⎋", { danger: true })]);
      }
    } else if (target.kind === "dm") {
      title = `Контакт: ${target.id}`;
      const pinKey = dmKey(target.id);
      const unread = st.friends.find((f) => f.id === target.id)?.unread ?? 0;
      const isPinned = st.pinned.includes(pinKey);
      const isArchived = st.archived.includes(pinKey);
      const isMuted = st.muted.includes(target.id);
      const isBlocked = st.blocked.includes(target.id);
      const canSelectMessages = (() => {
        const sel = st.selected;
        if (!sel || st.page !== "main") return false;
        if (sel.kind !== "dm" || sel.id !== target.id) return false;
        const key = conversationKey(sel);
        const conv = key ? st.conversations[key] : null;
        if (!Array.isArray(conv) || !conv.length) return false;
        return conv.some((m) => isChatMessageSelectable(m));
      })();
      addGroup([
        makeItem("open", "Открыть", "💬"),
        makeItem("profile", "Профиль", "👤"),
        ...(canSelectMessages ? [makeItem("chat_select_messages", "Выбрать сообщения", "✅")] : []),
        makeItem("pin_toggle", isPinned ? "Открепить" : "Закрепить", isPinned ? "📍" : "📌"),
        makeItem("archive_toggle", isArchived ? "Убрать из архива" : "В архив", "🗄️"),
      ]);
      const folders = Array.isArray(st.chatFolders) ? st.chatFolders : [];
      const folderItems: ContextMenuItem[] = [];
      folderItems.push(makeItem("folder_create", "Создать папку…", "📁", { disabled: !st.authed }));
      for (const f of folders) {
        const fid = String((f as any)?.id || "").trim();
        if (!fid) continue;
        const title = String((f as any)?.title || "").trim();
        if (!title) continue;
        const emoji = typeof (f as any)?.emoji === "string" ? String((f as any).emoji).trim() : "";
        const label = emoji ? `${emoji} ${title}` : title;
        const inFolder = Array.isArray((f as any)?.include) ? (f as any).include.includes(pinKey) : false;
        folderItems.push(makeItem(`folder_toggle:${fid}`, label, inFolder ? "✓" : "○"));
      }
      addGroup(folderItems);
      addGroup([
        makeItem("copy_id", "Скопировать ID", "🆔"),
        makeItem("invite_user", "Пригласить в чат/доску…", "➕", { disabled: !canAct }),
        ...(unread > 0 ? [makeItem("mark_read", "Пометить прочитанным", "✅", { disabled: !canAct })] : []),
      ]);
      addGroup([
        makeItem("avatar_set", hasAvatar ? "Сменить аватар…" : "Установить аватар…", "🖼️"),
        ...(hasAvatar ? [makeItem("avatar_remove", "Удалить аватар", "🗑️", { danger: true })] : []),
      ]);
      addGroup([
        makeItem("mute_toggle", isMuted ? "Включить звук" : "Заглушить", isMuted ? "🔔" : "🔕", { disabled: !canAct }),
        makeItem("block_toggle", isBlocked ? "Разблокировать" : "Заблокировать", isBlocked ? "🔓" : "⛔", {
          disabled: !canAct,
        }),
      ]);
      addGroup([
        makeItem("chat_clear", "Очистить историю", "🧹", { danger: true, disabled: !canAct }),
        makeItem("friend_remove", "Удалить контакт", "🗑️", { danger: true, disabled: !canAct }),
      ]);
    } else if (target.kind === "group") {
      const g = st.groups.find((x) => x.id === target.id);
      const name = String(g?.name || target.id);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      title = `Чат: ${name}`;
      const pinKey = roomKey(target.id);
      const isPinned = st.pinned.includes(pinKey);
      const isArchived = st.archived.includes(pinKey);
      const isMuted = st.muted.includes(target.id);
      const canSelectMessages = (() => {
        const sel = st.selected;
        if (!sel || st.page !== "main") return false;
        if (sel.kind !== "group" || sel.id !== target.id) return false;
        const key = conversationKey(sel);
        const conv = key ? st.conversations[key] : null;
        if (!Array.isArray(conv) || !conv.length) return false;
        return conv.some((m) => isChatMessageSelectable(m));
      })();
      addGroup([
        makeItem("open", "Открыть", "💬"),
        makeItem("group_profile", "Профиль чата", "👥"),
        ...(canSelectMessages ? [makeItem("chat_select_messages", "Выбрать сообщения", "✅")] : []),
        makeItem("pin_toggle", isPinned ? "Открепить" : "Закрепить", isPinned ? "📍" : "📌"),
        makeItem("archive_toggle", isArchived ? "Убрать из архива" : "В архив", "🗄️"),
      ]);
      const folders = Array.isArray(st.chatFolders) ? st.chatFolders : [];
      const folderItems: ContextMenuItem[] = [];
      folderItems.push(makeItem("folder_create", "Создать папку…", "📁", { disabled: !st.authed }));
      for (const f of folders) {
        const fid = String((f as any)?.id || "").trim();
        if (!fid) continue;
        const title = String((f as any)?.title || "").trim();
        if (!title) continue;
        const emoji = typeof (f as any)?.emoji === "string" ? String((f as any).emoji).trim() : "";
        const label = emoji ? `${emoji} ${title}` : title;
        const inFolder = Array.isArray((f as any)?.include) ? (f as any).include.includes(pinKey) : false;
        folderItems.push(makeItem(`folder_toggle:${fid}`, label, inFolder ? "✓" : "○"));
      }
      addGroup(folderItems);
      if (isOwner) {
        addGroup([
          makeItem("group_rename", "Переименовать…", "✏️", { disabled: !canAct }),
          makeItem("group_add_members", "Добавить участников…", "➕", { disabled: !canAct }),
          makeItem("group_remove_members", "Удалить участников…", "➖", { danger: true, disabled: !canAct }),
        ]);
      }
      addGroup([
        makeItem("avatar_set", hasAvatar ? "Сменить аватар…" : "Установить аватар…", "🖼️"),
        ...(hasAvatar ? [makeItem("avatar_remove", "Удалить аватар", "🗑️", { danger: true })] : []),
      ]);
      if (isOwner) {
        addGroup([makeItem("room_clear", "Очистить историю (для всех)", "🧹", { danger: true, disabled: !canAct })]);
      }
      addGroup([
        isOwner
          ? makeItem("group_disband", "Удалить чат (для всех)", "🗑️", { danger: true, disabled: !canAct })
          : makeItem("group_leave", "Покинуть чат", "🚪", { danger: true, disabled: !canAct }),
      ]);
    } else if (target.kind === "board") {
      const b = st.boards.find((x) => x.id === target.id);
      const name = String(b?.name || target.id);
      const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
      title = `Доска: ${name}`;
      const pinKey = roomKey(target.id);
      const isPinned = st.pinned.includes(pinKey);
      const isArchived = st.archived.includes(pinKey);
      const isMuted = st.muted.includes(target.id);
      const canSelectMessages = (() => {
        const sel = st.selected;
        if (!sel || st.page !== "main") return false;
        if (sel.kind !== "board" || sel.id !== target.id) return false;
        const key = conversationKey(sel);
        const conv = key ? st.conversations[key] : null;
        if (!Array.isArray(conv) || !conv.length) return false;
        return conv.some((m) => isChatMessageSelectable(m));
      })();
      addGroup([
        makeItem("open", "Открыть", "💬"),
        makeItem("board_profile", "Профиль доски", "📌"),
        ...(canSelectMessages ? [makeItem("chat_select_messages", "Выбрать сообщения", "✅")] : []),
        makeItem("pin_toggle", isPinned ? "Открепить" : "Закрепить", isPinned ? "📍" : "📌"),
        makeItem("archive_toggle", isArchived ? "Убрать из архива" : "В архив", "🗄️"),
      ]);
      const folders = Array.isArray(st.chatFolders) ? st.chatFolders : [];
      const folderItems: ContextMenuItem[] = [];
      folderItems.push(makeItem("folder_create", "Создать папку…", "📁", { disabled: !st.authed }));
      for (const f of folders) {
        const fid = String((f as any)?.id || "").trim();
        if (!fid) continue;
        const title = String((f as any)?.title || "").trim();
        if (!title) continue;
        const emoji = typeof (f as any)?.emoji === "string" ? String((f as any).emoji).trim() : "";
        const label = emoji ? `${emoji} ${title}` : title;
        const inFolder = Array.isArray((f as any)?.include) ? (f as any).include.includes(pinKey) : false;
        folderItems.push(makeItem(`folder_toggle:${fid}`, label, inFolder ? "✓" : "○"));
      }
      addGroup(folderItems);
      if (isOwner) {
        addGroup([
          makeItem("board_rename", "Переименовать…", "✏️", { disabled: !canAct }),
          makeItem("board_add_members", "Добавить участников…", "➕", { disabled: !canAct }),
          makeItem("board_remove_members", "Удалить участников…", "➖", { danger: true, disabled: !canAct }),
        ]);
      }
      addGroup([
        makeItem("avatar_set", hasAvatar ? "Сменить аватар…" : "Установить аватар…", "🖼️"),
        ...(hasAvatar ? [makeItem("avatar_remove", "Удалить аватар", "🗑️", { danger: true })] : []),
      ]);
      if (isOwner) {
        addGroup([makeItem("room_clear", "Очистить историю (для всех)", "🧹", { danger: true, disabled: !canAct })]);
      }
      addGroup([
        isOwner
          ? makeItem("board_disband", "Удалить доску (для всех)", "🗑️", { danger: true, disabled: !canAct })
          : makeItem("board_leave", "Покинуть доску", "🚪", { danger: true, disabled: !canAct }),
      ]);
    } else if (target.kind === "auth_in") {
      title = `Запрос: ${target.id}`;
      const isBlocked = st.blocked.includes(target.id);
      addGroup([
        makeItem("copy_id", "Скопировать ID", "🆔"),
        makeItem("avatar_set", hasAvatar ? "Сменить аватар…" : "Установить аватар…", "🖼️"),
        ...(hasAvatar ? [makeItem("avatar_remove", "Удалить аватар", "🗑️", { danger: true })] : []),
      ]);
      addGroup([
        makeItem("auth_accept", "Принять", "✅", { disabled: !canAct }),
        makeItem("auth_decline", "Отклонить", "❌", { danger: true, disabled: !canAct }),
        makeItem("block_toggle", isBlocked ? "Разблокировать" : "Заблокировать", isBlocked ? "🔓" : "⛔", {
          disabled: !canAct,
        }),
      ]);
    } else if (target.kind === "auth_out") {
      title = `Ожидает: ${target.id}`;
      addGroup([
        makeItem("copy_id", "Скопировать ID", "🆔"),
        makeItem("avatar_set", hasAvatar ? "Сменить аватар…" : "Установить аватар…", "🖼️"),
        ...(hasAvatar ? [makeItem("avatar_remove", "Удалить аватар", "🗑️", { danger: true })] : []),
      ]);
      addGroup([makeItem("auth_cancel", "Отменить запрос", "❌", { danger: true, disabled: !canAct })]);
    } else if (target.kind === "message") {
      const selKey = st.selected ? conversationKey(st.selected) : "";
      const idx = Number.isFinite(Number(target.id)) ? Math.trunc(Number(target.id)) : -1;
      const conv = selKey ? st.conversations[selKey] : null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
      const selectionId = msg ? messageSelectionKey(msg) : null;
      const selectionActive = Boolean(st.chatSelection && st.chatSelection.key === selKey);
      const selectionSelected = Boolean(selectionActive && selectionId && st.chatSelection?.ids?.includes(selectionId));
      const canSelect = Boolean(selectionId && msg?.kind !== "sys");
      const canPin = Boolean(selKey && msgId !== null && msgId > 0);
      const isPinned = Boolean(canPin && msgId !== null && isPinnedMessage(st.pinnedMessages, selKey, msgId));
      const mine = typeof msg?.reactions?.mine === "string" ? msg.reactions.mine : null;
      reactionBar = { emojis: ["👍", "❤️", "😂", "😮", "😢", "🔥"], active: mine };

      const selectedText = getSelectedMessageText(selKey, idx);

      const preview =
        msg?.attachment?.kind === "file"
          ? `Файл: ${String(msg.attachment.name || "файл")}`
          : String(msg?.text || "").trim() || "Сообщение";
      title = preview.length > 64 ? `${preview.slice(0, 61)}…` : preview;

      const fromId = msg?.from ? String(msg.from).trim() : "";
      const caption = msg?.attachment?.kind === "file" ? String(msg?.text || "").trim() : "";
      const copyLabel =
        selectedText
          ? "Скопировать выделенное"
          : msg?.attachment?.kind === "file"
            ? caption
              ? "Скопировать подпись"
              : "Скопировать имя файла"
            : "Скопировать текст";
      const canEdit = Boolean(canPin && msg?.kind === "out" && st.selfId && String(msg.from) === String(st.selfId));
      const canDeleteForAll = Boolean(canPin && canAct && msg?.kind === "out" && st.selfId && String(msg.from) === String(st.selfId));
      const canReply = Boolean(msg && msg.kind !== "sys");
      const helperBlocked = Boolean(st.editing);
      const translateText = (() => {
        const raw = String(msg?.text || "").trim();
        if (!raw || raw.startsWith("[file]")) return "";
        return raw;
      })();
      const scheduleAt =
        msg && typeof msg.scheduleAt === "number" && Number.isFinite(msg.scheduleAt) && msg.scheduleAt > 0 ? Math.trunc(msg.scheduleAt) : 0;
      const canEditSchedule = Boolean(msg?.kind === "out" && scheduleAt > Date.now() + OUTBOX_SCHEDULE_GRACE_MS);
      const scheduleGroup: ContextMenuItem[] = [];
      if (canEditSchedule) {
        const localId = typeof msg?.localId === "string" ? msg.localId.trim() : "";
        const canLocalOutbox = Boolean(st.authed && localId);
        scheduleGroup.push(makeItem("msg_send_now", "Отправить сейчас", "⚡", { disabled: !canLocalOutbox }));
        scheduleGroup.push(makeItem("msg_schedule_edit", "Изменить время…", "🗓", { disabled: !canLocalOutbox }));
      }
      addGroup(scheduleGroup);
      const repliesCount = (() => {
        if (!conv || !msg) return 0;
        const msgLocalId = typeof msg.localId === "string" ? msg.localId.trim() : "";
        if (msgId === null && !msgLocalId) return 0;
        let count = 0;
        for (let i = idx + 1; i < conv.length; i += 1) {
          const ref = (conv[i] as any)?.reply;
          if (!ref) continue;
          const refId = typeof ref.id === "number" && Number.isFinite(ref.id) ? ref.id : null;
          const refLocalId = typeof ref.localId === "string" ? ref.localId.trim() : "";
          const matchById = msgId !== null && msgId > 0 && refId === msgId;
          const matchByLocalId = msgLocalId && refLocalId && refLocalId === msgLocalId;
          if (matchById || matchByLocalId) count += 1;
        }
        return count;
      })();
      const hasReactions = Boolean(
        msg?.reactions?.counts && typeof msg.reactions.counts === "object" && Object.keys(msg.reactions.counts).length
      );
      const primary: ContextMenuItem[] = [];
      if (fromId) primary.push(makeItem("msg_profile", "Профиль отправителя", "👤", { disabled: !canAct }));
      primary.push(
        makeItem("msg_select_toggle", selectionSelected ? "Снять выбор" : "Выбрать", selectionSelected ? "☑️" : "✅", {
          disabled: !canSelect,
        })
      );
      primary.push(makeItem("msg_copy", copyLabel, "📋", { disabled: !msg }));
      if (selectedText) primary.push(makeItem("msg_search_selection", "Искать выделенное", "🔍", { disabled: !msg }));
      primary.push(makeItem("msg_quote", selectedText ? "Цитировать выделенное" : "Цитировать", "❝", { disabled: !canReply || helperBlocked }));
      primary.push(makeItem("msg_reply", "Ответить", "↩", { disabled: !canReply || helperBlocked }));
      if (repliesCount > 0) primary.push(makeItem("msg_view_replies", `Ответы (${repliesCount})`, "🧵"));
      primary.push(makeItem("msg_forward", "Переслать", "↪", { disabled: !canReply || helperBlocked }));
      if (hasReactions && msgId !== null && msgId > 0) primary.push(makeItem("msg_reactions", "Реакции…", "😊", { disabled: !msg }));
      if (translateText) primary.push(makeItem("msg_translate", "Перевести", "🌐"));
      addGroup(primary);

      const fileGroup: ContextMenuItem[] = [];
      if ((msg as any)?.attachment?.kind === "file") {
        const fileId = String((msg as any).attachment.fileId || "").trim();
        const hasLocalUrl = Boolean(
          fileId && st.fileTransfers.find((t) => String(t.id || "").trim() === fileId && Boolean((t as any).url))
        );
        fileGroup.push(makeItem("msg_download", "Скачать", "⬇️", { disabled: !(fileId && (canAct || hasLocalUrl)) }));
        fileGroup.push(makeItem("msg_copy_link", "Скопировать ссылку", "🔗", { disabled: !(fileId && canAct) }));
      }
      addGroup(fileGroup);

      const editGroup: ContextMenuItem[] = [
        makeItem("msg_pin_toggle", isPinned ? "Открепить" : "Закрепить", isPinned ? "📍" : "📌", { disabled: !canPin }),
      ];
      if (canEdit) {
        editGroup.push(
          makeItem("msg_edit", (msg as any)?.attachment ? "Изменить подпись…" : "Изменить…", st.selected?.kind === "board" ? "✏️" : "🛠️", {
            disabled: !canAct,
          })
        );
      }
      addGroup(editGroup);

      const dangerGroup: ContextMenuItem[] = [makeItem("msg_delete_local", "Удалить у меня", "🧹", { danger: true, disabled: !msg })];
      if (canDeleteForAll) {
        dangerGroup.push(makeItem("msg_delete", "Удалить", "🗑️", { danger: true, disabled: !canAct }));
      }
      addGroup(dangerGroup);
    }

    store.set({
      modal: {
        kind: "context_menu",
        payload: {
          x,
          y,
          title,
          target,
          items,
          ...(reactionBar ? { reactionBar } : {}),
        },
      },
    });
  }

  return { openContextMenu };
}

