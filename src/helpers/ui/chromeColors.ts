let pendingSync = false;
let lastColor = "";

function readCssVar(style: CSSStyleDeclaration, name: string): string {
  const raw = style.getPropertyValue(name);
  return raw ? raw.trim() : "";
}

function resolveChromeColor(style: CSSStyleDeclaration): string | null {
  const candidates = ["--header-bg", "--app-bg", "--bg", "--sidebar-bg"];
  for (const name of candidates) {
    const value = readCssVar(style, name);
    if (value && value !== "transparent") return value;
  }
  return null;
}

function setMeta(name: string, value: string): void {
  const meta = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!meta) return;
  if (meta.content !== value) meta.setAttribute("content", value);
}

function setMaskIconColor(value: string): void {
  const link = document.querySelector('link[rel="mask-icon"]') as HTMLLinkElement | null;
  if (!link) return;
  if (link.getAttribute("color") !== value) link.setAttribute("color", value);
}

export function syncChromeColors(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root || typeof window === "undefined" || typeof window.getComputedStyle !== "function") return;
  const style = window.getComputedStyle(root);
  const color = resolveChromeColor(style);
  if (!color || color === lastColor) return;
  lastColor = color;
  setMeta("theme-color", color);
  setMaskIconColor(color);
}

export function scheduleChromeColorSync(): void {
  if (pendingSync) return;
  pendingSync = true;
  const run = () => {
    pendingSync = false;
    syncChromeColors();
  };
  if (typeof window === "undefined") {
    run();
    return;
  }
  try {
    window.requestAnimationFrame(run);
  } catch {
    run();
  }
  window.setTimeout(run, 60);
  window.setTimeout(run, 220);
}
