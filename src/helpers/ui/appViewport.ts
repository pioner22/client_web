export function installAppViewportHeightVar(root: HTMLElement): () => void {
  let rafId: number | null = null;
  let lastHeight = 0;

  const readHeight = (): number => {
    const vv = window.visualViewport;
    const h = vv && typeof vv.height === "number" ? vv.height : window.innerHeight;
    const n = Math.round(Number(h) || 0);
    return n > 0 ? n : 0;
  };

  const apply = () => {
    rafId = null;
    const h = readHeight();
    if (!h) return;
    if (Math.abs(h - lastHeight) < 1) return;
    lastHeight = h;
    root.style.setProperty("--app-vh", `${h}px`);
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
  };
}

