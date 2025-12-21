export interface ChangelogEntry {
  version: string; // semver without build hash
  date: string; // YYYY-MM-DD
  added?: string[];
  improved?: string[];
  fixed?: string[];
  notes?: string[];
}

// Keep newest first. This list is shown in Info (F1) and acts as user-facing release notes.
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.1.56",
    date: "2025-12-21",
    added: ["Info (F1) с журналом изменений и мини‑инструкцией прямо в приложении"],
    improved: ["Подгрузка истории изменений порциями по 20 версий (автоподгрузка при прокрутке)"],
  },
  {
    version: "0.1.55",
    date: "2025-12-21",
    fixed: ["После выхода показываем сохранённый ID в шапке (ID больше не «пропадает»)"],
  },
  {
    version: "0.1.54",
    date: "2025-12-21",
    fixed: ["ID в окне входа не очищается при первом открытии модалки (после выхода просит только пароль)"],
    improved: ["Workaround для iOS PWA: панель Undo/Redo/✓ появляется реже при вводе текста"],
  },
];

