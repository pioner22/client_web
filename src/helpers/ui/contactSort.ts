import type { ContactSortMode } from "../../stores/types";

const STORAGE_KEY = "yagodka_contacts_sort";

export function normalizeContactSortMode(input: unknown): ContactSortMode {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "name" || raw === "online" || raw === "top") return raw;
  return "online";
}

export function getStoredContactSortMode(): ContactSortMode {
  try {
    return normalizeContactSortMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "online";
  }
}

export function storeContactSortMode(mode: ContactSortMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, normalizeContactSortMode(mode));
  } catch {
    // ignore
  }
}
