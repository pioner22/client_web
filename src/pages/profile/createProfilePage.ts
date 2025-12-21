import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import type { AppState } from "../../stores/types";

export interface ProfilePageActions {
  onDraftChange: (draft: { displayName: string; handle: string }) => void;
  onSave: (draft: { displayName: string; handle: string }) => void;
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

  const meLine = el("div", { class: "msg msg-sys" }, ["Ваш профиль"]);

  const avatarTitle = el("div", { class: "pane-section" }, ["Аватар"]);
  const avatarPreview = el("div", { class: "avatar avatar-lg", "aria-label": "Аватар профиля" });
  const avatarFile = el("input", { class: "hidden", type: "file", accept: "image/*" }) as HTMLInputElement;
  const btnAvatarUpload = el("button", { class: "btn", type: "button" }, ["Загрузить…"]);
  const btnAvatarClear = el("button", { class: "btn", type: "button" }, ["Удалить"]);
  const avatarActions = el("div", { class: "page-actions" }, [btnAvatarUpload, btnAvatarClear, avatarFile]);
  const avatarRow = el("div", { class: "profile-avatar-row" }, [avatarPreview, avatarActions]);

  const displayNameLabel = el("div", { class: "pane-section" }, ["display_name"]);
  const displayNameInput = el("input", {
    class: "modal-input",
    type: "text",
    placeholder: "Имя",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const handleLabel = el("div", { class: "pane-section" }, ["handle (@name)"]);
  const handleInput = el("input", {
    class: "modal-input",
    type: "text",
    placeholder: "@name",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const skinLabel = el("div", { class: "pane-section" }, ["Скин интерфейса"]);
  const skinSelect = el("select", { class: "modal-input" }, []) as HTMLSelectElement;
  const skinHint = el("div", { class: "msg msg-sys" }, ["Скин хранится локально в браузере и применяется сразу"]);

  const btnSave = el("button", { class: "btn", type: "button" }, ["Сохранить"]);
  const btnRefresh = el("button", { class: "btn", type: "button" }, ["Обновить"]);
  const actionsRow = el("div", { class: "page-actions" }, [btnSave, btnRefresh]);

  const hint = el("div", { class: "msg msg-sys" }, ["Enter — сохранить | Esc — назад"]);

  const root = el("div", { class: "page" }, [
    title,
    meLine,
    avatarTitle,
    avatarRow,
    displayNameLabel,
    displayNameInput,
    handleLabel,
    handleInput,
    skinLabel,
    skinSelect,
    skinHint,
    actionsRow,
    hint,
  ]);

  function draft() {
    return { displayName: displayNameInput.value, handle: handleInput.value };
  }

  function save() {
    actions.onSave(draft());
  }

  btnSave.addEventListener("click", () => save());
  btnRefresh.addEventListener("click", () => actions.onRefresh());
  skinSelect.addEventListener("change", () => actions.onSkinChange(skinSelect.value));

  btnAvatarUpload.addEventListener("click", () => avatarFile.click());
  avatarFile.addEventListener("change", () => {
    const file = avatarFile.files && avatarFile.files.length ? avatarFile.files[0] : null;
    avatarFile.value = "";
    actions.onAvatarSelect(file);
  });
  btnAvatarClear.addEventListener("click", () => actions.onAvatarClear());

  displayNameInput.addEventListener("input", () => actions.onDraftChange(draft()));
  handleInput.addEventListener("input", () => actions.onDraftChange(draft()));

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

  function update(state: AppState) {
    const me = state.selfId ? state.profiles[state.selfId] : null;
    meLine.textContent = me ? `ID: ${me.id}  display_name=${me.display_name ?? "—"}  handle=${me.handle ?? "—"}` : "Ваш профиль";

    const myId = state.selfId || "";
    const url = myId ? getStoredAvatar("dm", myId) : null;
    const hue = avatarHue(`dm:${myId || "anon"}`);
    avatarPreview.style.setProperty("--avatar-h", String(hue));
    avatarPreview.classList.toggle("avatar-img", Boolean(url));
    avatarPreview.textContent = url ? "" : avatarMonogram("dm", myId);
    avatarPreview.style.backgroundImage = url ? `url(${url})` : "";
    (btnAvatarClear as HTMLButtonElement).disabled = !url;

    if (document.activeElement !== displayNameInput && displayNameInput.value !== state.profileDraftDisplayName) {
      displayNameInput.value = state.profileDraftDisplayName;
    }
    if (document.activeElement !== handleInput && handleInput.value !== state.profileDraftHandle) {
      handleInput.value = state.profileDraftHandle;
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
      displayNameInput.focus();
      displayNameInput.select();
    },
  };
}
