import { el } from "../../helpers/dom/el";
import type { AppState } from "../../stores/types";

function viewTitle(state: AppState): string {
  if (state.page === "search") return "Поиск";
  if (state.page === "help") return "Info";
  if (state.page === "profile") return "Профиль";
  if (state.page === "user") {
    const id = String(state.userViewId || "").trim();
    const p = id ? state.profiles?.[id] : null;
    const dn = p?.display_name ? String(p.display_name).trim() : "";
    return dn ? `Контакт: ${dn}` : "Контакт";
  }
  if (state.page === "group") {
    const id = String(state.groupViewId || "").trim();
    const g = id ? state.groups?.find((x) => x.id === id) : null;
    return `Чат: ${String(g?.name || id || "—")}`;
  }
  if (state.page === "board") {
    const id = String(state.boardViewId || "").trim();
    const b = id ? state.boards?.find((x) => x.id === id) : null;
    return `Доска: ${String(b?.name || id || "—")}`;
  }
  if (state.page === "files") return "Файлы";
  if (state.page === "group_create") return "Создать чат";
  if (state.page === "board_create") return "Создать доску";
  const sel = state.selected;
  if (!sel) return "Чат";
  if (sel.kind === "dm") {
    const p = state.profiles?.[sel.id];
    const dn = p?.display_name ? String(p.display_name).trim() : "";
    const h = p?.handle ? String(p.handle).trim() : "";
    const label = dn || (h ? (h.startsWith("@") ? h : `@${h}`) : sel.id);
    return `Чат с: ${label}`;
  }
  if (sel.kind === "group") {
    const g = (state.groups || []).find((x) => x.id === sel.id);
    return `Чат: ${String(g?.name || sel.id)}`;
  }
  const b = (state.boards || []).find((x) => x.id === sel.id);
  return `Доска: ${String(b?.name || sel.id)}`;
}

export function renderFooter(target: HTMLElement, state: AppState) {
  const online = state.friends.filter((f) => f.online).length;
  const offline = state.friends.filter((f) => !f.online).length;
  const pending =
    state.pendingIn.length +
    state.pendingOut.length +
    state.pendingGroupInvites.length +
    state.pendingGroupJoinRequests.length +
    state.pendingBoardInvites.length +
    state.fileOffersIn.length;
  const line = `Онлайн: ${online} | Оффлайн: ${offline} | Ожидают: ${pending} — ${viewTitle(state)}`;

  const tabMain = el(
    "button",
    {
      class: state.page === "main" ? "footer-tab footer-tab-active" : "footer-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(state.page === "main"),
      "data-action": "nav-main",
    },
    ["Сообщения"]
  );
  const tabSearch = el(
    "button",
    {
      class: state.page === "search" ? "footer-tab footer-tab-active" : "footer-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(state.page === "search"),
      "data-action": "nav-search",
    },
    ["Поиск"]
  );
  const tabProfile = el(
    "button",
    {
      class: state.page === "profile" ? "footer-tab footer-tab-active" : "footer-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(state.page === "profile"),
      "data-action": "nav-profile",
    },
    ["Профиль"]
  );
  const tabFiles = el(
    "button",
    {
      class: state.page === "files" ? "footer-tab footer-tab-active" : "footer-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(state.page === "files"),
      "data-action": "nav-files",
    },
    ["Файлы"]
  );

  target.replaceChildren(
    el("div", { class: "footer-line" }, [line]),
    el("div", { class: "footer-nav", role: "tablist" }, [tabMain, tabSearch, tabProfile, tabFiles])
  );
}
