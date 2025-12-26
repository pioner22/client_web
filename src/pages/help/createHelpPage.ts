import { el } from "../../helpers/dom/el";
import { CHANGELOG, type ChangelogEntry } from "../../config/changelog";
import { splitBuildId } from "../../helpers/version/buildId";
import { createElement } from "react";
import { renderReact } from "../../helpers/ui/reactMount";
import { FrameworkBadge } from "../../react/FrameworkBadge";
import type { AppState } from "../../stores/types";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";

export interface HelpPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

const HELP_ROWS: Array<{ key: string; label: string }> = [
  { key: "F1", label: "info" },
  { key: "F2", label: "профиль" },
  { key: "F3", label: "поиск" },
  { key: "Ctrl+U", label: "обновление" },
  { key: "F5", label: "создать чат" },
  { key: "F6", label: "создать доску" },
  { key: "F7", label: "файлы" },
  { key: "Enter", label: "отправить сообщение" },
  { key: "Shift+Enter", label: "новая строка" },
  { key: "Esc", label: "назад/закрыть" },
];

const CHANGELOG_PAGE_SIZE = 20;

function renderChangelogEntry(entry: ChangelogEntry, currentVersion: string): HTMLElement {
  const isCurrent = entry.version === currentVersion;
  const head = el("div", { class: "changelog-head" }, [
    el("span", { class: "changelog-ver" }, [`v${entry.version}`]),
    el("span", { class: "changelog-date" }, [entry.date]),
  ]);

  const blocks: HTMLElement[] = [];
  const pushBlock = (kind: "added" | "improved" | "fixed" | "notes", title: string, items: string[] | undefined) => {
    if (!items || items.length === 0) return;
    blocks.push(
      el("div", { class: "changelog-block" }, [
        el("div", { class: `changelog-kind kind-${kind}` }, [title]),
        el(
          "ul",
          { class: "changelog-list" },
          items.map((x) => el("li", { class: "changelog-item" }, [x]))
        ),
      ])
    );
  };

  pushBlock("added", "Добавлено", entry.added);
  pushBlock("improved", "Улучшено", entry.improved);
  pushBlock("fixed", "Исправлено", entry.fixed);
  pushBlock("notes", "Примечания", entry.notes);

  const cls = isCurrent ? "changelog-entry is-current" : "changelog-entry";
  return el("div", { class: cls }, [head, ...blocks]);
}

export function createHelpPage(): HelpPage {
  const mobileUi = isMobileLikeUi();
  const title = el("div", { class: "chat-title" }, ["Info"]);
  const meta = el("div", { class: "info-meta" }, [""]);
  const fwBadgeHost = el("div", { class: "fw-badge-host", "aria-hidden": "true" }, []);
  const metaRow = el("div", { class: "info-meta-row" }, [meta, fwBadgeHost]);

  const rows = mobileUi
    ? null
    : el(
        "div",
        { class: "help-grid" },
        HELP_ROWS.map((r) =>
          el("div", { class: "help-row" }, [
            el("span", { class: "hk-kbd help-kbd", "aria-hidden": "true" }, [r.key]),
            el("span", { class: "help-label" }, [r.label]),
          ])
        )
      );

  const quickStart = el("div", { class: "info-section" }, [
    el("div", { class: "info-h" }, ["Мини‑инструкция"]),
    el("ul", { class: "info-list" }, [
      el("li", {}, [
        mobileUi
          ? "Вход: откройте «Меню» → «Войти» → введите ID и пароль. Пароль не сохраняем, ID запоминаем."
          : "Вход: нажмите «Войти» в шапке → введите ID и пароль. Пароль не сохраняем, ID запоминаем.",
      ]),
      el("li", {}, [
        mobileUi
          ? "Создать чат/доску: «Меню» → «Создать чат/доску» → заполните форму → «Создать»."
          : "Создать чат/доску: F5/F6 → заполните форму → Enter.",
      ]),
      el("li", {}, [
        mobileUi
          ? "Добавить участников: откройте чат/доску → меню (долгий тап) → «Добавить участников» → вставьте список ID/@handle через пробел/запятую."
          : "Добавить участников: откройте чат/доску → меню (ПКМ) → «Добавить участников» → вставьте список ID/@handle через пробел/запятую.",
      ]),
      el("li", {}, [mobileUi ? "Отправка: кнопка отправки справа внизу." : "Отправка: Enter — отправить, Shift+Enter — новая строка."]),
      el("li", {}, ["Файлы/фото: кнопка скрепки (＋) внизу."]),
    ]),
    el("div", { class: "info-sub" }, ["Пример: 123456789 → автоматически станет 123-456-789; @name — поиск по логину."]),
  ]);

  const install = el("div", { class: "info-section", id: "install" }, [
    el("div", { class: "info-h" }, ["Установка на телефон"]),
    el("ul", { class: "info-list" }, [
      el("li", {}, ["Android/Chrome: при первом заходе появится «Установить» (или меню браузера → «Установить приложение»)."]),
      el("li", {}, ["iPhone/iPad (Safari): Поделиться → «На экран Домой» (Add to Home Screen)."]),
    ]),
    el("div", { class: "info-sub" }, ["После установки интерфейс работает полноэкранно (учитываем вырез/чёлку и safe‑area)."]),
  ]);

  const hkTitle = mobileUi ? null : el("div", { class: "info-h help-hotkeys-title" }, ["Горячие клавиши"]);
  const mobileNav = mobileUi
    ? el("div", { class: "info-section" }, [
        el("div", { class: "info-h" }, ["Навигация"]),
        el("ul", { class: "info-list" }, [
          el("li", {}, ["Вкладки снизу: «Контакты», «Чаты», «Доски»."]),
          el("li", {}, ["Свайп влево/вправо по списку — переключение вкладок (как в Telegram)."]),
          el("li", {}, ["«Меню» — поиск, профиль, файлы, создание, справка."]),
          el("li", {}, ["Долгий тап по контакту/сообщению — меню действий."]),
        ]),
      ])
    : null;

  const changelogTitle = el("div", { class: "info-h" }, ["История изменений"]);
  const changelogWrap = el("div", { class: "changelog" }, []);
  const changelogSentinel = el("div", { class: "changelog-sentinel", "aria-hidden": "true" }, [""]);
  const changelogMoreBtn = el("button", { class: "btn changelog-more", type: "button" }, ["Показать ещё"]);

  let lastVersionShown = "";
  let changelogCurrentVersion = "";
  let visibleCount = CHANGELOG_PAGE_SIZE;
  let io: IntersectionObserver | null = null;

  const renderChangelog = (currentVersion: string) => {
    changelogCurrentVersion = currentVersion;
    const all = CHANGELOG || [];
    if (visibleCount < CHANGELOG_PAGE_SIZE) visibleCount = CHANGELOG_PAGE_SIZE;
    const slice = all.slice(0, Math.min(all.length, visibleCount));
    const nodes = slice.map((e) => renderChangelogEntry(e, currentVersion));
    const hasMore = visibleCount < all.length;

    changelogMoreBtn.classList.toggle("hidden", !hasMore);
    changelogMoreBtn.disabled = !hasMore;
    changelogWrap.replaceChildren(...nodes, ...(hasMore ? [changelogMoreBtn, changelogSentinel] : []));

    if (hasMore) {
      if (typeof IntersectionObserver === "function") {
        if (!io) {
          io = new IntersectionObserver(
            (entries) => {
              if (!entries.some((x) => x.isIntersecting)) return;
              if (visibleCount >= all.length) return;
              visibleCount = Math.min(all.length, visibleCount + CHANGELOG_PAGE_SIZE);
              renderChangelog(changelogCurrentVersion);
            },
            { root: null, rootMargin: "600px 0px" }
          );
        }
        try {
          io.disconnect();
          io.observe(changelogSentinel);
        } catch {
          // ignore
        }
      }
    } else if (io) {
      try {
        io.disconnect();
      } catch {
        // ignore
      }
      io = null;
    }
  };

  changelogMoreBtn.addEventListener("click", () => {
    const all = CHANGELOG || [];
    if (visibleCount >= all.length) return;
    visibleCount = Math.min(all.length, visibleCount + CHANGELOG_PAGE_SIZE);
    renderChangelog(lastVersionShown || "");
  });

  const changelogSection = el("div", { class: "info-section" }, [changelogTitle, changelogWrap]);

  const hint = mobileUi ? null : el("div", { class: "msg msg-sys page-hint" }, ["Esc — назад"]);

  const root = el("div", { class: "page info-page" }, [
    title,
    metaRow,
    quickStart,
    ...(mobileNav ? [mobileNav] : []),
    install,
    ...(hkTitle && rows ? [hkTitle, rows] : []),
    changelogSection,
    ...(hint ? [hint] : []),
  ]);

  renderReact(fwBadgeHost, createElement(FrameworkBadge, { label: "React" }));

  return {
    root,
    update: (state: AppState) => {
      const build = splitBuildId(state.clientVersion);
      const v = build.version || "—";
      if (v !== lastVersionShown) {
        lastVersionShown = v;
        renderChangelog(v);
      }
      const parts = [
        `Версия: v${v}`,
        build.build ? `build ${build.build}` : "",
        state.serverVersion ? `srv ${state.serverVersion}` : "",
        state.conn === "connected" ? "онлайн" : state.conn === "connecting" ? "подключение…" : "нет связи",
      ].filter(Boolean);
      meta.textContent = parts.join(" · ");
    },
    focus: () => {
      // nothing to focus by default
    },
  };
}
