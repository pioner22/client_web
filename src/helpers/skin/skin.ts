import type { SkinInfo } from "../../stores/types";

const STORAGE_KEY = "yagodka_skin";
const LINK_ID = "yagodka-skin-css";
const SKIN_ID_RE = /^[a-z0-9_-]{1,32}$/;

export function normalizeSkinId(input: unknown): string {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw || raw === "default") return "default";
  if (!SKIN_ID_RE.test(raw)) return "default";
  return raw;
}

export function getStoredSkinId(): string {
  try {
    return normalizeSkinId(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "default";
  }
}

export function storeSkinId(id: string): void {
  const norm = normalizeSkinId(id);
  try {
    localStorage.setItem(STORAGE_KEY, norm);
  } catch {
    // ignore
  }
}

export function applySkin(id: string): void {
  const norm = normalizeSkinId(id);
  try {
    document.documentElement.dataset.skin = norm;
  } catch {
    // ignore
  }

  const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  const href = `./skins/${encodeURIComponent(norm)}.css`;
  if (existing) {
    if ((existing.getAttribute("href") || "") !== href) existing.setAttribute("href", href);
    return;
  }

  const link = document.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

export async function fetchAvailableSkins(): Promise<SkinInfo[] | null> {
  const defaultSkin: SkinInfo = { id: "default", title: "По умолчанию" };
  try {
    const res = await fetch("./skins/skins.json", { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const raw = Array.isArray(data?.skins) ? data.skins : [];
    const byId = new Map<string, SkinInfo>();
    for (const it of raw) {
      const id = normalizeSkinId(it?.id);
      const titleRaw = String(it?.title ?? it?.name ?? id).trim() || id;
      const title = id === "default" ? defaultSkin.title : titleRaw;
      byId.set(id, { id, title });
    }
    if (!byId.has("default")) byId.set("default", defaultSkin);
    const out = Array.from(byId.values());
    out.sort((a, b) => {
      if (a.id === "default") return -1;
      if (b.id === "default") return 1;
      return a.title.localeCompare(b.title);
    });
    return out;
  } catch {
    return null;
  }
}
