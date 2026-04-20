import { el } from "../../helpers/dom/el";
import type { AppState, PageKind } from "../../stores/types";
import { roomRow } from "./renderSidebarHelpers";

export interface RenderSidebarMenuCtx {
  target?: HTMLElement;
  state: AppState;
  mobileUi: boolean;
  onSetPage: (page: PageKind) => void;
  onCreateGroup: () => void;
  onCreateBoard: () => void;
  onAuthOpen: () => void;
  onAuthLogout: () => void;
  mountDesktop: (children: HTMLElement[]) => void;
}

function toggleClass(node: HTMLElement | null | undefined, cls: string, enabled: boolean) {
  if (!node) return;
  const list = node.classList;
  if (list && typeof list.toggle === "function") {
    list.toggle(cls, enabled);
    return;
  }
  const raw = String((node as any).className || "");
  const parts = raw.split(/\s+/).filter(Boolean);
  const has = parts.includes(cls);
  if (enabled && !has) parts.push(cls);
  if (!enabled && has) parts.splice(parts.indexOf(cls), 1);
  (node as any).className = parts.join(" ");
}

export function renderSidebarMenuSurface(ctx: RenderSidebarMenuCtx) {
  const { state, mobileUi, onSetPage, onCreateGroup, onCreateBoard, onAuthOpen, onAuthLogout, mountDesktop } = ctx;

  const profileRow = roomRow("☺", "Профиль", state.page === "profile" || state.page === "sessions", () => onSetPage("profile"), undefined, {
    sub: "Имя, @handle, аватар",
    time: null,
    hasDraft: false,
  });
  toggleClass(profileRow, "row-settings", true);
  profileRow.setAttribute("title", "Настройки профиля и интерфейса");

  const searchRow = roomRow("🔍", "Поиск", state.page === "search", () => onSetPage("search"), undefined, {
    sub: "Глобальный поиск",
    time: null,
    hasDraft: false,
  });
  searchRow.setAttribute("title", "Глобальный поиск");

  const filesRow = roomRow("▦", "Файлы", state.page === "files", () => onSetPage("files"), undefined, {
    sub: "История и загрузки",
    time: null,
    hasDraft: false,
  });
  filesRow.setAttribute("title", "Передача файлов и история");
  const navRows: HTMLElement[] = [profileRow, searchRow, filesRow];

  const createGroupRow = roomRow("+", "Создать чат", state.page === "group_create", () => onCreateGroup(), undefined, {
    sub: "Групповой чат и приглашения",
    time: null,
    hasDraft: false,
  });
  createGroupRow.setAttribute("title", "Создать новый групповой чат");

  const createBoardRow = roomRow("+", "Создать доску", state.page === "board_create", () => onCreateBoard(), undefined, {
    sub: "Доска (чтение всем, запись владельцу)",
    time: null,
    hasDraft: false,
  });
  createBoardRow.setAttribute("title", "Создать новую доску");
  const createRows: HTMLElement[] = [createGroupRow, createBoardRow];

  const infoRow = roomRow("?", "Info", state.page === "help", () => onSetPage("help"), undefined, {
    sub: mobileUi ? "Версии и изменения" : "Хоткеи, версии и изменения",
    time: null,
    hasDraft: false,
  });
  infoRow.setAttribute("title", mobileUi ? "Справка и журнал обновлений" : "Подсказки по клавишам и журнал обновлений");

  const accountRows: HTMLElement[] = [];
  if (state.conn === "connected" && !state.authed) {
    const loginRow = roomRow("→", "Войти", false, () => onAuthOpen(), undefined, {
      sub: "Вход или регистрация",
      time: null,
      hasDraft: false,
    });
    loginRow.setAttribute("title", "Войти или зарегистрироваться");
    accountRows.push(loginRow);
  } else if (state.authed) {
    const logoutIcon = mobileUi ? "⏻" : "⎋";
    const logoutRow = roomRow(logoutIcon, mobileUi ? "Выход" : "Выход (F10)", false, () => onAuthLogout(), undefined, {
      sub: "Завершить сессию",
      time: null,
      hasDraft: false,
    });
    logoutRow.setAttribute("title", mobileUi ? "Выйти из аккаунта" : "Выйти из аккаунта (F10)");
    accountRows.push(logoutRow);
  }

  mountDesktop([
    el("div", { class: "pane-section" }, ["Навигация"]),
    ...navRows,
    ...(accountRows.length ? [el("div", { class: "pane-section" }, ["Аккаунт"]), ...accountRows] : []),
    el("div", { class: "pane-section" }, ["Создание"]),
    ...createRows,
    el("div", { class: "pane-section" }, ["Справка"]),
    infoRow,
  ]);
}
