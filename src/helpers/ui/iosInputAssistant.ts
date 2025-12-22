export function isIOS(): boolean {
  try {
    const ua = String(navigator?.userAgent || "");
    const isClassic = /iPad|iPhone|iPod/i.test(ua);
    const isIPadOS = /Macintosh/i.test(ua) && Number((navigator as any)?.maxTouchPoints || 0) > 1;
    return isClassic || isIPadOS;
  } catch {
    return false;
  }
}

export function isStandaloneDisplayMode(): boolean {
  try {
    const navStandalone = Boolean((navigator as any)?.standalone);
    if (navStandalone) return true;
  } catch {
    // ignore
  }
  try {
    return Boolean(
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
        window.matchMedia?.("(display-mode: fullscreen)")?.matches
    );
  } catch {
    return false;
  }
}

export function applyIosInputAssistantWorkaround(el: HTMLTextAreaElement | HTMLInputElement): void {
  // В iOS PWA (standalone) WebKit может показывать системную панель Undo/Redo/✓ над клавиатурой.
  // Полностью отключить её в Safari/PWA нельзя, но можно уменьшить появление именно Undo/Redo‑панели,
  // возвращая "нормальный" режим клавиатуры (предиктив/спеллчек) для обычного текста.
  if (!isIOS() || !isStandaloneDisplayMode()) return;
  try {
    el.setAttribute("autocorrect", "on");
    el.setAttribute("spellcheck", "true");
    // Возвращаем типичную для iOS автокапитализацию (снижаем шанс появления "редакторской" панели).
    el.setAttribute("autocapitalize", "sentences");
    try {
      (el as any).spellcheck = true;
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}
