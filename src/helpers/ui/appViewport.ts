export function installAppViewportHeightVar(root: HTMLElement): () => void {
  let rafId: number | null = null;
  let lastHeight = 0;

  const read = (): { height: number; keyboard: boolean } => {
    const USE_VISUAL_VIEWPORT_DIFF_PX = 96;
    const inner = Math.round(Number(window.innerHeight) || 0);
    const docEl = typeof document !== "undefined" ? document.documentElement : null;
    const client = docEl && typeof docEl.clientHeight === "number" ? Math.round(Number(docEl.clientHeight) || 0) : 0;
    const base = Math.max(inner, client);
    const vv = window.visualViewport;
    const vvHeight = vv && typeof vv.height === "number" ? Math.round(Number(vv.height) || 0) : 0;
    const diff = base && vvHeight ? Math.abs(base - vvHeight) : 0;
    const keyboard = Boolean(vvHeight && base && diff >= USE_VISUAL_VIEWPORT_DIFF_PX);
    const resolved = keyboard ? vvHeight : base;
    const height = Math.round(Number(resolved) || 0);
    return { height: height > 0 ? height : 0, keyboard };
  };

  const apply = () => {
    rafId = null;
    const { height, keyboard } = read();
    if (!height) return;

    // When iOS keyboard is visible, safe-area inset bottom is not useful (it's under the keyboard)
    // and creates an ugly gap above the keyboard. Override it to 0 while keyboard is open.
    if (keyboard) root.style.setProperty("--safe-bottom", "0px");
    else root.style.removeProperty("--safe-bottom");

    if (Math.abs(height - lastHeight) < 1) return;
    lastHeight = height;
    root.style.setProperty("--app-vh", `${height}px`);
  };

  const schedule = () => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(apply);
  };

  schedule();

  const onResize = () => schedule();
  const vv = window.visualViewport;
  window.addEventListener("resize", onResize, { passive: true });
  vv?.addEventListener("resize", onResize, { passive: true });
  vv?.addEventListener("scroll", onResize, { passive: true });

  return () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    window.removeEventListener("resize", onResize);
    vv?.removeEventListener("resize", onResize);
    vv?.removeEventListener("scroll", onResize);
    root.style.removeProperty("--app-vh");
    root.style.removeProperty("--safe-bottom");
  };
}
