const LAZY_IMPORT_RECOVER_KEY = "yagodka_lazy_import_recover_v1";

function lazyImportErrorText(err: unknown): string {
  const name = typeof (err as any)?.name === "string" ? String((err as any).name).trim() : "";
  const message = typeof (err as any)?.message === "string" ? String((err as any).message).trim() : "";
  return [name, message].filter(Boolean).join(": ");
}

export function isLikelyStaleLazyImportError(err: unknown): boolean {
  const text = lazyImportErrorText(err).toLowerCase();
  if (!text) return false;
  return (
    text.includes("chunkloaderror") ||
    text.includes("failed to fetch dynamically imported module") ||
    text.includes("error loading dynamically imported module") ||
    text.includes("importing a module script failed") ||
    text.includes("dynamically imported module")
  );
}

export function recoverFromLazyImportError(err: unknown, scope = "lazy_import"): boolean {
  if (typeof window === "undefined" || !isLikelyStaleLazyImportError(err)) return false;

  const detail = lazyImportErrorText(err) || "unknown_lazy_import_error";
  try {
    window.dispatchEvent(new CustomEvent("yagodka:pwa-sw-error", { detail: { error: `lazy_import:${scope}:${detail}` } }));
  } catch {
    // ignore
  }

  let alreadyRecovered = false;
  try {
    alreadyRecovered = sessionStorage.getItem(LAZY_IMPORT_RECOVER_KEY) === "1";
  } catch {
    alreadyRecovered = false;
  }
  if (alreadyRecovered) return false;

  try {
    sessionStorage.setItem(LAZY_IMPORT_RECOVER_KEY, "1");
    sessionStorage.setItem("yagodka_updating", "1");
    sessionStorage.setItem("yagodka_force_recover", "1");
  } catch {
    // ignore
  }

  try {
    window.location.replace(window.location.href);
    return true;
  } catch {
    // ignore
  }

  try {
    window.location.reload();
    return true;
  } catch {
    // ignore
  }
  return false;
}
