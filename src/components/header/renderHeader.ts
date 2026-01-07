import { el } from "../../helpers/dom/el";
import { splitBuildId } from "../../helpers/version/buildId";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { AppState } from "../../stores/types";
import type { Layout } from "../layout/types";

export function renderHeader(layout: Layout, state: AppState) {
  const mobileUi = isMobileLikeUi();
  const webBuild = splitBuildId(state.clientVersion);
  const verTitle = state.serverVersion ? `srv ${state.serverVersion}` : "";
  const headerId = state.selfId ?? state.authRememberedId ?? "—";
  let title = "Чат";
  if (state.page === "search") title = "Поиск";
  else if (state.page === "help") title = "Info";
  else if (state.page === "profile") title = "Профиль";
  else if (state.page === "user") {
    const id = String(state.userViewId || "").trim();
    const p = id ? state.profiles?.[id] : null;
    const dn = p?.display_name ? String(p.display_name).trim() : "";
    title = dn ? `Контакт: ${dn}` : "Контакт";
  }
  else if (state.page === "group") {
    const id = String(state.groupViewId || "").trim();
    const g = id ? state.groups?.find((x) => x.id === id) : null;
    title = `Чат: ${String(g?.name || id || "—")}`;
  }
  else if (state.page === "board") {
    const id = String(state.boardViewId || "").trim();
    const b = id ? state.boards?.find((x) => x.id === id) : null;
    title = `Доска: ${String(b?.name || id || "—")}`;
  }
  else if (state.page === "files") title = "Файлы";
  else if (state.page === "group_create") title = "Создать чат";
  else if (state.page === "board_create") title = "Создать доску";
  else {
    const sel = state.selected;
    if (sel) {
      if (sel.kind === "dm") {
        const p = state.profiles?.[sel.id];
        const dn = p?.display_name ? String(p.display_name).trim() : "";
        const h = p?.handle ? String(p.handle).trim() : "";
        const label = dn || (h ? (h.startsWith("@") ? h : `@${h}`) : sel.id);
        title = `Чат с: ${label}`;
      }
      else if (sel.kind === "group") {
        const g = (state.groups || []).find((x) => x.id === sel.id);
        title = `Чат: ${String(g?.name || sel.id)}`;
      } else {
        const b = (state.boards || []).find((x) => x.id === sel.id);
        title = `Доска: ${String(b?.name || sel.id)}`;
      }
    }
  }

  const chatSearchBtn = null;
  const navBackToMain = state.page !== "main";
  const navBackFromChat = Boolean(state.page === "main" && state.selected);
  const navAction = navBackToMain ? "nav-back" : navBackFromChat ? "chat-back" : "sidebar-toggle";
  const navTitle = navBackToMain || navBackFromChat ? "Назад" : "Меню";
  const navAria = navBackToMain ? "Назад" : navBackFromChat ? "Назад к списку" : "Открыть меню";
  const navIcon = navAction === "sidebar-toggle" ? "☰" : "←";

  layout.headerLeft.replaceChildren(
    el(
      "button",
      {
        class: "nav-toggle hk-btn",
        type: "button",
        "data-action": navAction,
        title: navTitle,
        "aria-label": navAria,
      },
      [navIcon]
    ),
    " ",
    el("span", { class: "hdr-label" }, ["Ваш ID: "]),
    el("span", { class: "hdr-id" }, [headerId]),
    "  ",
    el("span", { class: "hdr-ver", title: verTitle || undefined }, [`v${webBuild.version || "—"}`]),
    el("span", { class: "hdr-sep" }, [" | "]),
    el("span", { class: "hdr-title" }, [title])
  );
  const showCallActions = Boolean(state.page === "main" && state.selected && state.selected.kind !== "board");
  const statusLabel = state.status || "";
  const statusEl = el("span", { class: "hdr-status" }, [statusLabel]);
  const actions = showCallActions
    ? el("span", { class: "hdr-actions" }, [
        el(
          "button",
          {
            class: "hdr-action",
            type: "button",
            disabled: "true",
            title: "Аудиозвонок (скоро)",
            "aria-label": "Аудиозвонок (скоро)",
            "data-icon": "call",
          },
          []
        ),
        el(
          "button",
          {
            class: "hdr-action",
            type: "button",
            disabled: "true",
            title: "Видеозвонок (скоро)",
            "aria-label": "Видеозвонок (скоро)",
            "data-icon": "video",
          },
          []
        ),
      ])
    : null;
  if (actions) {
    layout.headerRight.replaceChildren(statusEl, actions);
  } else {
    layout.headerRight.replaceChildren(statusEl);
  }

  if (mobileUi) {
    layout.hotkeys.replaceChildren();
  } else {
    const f10Label = state.authed ? "выход" : "зайти";
    layout.hotkeys.replaceChildren(
      ...[
        ["F1", "info"],
        ["F2", "профиль"],
        ["F5", "чат+"],
        ["F6", "доска+"],
        ["F7", "файлы"],
        ["F10", f10Label],
      ].map(([k, v]) =>
        el(
          "button",
          { class: "hk-btn", type: "button", "data-key": k, title: `${k} — ${v}`, "aria-label": `${v} (${k})` },
          [el("span", { class: "hk-kbd", "aria-hidden": "true" }, [k]), el("span", { class: "hk-label", "aria-hidden": "true" }, [v])]
        )
      )
    );
  }
}
