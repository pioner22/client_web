import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { applyLegacyIdMask } from "../../helpers/id/legacyIdMask";
import { focusElement } from "../../helpers/ui/focus";
import type { AppState, SearchResultEntry, TargetRef } from "../../stores/types";

export interface SearchPageActions {
  onQueryChange: (query: string) => void;
  onSubmit: (query: string) => void;
  onSelectTarget: (t: TargetRef) => void;
  onAuthRequest: (peer: string) => void;
  onAuthAccept: (peer: string) => void;
  onAuthDecline: (peer: string) => void;
  onAuthCancel: (peer: string) => void;
  onGroupJoin: (groupId: string) => void;
  onBoardJoin: (boardId: string) => void;
}

export interface SearchPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

function inferTarget(entry: SearchResultEntry): TargetRef {
  if (entry.board) return { kind: "board", id: entry.id };
  if (entry.group) return { kind: "group", id: entry.id };
  return { kind: "dm", id: entry.id };
}

function resultLabel(r: SearchResultEntry): string {
  if (r.board) return `# ${r.id}`;
  if (r.group) return `# ${r.id}`;
  const dot = r.online ? "●" : "○";
  const star = r.friend ? "★" : " ";
  return `${star} ${dot} ${r.id}`;
}

function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

export function createSearchPage(actions: SearchPageActions): SearchPage {
  const title = el("div", { class: "chat-title" }, ["Поиск"]);

  const input = el("input", {
    class: "modal-input",
    type: "text",
    placeholder: "@handle или ID",
    "data-ios-assistant": "off",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "search",
  }) as HTMLInputElement;

  const btn = el("button", { class: "btn", type: "button" }, ["Искать"]);

  const form = el("div", { class: "page-form" }, [input, btn]);
  const results = el("div", { class: "page-results" });
  const hint = el("div", { class: "msg msg-sys page-hint" }, ["Enter — искать | Esc — назад"]);

  const root = el("div", { class: "page" }, [title, form, results, hint]);

  function submit() {
    const q = input.value.trim();
    actions.onSubmit(q);
  }

  btn.addEventListener("click", () => submit());

  input.addEventListener("input", () => {
    applyLegacyIdMask(input);
    actions.onQueryChange(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });

  function update(state: AppState) {
    if (document.activeElement !== input && input.value !== state.searchQuery) {
      input.value = state.searchQuery;
    }

    const q = (state.searchQuery || "").trim();
    const digits = q.replace(/\D/g, "");
    const canSearchNow = q.startsWith("@") ? q.length >= 4 : digits ? digits.length >= 3 : q.length >= 3;

    const list = state.searchResults || [];
    if (!list.length) {
      if (!q) {
        results.replaceChildren(
          el("div", { class: "page-empty" }, [
            el("div", { class: "page-empty-title" }, ["Введите @handle или ID"]),
            el("div", { class: "page-empty-sub" }, ["По ID можно искать по первым 3 цифрам, список сужается по мере ввода"]),
          ])
        );
        return;
      }
      if (!canSearchNow) {
        results.replaceChildren(
          el("div", { class: "page-empty" }, [
            el("div", { class: "page-empty-title" }, ["Введите больше символов"]),
            el("div", { class: "page-empty-sub" }, ["Минимум: 3 цифры для ID или 4 символа для @handle"]),
          ])
        );
        return;
      }
      results.replaceChildren(
        el("div", { class: "page-empty" }, [
          el("div", { class: "page-empty-title" }, ["Ничего не найдено"]),
          el("div", { class: "page-empty-sub" }, ["Проверьте запрос или попробуйте другие первые цифры/буквы"]),
        ])
      );
      return;
    }

    results.replaceChildren(
      ...list.map((r) => {
        const isGroup = Boolean(r.group);
        const isBoard = Boolean(r.board);
        const isFriend = r.friend ?? state.friends.some((f) => f.id === r.id);
        const pendingIn = state.pendingIn.includes(r.id);
        const pendingOut = state.pendingOut.includes(r.id);
        const inGroup = state.groups.some((g) => g.id === r.id);
        const inBoard = state.boards.some((b) => b.id === r.id);
        const canOpen = isGroup ? inGroup : isBoard ? inBoard : isFriend;

        const rowChildren: Array<string | HTMLElement> = [];
        if (isGroup) {
          rowChildren.push(el("span", { class: "row-prefix", "aria-hidden": "true" }, ["#"]), avatar("group", r.id), el("span", { class: "row-label" }, [r.id]));
        } else if (isBoard) {
          rowChildren.push(el("span", { class: "row-prefix", "aria-hidden": "true" }, ["#"]), avatar("board", r.id), el("span", { class: "row-label" }, [r.id]));
        } else {
          const dot = r.online ? "●" : "○";
          const star = isFriend ? "★" : " ";
          rowChildren.push(
            el("span", { class: "row-star", "aria-hidden": "true" }, [star]),
            avatar("dm", r.id),
            el("span", { class: `row-dot ${r.online ? "row-dot-online" : "row-dot-offline"}`, "aria-hidden": "true" }, [dot]),
            el("span", { class: "row-id" }, [r.id])
          );
        }

        const rowBtn = el(
          "button",
          { class: "row", type: "button", ...(canOpen ? {} : { disabled: "true" }) },
          rowChildren.length ? rowChildren : [resultLabel(r)]
        );
        if (canOpen) rowBtn.addEventListener("click", () => actions.onSelectTarget(inferTarget(r)));

        const actionButtons: HTMLElement[] = [];
        if (isGroup) {
          if (!inGroup) {
            const joinBtn = el("button", { class: "btn", type: "button" }, ["Запросить вступление"]);
            joinBtn.addEventListener("click", () => actions.onGroupJoin(r.id));
            actionButtons.push(joinBtn);
          }
        } else if (isBoard) {
          if (!inBoard) {
            const joinBtn = el("button", { class: "btn", type: "button" }, ["Вступить"]);
            joinBtn.addEventListener("click", () => actions.onBoardJoin(r.id));
            actionButtons.push(joinBtn);
          }
        } else if (pendingIn) {
          const acceptBtn = el("button", { class: "btn", type: "button" }, ["Принять"]);
          const declineBtn = el("button", { class: "btn", type: "button" }, ["Отклонить"]);
          acceptBtn.addEventListener("click", () => actions.onAuthAccept(r.id));
          declineBtn.addEventListener("click", () => actions.onAuthDecline(r.id));
          actionButtons.push(acceptBtn, declineBtn);
        } else if (pendingOut) {
          const cancelBtn = el("button", { class: "btn", type: "button" }, ["Отменить запрос"]);
          cancelBtn.addEventListener("click", () => actions.onAuthCancel(r.id));
          actionButtons.push(cancelBtn);
        } else if (!isFriend && !isGroup && !isBoard) {
          const reqBtn = el("button", { class: "btn", type: "button" }, ["Запросить контакт"]);
          reqBtn.addEventListener("click", () => actions.onAuthRequest(r.id));
          actionButtons.push(reqBtn);
        }

        const meta: string[] = [];
        if (pendingIn) meta.push("Входящий запрос");
        if (pendingOut) meta.push("Ожидает подтверждения");
        if (isGroup && !inGroup) meta.push("Доступ по запросу");
        if (isBoard && !inBoard) meta.push("Открытая доска");

        const itemChildren: HTMLElement[] = [rowBtn];
        if (meta.length) {
          itemChildren.push(el("div", { class: "result-meta" }, [meta.join(" · ")]));
        }
        if (actionButtons.length) {
          itemChildren.push(el("div", { class: "page-actions" }, actionButtons));
        }

        return el("div", { class: "result-item" }, itemChildren);
      })
    );
  }

  return {
    root,
    update,
    focus: () => {
      focusElement(input, { select: true });
    },
  };
}
