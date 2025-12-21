import { el } from "../../helpers/dom/el";
import { splitBuildId } from "../../helpers/version/buildId";
import type { AppState } from "../../stores/types";
import type { Layout } from "../layout/types";

export function renderHeader(layout: Layout, state: AppState) {
  const webBuild = splitBuildId(state.clientVersion);
  const verTitle = state.serverVersion ? `srv ${state.serverVersion}` : "";
  const headerId = state.selfId ?? state.authRememberedId ?? "—";
  let title = "Чат";
  if (state.page === "search") title = "Поиск";
  else if (state.page === "help") title = "Info";
  else if (state.page === "profile") title = "Профиль";
  else if (state.page === "files") title = "Файлы";
  else if (state.page === "group_create") title = "Создать чат";
  else if (state.page === "board_create") title = "Создать доску";
  else {
    const sel = state.selected;
    if (sel) {
      if (sel.kind === "dm") title = `Чат с: ${sel.id}`;
      else if (sel.kind === "group") {
        const g = (state.groups || []).find((x) => x.id === sel.id);
        title = `Чат: ${String(g?.name || sel.id)}`;
      } else {
        const b = (state.boards || []).find((x) => x.id === sel.id);
        title = `Доска: ${String(b?.name || sel.id)}`;
      }
    }
  }

  const canChatSearch = state.page === "main" && Boolean(state.selected) && !state.modal;
  const chatSearchBtn = canChatSearch
    ? el(
        "button",
        {
          class: state.chatSearchOpen ? "hk-btn hdr-search btn-active" : "hk-btn hdr-search",
          type: "button",
          "data-action": state.chatSearchOpen ? "chat-search-close" : "chat-search-open",
          title: "Поиск в чате",
          "aria-label": state.chatSearchOpen ? "Закрыть поиск в чате" : "Поиск в чате",
        },
        [state.chatSearchOpen ? "×" : "⌕"]
      )
    : null;

  const navShowsBack = state.page === "main" && Boolean(state.selected);
  const navTitle = navShowsBack ? "Список" : "Меню";
  const navAria = navShowsBack ? "Открыть список чатов" : "Открыть меню";

  layout.headerLeft.replaceChildren(
    el(
      "button",
      {
        class: "nav-toggle hk-btn",
        type: "button",
        "data-action": "sidebar-toggle",
        title: navTitle,
        "aria-label": navAria,
      },
      [navShowsBack ? "←" : "☰"]
    ),
    " ",
    el("span", { class: "hdr-label" }, ["Ваш ID: "]),
    el("span", { class: "hdr-id" }, [headerId]),
    ...(state.conn === "connected" && !state.authed
      ? [
          " ",
          el(
            "button",
            { class: "hk-btn hdr-auth", type: "button", "data-action": "auth-open", title: "Войти", "aria-label": "Войти" },
            ["Войти"]
          ),
        ]
      : state.conn === "connected" && state.authed
        ? [
            " ",
            el(
              "button",
              { class: "hk-btn hdr-logout", type: "button", "data-action": "auth-logout", title: "Выйти", "aria-label": "Выйти" },
              ["Выйти"]
            ),
          ]
      : []),
    "  ",
    el("span", { class: "hdr-ver", title: verTitle || undefined }, [`v${webBuild.version || "—"}`]),
    el("span", { class: "hdr-sep" }, [" | "]),
    el("span", { class: "hdr-title" }, [title]),
    ...(chatSearchBtn ? [" ", chatSearchBtn] : [])
  );
  layout.headerRight.textContent = state.status || "";

  layout.hotkeys.replaceChildren(
    ...[
      ["F1", "info"],
      ["F2", "профиль"],
      ["F3", "поиск"],
      ["F5", "чат+"],
      ["F6", "доска+"],
      ["F7", "файлы"],
    ].map(([k, v]) =>
      el(
        "button",
        { class: "hk-btn", type: "button", "data-key": k, title: `${k} — ${v}`, "aria-label": `${v} (${k})` },
        [el("span", { class: "hk-kbd", "aria-hidden": "true" }, [k]), el("span", { class: "hk-label", "aria-hidden": "true" }, [v])]
      )
    )
  );
}
