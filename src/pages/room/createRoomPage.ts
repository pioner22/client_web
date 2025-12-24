import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import type { AppState, TargetKind } from "../../stores/types";

export interface RoomPageActions {
  onBack: () => void;
  onOpenChat: (id: string) => void;
  onOpenUser: (id: string) => void;
  onRemoveMember: (kind: TargetKind, roomId: string, memberId: string) => void;
  onBlockToggle: (memberId: string) => void;
  onWriteToggle: (kind: TargetKind, roomId: string, memberId: string, value: boolean) => void;
  onRefresh: (kind: TargetKind, roomId: string) => void;
  onInfoSave: (kind: TargetKind, roomId: string, description: string, rules: string) => void;
  onLeave: (kind: TargetKind, roomId: string) => void;
  onDisband: (kind: TargetKind, roomId: string) => void;
}

export interface RoomPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

function formatUserLabel(displayName: string, handle: string, fallback: string): string {
  const dn = String(displayName || "").trim();
  if (dn) return dn;
  const h = String(handle || "").trim();
  if (h) return h.startsWith("@") ? h : `@${h}`;
  return fallback || "—";
}

function resolveMemberLabel(state: AppState, id: string): { label: string; handle: string } {
  const pid = String(id || "").trim();
  if (!pid) return { label: "—", handle: "" };
  const p = state.profiles?.[pid];
  if (p) {
    const h = String(p.handle || "").trim();
    return { label: formatUserLabel(p.display_name || "", h, pid), handle: h };
  }
  const friend = state.friends.find((f) => f.id === pid);
  if (friend) {
    const h = String(friend.handle || "").trim();
    return { label: formatUserLabel(friend.display_name || "", h, pid), handle: h };
  }
  return { label: pid, handle: "" };
}

function avatar(kind: TargetKind, id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const node = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  node.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) node.style.backgroundImage = `url(${url})`;
  return node;
}

export function createRoomPage(kind: TargetKind, actions: RoomPageActions): RoomPage {
  const titleText = kind === "group" ? "Чат" : "Доска";
  const title = el("div", { class: "chat-title" }, [titleText]);

  const profileName = el("div", { class: "profile-name" }, ["—"]);
  const profileHandle = el("div", { class: "profile-handle" }, ["—"]);
  const profileId = el("div", { class: "profile-id" }, [""]);

  const avatarView = el("div", { class: "avatar avatar-xl profile-avatar-btn", role: "img", "aria-label": `Аватар ${titleText.toLowerCase()}` });
  const headTop = el("div", { class: "profile-head-top" }, [avatarView, el("div", { class: "profile-head-main" }, [profileName, profileHandle, profileId])]);
  const head = el("div", { class: "profile-card profile-head" }, [headTop]);

  const ownerValue = el("div", { class: "profile-field-value" }, ["—"]);
  const handleValue = el("div", { class: "profile-field-value" }, ["—"]);
  const postValue = el("div", { class: "profile-field-value" }, ["—"]);
  const about = el("div", { class: "profile-card" }, [
    el("div", { class: "profile-card-title" }, [titleText]),
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["Владелец"]), ownerValue]),
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["Писать"]), postValue]),
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["Ссылка"]), handleValue]),
  ]);

  const descriptionLabel = el("div", { class: "profile-field-label" }, ["Описание"]);
  const descriptionValue = el("div", { class: "profile-field-value profile-text" }, ["—"]);
  const descriptionInput = el("textarea", {
    class: "modal-input profile-textarea",
    id: `${kind}-description`,
    rows: "4",
    maxlength: "2000",
    placeholder: "Описание чата/доски",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
  }) as HTMLTextAreaElement;
  const descriptionField = el("div", { class: "profile-field" }, [descriptionLabel, descriptionValue, descriptionInput]);

  const rulesLabel = el("div", { class: "profile-field-label" }, ["Правила"]);
  const rulesValue = el("div", { class: "profile-field-value profile-text" }, ["—"]);
  const rulesInput = el("textarea", {
    class: "modal-input profile-textarea",
    id: `${kind}-rules`,
    rows: "5",
    maxlength: "2000",
    placeholder: "Правила и рекомендации",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
  }) as HTMLTextAreaElement;
  const rulesField = el("div", { class: "profile-field" }, [rulesLabel, rulesValue, rulesInput]);

  const btnInfoSave = el("button", { class: "btn btn-primary", type: "button" }, ["Сохранить"]);
  const infoActions = el("div", { class: "profile-actions" }, [btnInfoSave]);
  const infoCard = el("div", { class: "profile-card" }, [
    el("div", { class: "profile-card-title" }, ["Описание и правила"]),
    descriptionField,
    rulesField,
    infoActions,
  ]);

  const membersTitle = el("div", { class: "profile-card-title" }, ["Участники"]);
  const membersCount = el("div", { class: "profile-members-count" }, ["0"]);
  const membersHead = el("div", { class: "profile-members-head" }, [membersTitle, membersCount]);
  const membersList = el("div", { class: "members-list" }, []);
  const membersCard = el("div", { class: "profile-card" }, [membersHead, membersList]);

  const btnLeave = el("button", { class: "btn", type: "button" }, [`Покинуть ${titleText.toLowerCase()}`]);
  const btnDisband = el("button", { class: "btn btn-danger", type: "button" }, [`Удалить ${titleText.toLowerCase()} (для всех)`]);
  const manageActions = el("div", { class: "profile-actions" }, [btnLeave, btnDisband]);
  const manageCard = el("div", { class: "profile-card" }, [el("div", { class: "profile-card-title" }, ["Управление"]), manageActions]);

  const btnChat = el("button", { class: "btn btn-primary", type: "button" }, ["Открыть чат"]);
  const btnRefresh = el("button", { class: "btn", type: "button" }, ["Обновить"]);
  const actionsRow = el("div", { class: "page-actions" }, [btnChat, btnRefresh]);

  const hint = el("div", { class: "msg msg-sys page-hint" }, ["Esc — назад"]);

  const root = el("div", { class: "page page-profile page-room" }, [title, head, about, infoCard, membersCard, manageCard, actionsRow, hint]);

  let currentRoomId = "";
  let currentIsOwner = false;
  let lastRoomKey = "";
  let lastDescription = "";
  let lastRules = "";
  let draftDescription = "";
  let draftRules = "";

  const normalizeInfo = (value: string) => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  const updateInfoSaveState = () => {
    const dirty = normalizeInfo(draftDescription) !== normalizeInfo(lastDescription) || normalizeInfo(draftRules) !== normalizeInfo(lastRules);
    btnInfoSave.disabled = !currentIsOwner || !currentRoomId || !dirty;
  };

  btnChat.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    actions.onOpenChat(roomId);
  });

  btnRefresh.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    actions.onRefresh(kind, roomId);
  });

  btnLeave.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    actions.onLeave(kind, roomId);
  });

  btnDisband.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    actions.onDisband(kind, roomId);
  });

  descriptionInput.addEventListener("input", () => {
    draftDescription = descriptionInput.value;
    updateInfoSaveState();
  });

  rulesInput.addEventListener("input", () => {
    draftRules = rulesInput.value;
    updateInfoSaveState();
  });

  btnInfoSave.addEventListener("click", () => {
    if (!currentRoomId) return;
    const description = normalizeInfo(draftDescription);
    const rules = normalizeInfo(draftRules);
    actions.onInfoSave(kind, currentRoomId, description, rules);
  });

  function renderMembers(state: AppState, roomId: string, ownerId: string) {
    const entry = kind === "group" ? state.groups.find((g) => g.id === roomId) : state.boards.find((b) => b.id === roomId);
    const members = entry?.members ? [...entry.members] : [];
    if (ownerId && !members.includes(ownerId)) members.unshift(ownerId);
    const uniqMembers = Array.from(new Set(members.map((m) => String(m || "").trim()).filter(Boolean)));

    membersCount.textContent = String(uniqMembers.length);
    if (!uniqMembers.length) {
      membersList.replaceChildren(el("div", { class: "members-empty" }, ["Список участников пока пуст"]));
      return;
    }

    const me = String(state.selfId || "").trim();
    const isOwner = Boolean(ownerId && me && ownerId === me);
    const blockedSet = new Set(state.blocked || []);
    const groupEntry = kind === "group" ? (entry as AppState["groups"][number] | undefined) : undefined;
    const postBannedSet = new Set(
      (groupEntry?.post_banned || []).map((m) => String(m || "").trim()).filter(Boolean)
    );

    const rows = uniqMembers.map((mid) => {
      const memberId = String(mid || "").trim();
      const labels = resolveMemberLabel(state, memberId);
      const row = el("div", { class: "member-row", "data-member-id": memberId }, []);
      const main = el("div", { class: "member-main" }, [
        avatar("dm", memberId),
        el("div", { class: "member-meta" }, [
          el("div", { class: "member-name" }, [labels.label]),
          el("div", { class: "member-sub" }, [labels.handle ? (labels.handle.startsWith("@") ? labels.handle : `@${labels.handle}`) : `ID: ${memberId}`]),
        ]),
      ]);

      const badges: HTMLElement[] = [];
      if (memberId === ownerId) badges.push(el("span", { class: "member-badge" }, ["Владелец"]));
      if (me && memberId === me) badges.push(el("span", { class: "member-badge member-badge-self" }, ["Вы"]));
      if (blockedSet.has(memberId)) badges.push(el("span", { class: "member-badge member-badge-warn" }, ["Заблокирован"]));
      if (kind === "group" && postBannedSet.has(memberId))
        badges.push(el("span", { class: "member-badge member-badge-muted" }, ["Запрет писать"]));

      const badgeWrap = badges.length ? el("div", { class: "member-badges" }, badges) : null;
      if (badgeWrap) main.append(badgeWrap);

      const actionsWrap = el("div", { class: "member-actions" }, []);
      const btnProfile = el("button", { class: "btn", type: "button" }, ["Профиль"]);
      btnProfile.addEventListener("click", () => actions.onOpenUser(memberId));
      actionsWrap.append(btnProfile);

      if (memberId !== me) {
        const blocked = blockedSet.has(memberId);
        const btnBlock = el("button", { class: blocked ? "btn btn-active" : "btn", type: "button" }, [blocked ? "Разблокировать" : "Блокировать"]);
        btnBlock.addEventListener("click", () => actions.onBlockToggle(memberId));
        actionsWrap.append(btnBlock);
      }

      if (isOwner && kind === "group" && memberId && memberId !== ownerId) {
        const banned = postBannedSet.has(memberId);
        const btnWrite = el("button", { class: banned ? "btn btn-active" : "btn", type: "button" }, [banned ? "Разрешить писать" : "Запретить писать"]);
        btnWrite.addEventListener("click", () => actions.onWriteToggle(kind, roomId, memberId, !banned));
        actionsWrap.append(btnWrite);
      }

      if (isOwner && memberId && memberId !== ownerId) {
        const btnRemove = el("button", { class: "btn btn-danger", type: "button" }, ["Удалить"]);
        btnRemove.addEventListener("click", () => actions.onRemoveMember(kind, roomId, memberId));
        actionsWrap.append(btnRemove);
      }

      row.append(main, actionsWrap);
      return row;
    });
    membersList.replaceChildren(...rows);
  }

  function update(state: AppState) {
    const roomId = String(kind === "group" ? state.groupViewId || "" : state.boardViewId || "").trim();

    const entry = kind === "group" ? state.groups.find((g) => g.id === roomId) : state.boards.find((b) => b.id === roomId);
    const name = String(entry?.name || roomId || "—");
    const handle = String(entry?.handle || "").trim();
    const ownerId = String(entry?.owner_id || "").trim();
    const description = String(entry?.description || "");
    const rules = String(entry?.rules || "");
    const roomKey = `${kind}:${roomId}`;
    const me = String(state.selfId || "").trim();
    const isOwner = Boolean(ownerId && me && String(ownerId) === String(me));
    const members = Array.isArray(entry?.members) ? entry?.members || [] : [];
    const isMember = Boolean(me && (isOwner || members.includes(me)));

    profileName.textContent = name || "—";
    profileHandle.textContent = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : "Ссылка не задана";
    profileId.textContent = roomId ? `ID: ${roomId}` : "";

    ownerValue.textContent = ownerId || "—";
    handleValue.textContent = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : "—";
    if (!roomId) {
      postValue.textContent = "—";
    } else if (kind === "board") {
      postValue.textContent = "Только владелец";
    } else {
      const groupEntry = entry as AppState["groups"][number] | undefined;
      const bannedCount = Array.isArray(groupEntry?.post_banned) ? groupEntry?.post_banned?.length || 0 : 0;
      postValue.textContent = bannedCount > 0 ? "Ограничено" : "Все участники";
    }

    const url = roomId ? getStoredAvatar(kind, roomId) : null;
    avatarView.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${roomId || "anon"}`)));
    avatarView.classList.toggle("avatar-img", Boolean(url));
    avatarView.textContent = url ? "" : avatarMonogram(kind, roomId);
    (avatarView as HTMLElement).style.backgroundImage = url ? `url(${url})` : "";

    renderMembers(state, roomId, ownerId);

    (btnChat as HTMLButtonElement).disabled = !roomId;
    (btnRefresh as HTMLButtonElement).disabled = !roomId;
    const canLeave = Boolean(roomId && isMember && !isOwner);
    const canDisband = Boolean(roomId && isOwner);
    btnLeave.classList.toggle("hidden", !canLeave);
    btnDisband.classList.toggle("hidden", !canDisband);
    manageCard.classList.toggle("hidden", !canLeave && !canDisband);
    (btnLeave as HTMLButtonElement).disabled = !canLeave;
    (btnDisband as HTMLButtonElement).disabled = !canDisband;

    currentRoomId = roomId;
    currentIsOwner = isOwner;
    root.setAttribute("data-room-id", roomId);

    if (roomKey !== lastRoomKey) {
      lastRoomKey = roomKey;
      lastDescription = description;
      lastRules = rules;
      draftDescription = description;
      draftRules = rules;
      descriptionInput.value = description;
      rulesInput.value = rules;
    } else {
      if (document.activeElement !== descriptionInput && description !== lastDescription) {
        lastDescription = description;
        draftDescription = description;
        descriptionInput.value = description;
      }
      if (document.activeElement !== rulesInput && rules !== lastRules) {
        lastRules = rules;
        draftRules = rules;
        rulesInput.value = rules;
      }
    }

    descriptionValue.textContent = description || "Описание не задано";
    rulesValue.textContent = rules || "Правила не заданы";
    descriptionInput.classList.toggle("hidden", !isOwner);
    rulesInput.classList.toggle("hidden", !isOwner);
    descriptionValue.classList.toggle("hidden", isOwner);
    rulesValue.classList.toggle("hidden", isOwner);
    infoActions.classList.toggle("hidden", !isOwner);
    updateInfoSaveState();
  }

  return {
    root,
    update,
    focus: () => {
      if (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) return;
      btnChat.focus();
    },
  };
}
