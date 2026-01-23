import { el } from "../../helpers/dom/el";
import type {
  BoardEntry,
  FriendEntry,
  GroupEntry,
  MessageHelperDraft,
  TargetRef,
  UserProfile,
} from "../../stores/types";

export interface ForwardModalActions {
  onSend: (targets: TargetRef[]) => void;
  onCancel: () => void;
}

type RowEntry = {
  row: HTMLElement;
  input: HTMLInputElement;
  search: string;
  section: HTMLElement;
};

function normalizeHandle(handle?: string | null): string {
  const raw = String(handle || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function displayNameForFriend(profiles: Record<string, UserProfile>, f: FriendEntry): string {
  const id = String(f.id || "").trim();
  if (!id) return "—";
  const profile = profiles[id];
  const display = profile?.display_name ? String(profile.display_name).trim() : "";
  const fallback = f.display_name ? String(f.display_name).trim() : "";
  return display || fallback || id;
}

function roomLabel(name: string | null | undefined, id: string): string {
  const base = String(name || "").trim();
  return base ? base : id;
}

function makeRow(kind: TargetRef["kind"], id: string, title: string, sub: string | null): RowEntry {
  const input = el("input", {
    type: "checkbox",
    "data-forward-kind": kind,
    value: id,
  }) as HTMLInputElement;
  const mainChildren: Array<string | HTMLElement> = [el("span", { class: "forward-row-title" }, [title])];
  if (sub) mainChildren.push(el("span", { class: "forward-row-sub" }, [sub]));
  const main = el("span", { class: "forward-row-main" }, mainChildren);
  const row = el("label", { class: "forward-row" }, [input, main]);
  const search = [title, sub || "", id].join(" ").toLowerCase();
  return { row, input, search, section: row };
}

function appendSection(
  root: HTMLElement,
  title: string,
  rows: RowEntry[],
  emptyLabel: string
): { section: HTMLElement; rows: RowEntry[] } {
  const section = el("div", { class: "forward-section" });
  const header = el("div", { class: "forward-section-title" }, [title]);
  const body = el("div", { class: "forward-section-body" });
  if (rows.length) {
    rows.forEach((row) => {
      row.section = section;
      body.append(row.row);
    });
  } else {
    body.append(el("div", { class: "forward-empty" }, [emptyLabel]));
  }
  section.append(header, body);
  root.append(section);
  return { section, rows };
}

export function renderForwardModal(
  drafts: MessageHelperDraft[],
  friends: FriendEntry[],
  groups: GroupEntry[],
  boards: BoardEntry[],
  profiles: Record<string, UserProfile>,
  message: string | undefined,
  actions: ForwardModalActions
): HTMLElement {
  const box = el("div", { class: "modal modal-forward" });
  const btnSend = el("button", { class: "btn btn-primary", type: "button", disabled: "disabled" }, ["Переслать"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);
  const queryInput = el("input", {
    class: "modal-input",
    type: "search",
    id: "forward-search",
    placeholder: "Поиск контакта, чата или доски",
  }) as HTMLInputElement;
  const selectionLine = el("div", { class: "modal-line forward-count", id: "forward-count" }, ["Выберите получателей"]);
  const safeDrafts = (drafts || []).filter(Boolean);
  const primaryDraft = safeDrafts[0];
  const draftCount = safeDrafts.length;
  const preview = primaryDraft ? String(primaryDraft.preview || primaryDraft.text || "Сообщение").trim() : "Сообщение";
  const previewLabel = draftCount > 1 ? `${draftCount} сообщений` : preview;
  const previewLine = el("div", { class: "modal-line forward-preview" }, [`Переслать: ${previewLabel}`]);
  const showSenderInput = el("input", { type: "checkbox", id: "forward-show-sender", checked: "checked" }) as HTMLInputElement;
  const showCaptionInput = el("input", { type: "checkbox", id: "forward-show-caption", checked: "checked" }) as HTMLInputElement;
  const hasCaption = safeDrafts.some((d) => {
    if (d.attachment?.kind !== "file") return false;
    const text = String(d.text || "").trim();
    return Boolean(text && !text.startsWith("[file]"));
  });
  showCaptionInput.toggleAttribute("disabled", !hasCaption);
  const options = el("div", { class: "forward-options" }, [
    el("label", { class: "forward-option" }, [showSenderInput, el("span", {}, ["Показывать отправителя"])]),
    el("label", { class: "forward-option" }, [showCaptionInput, el("span", {}, ["Показывать подпись"])]),
  ]);
  const warnLine = el("div", { class: "modal-warn" }, [message || ""]);

  const listWrap = el("div", { class: "forward-list" });

  const friendRows = (friends || []).map((f) => {
    const id = String(f.id || "").trim();
    const title = displayNameForFriend(profiles, f);
    const handle = normalizeHandle(f.handle);
    const sub = handle && handle !== title ? handle : title === id ? null : id;
    return makeRow("dm", id, title, sub);
  });

  const groupRows = (groups || []).map((g) => {
    const id = String(g.id || "").trim();
    const title = roomLabel(g.name, id);
    const handle = normalizeHandle(g.handle);
    const sub = handle && handle !== title ? handle : title === id ? null : id;
    return makeRow("group", id, title, sub);
  });

  const boardRows = (boards || []).map((b) => {
    const id = String(b.id || "").trim();
    const title = roomLabel(b.name, id);
    const handle = normalizeHandle(b.handle);
    const sub = handle && handle !== title ? handle : title === id ? null : id;
    return makeRow("board", id, title, sub);
  });

  const sections = [
    appendSection(listWrap, "Контакты", friendRows, "Нет контактов"),
    appendSection(listWrap, "Чаты", groupRows, "Нет чатов"),
    appendSection(listWrap, "Доски", boardRows, "Нет досок"),
  ];

  const noResults = el("div", { class: "forward-empty forward-empty-global hidden" }, ["Ничего не найдено"]);
  listWrap.append(noResults);

  const updateCount = () => {
    const selected = box.querySelectorAll<HTMLInputElement>("input[data-forward-kind]:checked");
    const count = selected.length;
    btnSend.toggleAttribute("disabled", count === 0);
    selectionLine.textContent = count ? `Выбрано: ${count}` : "Выберите получателей";
  };

  const applyFilter = (raw: string) => {
    const query = String(raw || "").trim().toLowerCase();
    let anyVisible = false;
    sections.forEach((section) => {
      let sectionVisible = false;
      section.rows.forEach((row) => {
        const visible = !query || row.search.includes(query);
        row.row.classList.toggle("hidden", !visible);
        if (visible) sectionVisible = true;
      });
      section.section.classList.toggle("hidden", !sectionVisible && Boolean(query));
      if (sectionVisible) anyVisible = true;
    });
    noResults.classList.toggle("hidden", anyVisible || !query);
  };

  listWrap.addEventListener("change", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || !(target instanceof HTMLInputElement)) return;
    if (!target.hasAttribute("data-forward-kind")) return;
    updateCount();
  });

  queryInput.addEventListener("input", () => applyFilter(queryInput.value));

  const submit = () => {
    const inputs = Array.from(box.querySelectorAll<HTMLInputElement>("input[data-forward-kind]:checked"));
    const targets: TargetRef[] = inputs
      .map((input) => {
        const kind = String(input.getAttribute("data-forward-kind") || "").trim() as TargetRef["kind"];
        const id = String(input.value || "").trim();
        if (!id || (kind !== "dm" && kind !== "group" && kind !== "board")) return null;
        return { kind, id };
      })
      .filter((item): item is TargetRef => Boolean(item));
    actions.onSend(targets);
  };

  btnSend.addEventListener("click", submit);
  btnCancel.addEventListener("click", () => actions.onCancel());

  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  box.append(
    el("div", { class: "modal-title" }, ["Переслать сообщение"]),
    el("div", { class: "modal-body" }, [
      previewLine,
      options,
      queryInput,
      selectionLine,
      listWrap,
    ]),
    warnLine,
    el("div", { class: "modal-actions" }, [btnSend, btnCancel])
  );

  updateCount();
  applyFilter("");
  return box;
}
