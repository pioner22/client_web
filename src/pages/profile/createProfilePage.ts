import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { focusElement } from "../../helpers/ui/focus";
import type { AppState } from "../../stores/types";

export interface ProfilePageActions {
  onDraftChange: (draft: { displayName: string; handle: string; bio: string; status: string }) => void;
  onSave: (draft: { displayName: string; handle: string; bio: string; status: string }) => void;
  onRefresh: () => void;
  onSkinChange: (skinId: string) => void;
  onAvatarSelect: (file: File | null) => void;
  onAvatarClear: () => void;
}

export interface ProfilePage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

export function createProfilePage(actions: ProfilePageActions): ProfilePage {
  const title = el("div", { class: "chat-title" }, ["Профиль"]);

  const profileName = el("div", { class: "profile-name" }, ["—"]);
  const profileHandle = el("div", { class: "profile-handle" }, ["—"]);
  const profileId = el("div", { class: "profile-id" }, [""]);

  const avatarPreview = el("button", { class: "avatar avatar-xl profile-avatar-btn", type: "button", "aria-label": "Аватар профиля" });
  const avatarFile = el("input", { class: "hidden", type: "file", accept: "image/*" }) as HTMLInputElement;
  const btnAvatarUpload = el("button", { class: "btn", type: "button" }, ["Загрузить…"]);
  const btnAvatarClear = el("button", { class: "btn btn-danger", type: "button" }, ["Удалить"]);
  const avatarActions = el("div", { class: "profile-head-actions" }, [btnAvatarUpload, btnAvatarClear, avatarFile]);
  const headTop = el("div", { class: "profile-head-top" }, [avatarPreview, el("div", { class: "profile-head-main" }, [profileName, profileHandle, profileId])]);
  const head = el("div", { class: "profile-card profile-head" }, [headTop, avatarActions]);

  const displayNameLabel = el("label", { class: "modal-label", for: "profile-display-name" }, ["Имя"]);
  const displayNameInput = el("input", {
    class: "modal-input",
    type: "text",
    id: "profile-display-name",
    placeholder: "Имя",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const handleLabel = el("label", { class: "modal-label", for: "profile-handle" }, ["Логин (@name)"]);
  const handleInput = el("input", {
    class: "modal-input",
    type: "text",
    id: "profile-handle",
    placeholder: "@name",
    "data-ios-assistant": "off",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const statusLabel = el("label", { class: "modal-label", for: "profile-status" }, ["Статус"]);
  const statusInput = el("input", {
    class: "modal-input",
    type: "text",
    id: "profile-status",
    placeholder: "Например: на связи",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const bioLabel = el("label", { class: "modal-label", for: "profile-bio" }, ["О себе"]);
  const bioInput = el("textarea", {
    class: "modal-input",
    id: "profile-bio",
    placeholder: "Коротко о себе…",
    rows: "4",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLTextAreaElement;

  const skinLabel = el("label", { class: "modal-label", for: "profile-skin" }, ["Скин интерфейса"]);
  const skinSelect = el("select", { class: "modal-input", id: "profile-skin" }, []) as HTMLSelectElement;
  const skinHint = el("div", { class: "profile-hint" }, ["Скин хранится локально в браузере и применяется сразу"]);

  const btnSave = el("button", { class: "btn btn-primary", type: "button" }, ["Сохранить"]);
  const btnRefresh = el("button", { class: "btn", type: "button" }, ["Обновить"]);
  const actionsRow = el("div", { class: "page-actions" }, [btnSave, btnRefresh]);

  const hint = el("div", { class: "msg msg-sys page-hint" }, ["Enter — сохранить · Esc — назад"]);

  const account = el("div", { class: "profile-card" }, [
    el("div", { class: "profile-card-title" }, ["Аккаунт"]),
    displayNameLabel,
    displayNameInput,
    handleLabel,
    handleInput,
    statusLabel,
    statusInput,
    bioLabel,
    bioInput,
  ]);

  const ui = el("div", { class: "profile-card" }, [el("div", { class: "profile-card-title" }, ["Интерфейс"]), skinLabel, skinSelect, skinHint]);

  const root = el("div", { class: "page page-profile" }, [
    title,
    head,
    account,
    ui,
    actionsRow,
    hint,
  ]);

  function draft() {
    return { displayName: displayNameInput.value, handle: handleInput.value, bio: bioInput.value, status: statusInput.value };
  }

  function save() {
    actions.onSave(draft());
  }

  btnSave.addEventListener("click", () => save());
  btnRefresh.addEventListener("click", () => actions.onRefresh());
  skinSelect.addEventListener("change", () => actions.onSkinChange(skinSelect.value));

  avatarPreview.addEventListener("click", () => avatarFile.click());
  btnAvatarUpload.addEventListener("click", () => avatarFile.click());
  avatarFile.addEventListener("change", () => {
    const file = avatarFile.files && avatarFile.files.length ? avatarFile.files[0] : null;
    avatarFile.value = "";
    actions.onAvatarSelect(file);
  });
  btnAvatarClear.addEventListener("click", () => actions.onAvatarClear());

  displayNameInput.addEventListener("input", () => actions.onDraftChange(draft()));
  handleInput.addEventListener("input", () => actions.onDraftChange(draft()));
  statusInput.addEventListener("input", () => actions.onDraftChange(draft()));
  bioInput.addEventListener("input", () => actions.onDraftChange(draft()));

  handleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });
  displayNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });
  statusInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });

  function update(state: AppState) {
    const me = state.selfId ? state.profiles[state.selfId] : null;
    profileName.textContent = me?.display_name ? me.display_name : "Без имени";
    const h = me?.handle ? String(me.handle).trim() : "";
    profileHandle.textContent = h ? (h.startsWith("@") ? h : `@${h}`) : "Логин не задан";
    profileId.textContent = me?.id ? `ID: ${me.id}` : "";

    const myId = state.selfId || "";
    const url = myId ? getStoredAvatar("dm", myId) : null;
    const hue = avatarHue(`dm:${myId || "anon"}`);
    avatarPreview.style.setProperty("--avatar-h", String(hue));
    avatarPreview.classList.toggle("avatar-img", Boolean(url));
    avatarPreview.textContent = url ? "" : avatarMonogram("dm", myId);
    avatarPreview.style.backgroundImage = url ? `url(${url})` : "";
    const hasServerAvatar = Boolean((me?.avatar_rev || 0) > 0 && me?.avatar_mime);
    (btnAvatarClear as HTMLButtonElement).disabled = !url && !hasServerAvatar;

    if (document.activeElement !== displayNameInput && displayNameInput.value !== state.profileDraftDisplayName) {
      displayNameInput.value = state.profileDraftDisplayName;
    }
    if (document.activeElement !== handleInput && handleInput.value !== state.profileDraftHandle) {
      handleInput.value = state.profileDraftHandle;
    }
    if (document.activeElement !== statusInput && statusInput.value !== state.profileDraftStatus) {
      statusInput.value = state.profileDraftStatus;
    }
    if (document.activeElement !== bioInput && bioInput.value !== state.profileDraftBio) {
      bioInput.value = state.profileDraftBio;
    }

    const skins = state.skins || [];
    const sig = skins.map((s) => s.id).join("|");
    if (skinSelect.dataset.sig !== sig) {
      skinSelect.dataset.sig = sig;
      skinSelect.replaceChildren(
        ...skins.map((s) => {
          const opt = el("option", { value: s.id }, [s.title]);
          (opt as HTMLOptionElement).selected = s.id === state.skin;
          return opt;
        })
      );
    }
    if (document.activeElement !== skinSelect && skinSelect.value !== state.skin) {
      skinSelect.value = state.skin;
    }
  }

  return {
    root,
    update,
    focus: () => {
      if (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) return;
      focusElement(displayNameInput, { select: true });
    },
  };
}
