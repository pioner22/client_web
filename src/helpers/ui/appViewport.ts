export function installAppViewportHeightVar(root: HTMLElement): () => void {
  let rafId: number | null = null;
  let lastHeight = 0;

  const read = (): { height: number; keyboard: boolean; vvTop: number } => {
    const USE_VISUAL_VIEWPORT_DIFF_PX = 96;
    const USE_VISUAL_VIEWPORT_DIFF_FOCUSED_PX = 48;
    const USE_SCREEN_HEIGHT_SLACK_PX = 120;
    const inner = Math.round(Number(window.innerHeight) || 0);
    const docEl = typeof document !== "undefined" ? document.documentElement : null;
    const client = docEl && typeof docEl.clientHeight === "number" ? Math.round(Number(docEl.clientHeight) || 0) : 0;
    let base = Math.max(inner, client);
    // iOS PWA: sometimes innerHeight/clientHeight are missing the bottom safe-area, leaving a visible "black strip".
    // Use screen.height only when it's very close to base (so we don't break Safari with browser chrome).
    try {
      const sh = Math.round(Number((window as any).screen?.height) || 0);
      if (sh > 0 && base > 0 && sh >= base && sh - base <= USE_SCREEN_HEIGHT_SLACK_PX) {
        base = sh;
      }
    } catch {
      // ignore
    }
    const vv = window.visualViewport;
    const vvHeight = vv && typeof vv.height === "number" ? Math.round(Number(vv.height) || 0) : 0;
    const vvTopRaw = (() => {
      if (!vv) return 0;
      const anyVv = vv as any;
      const ot = typeof anyVv.offsetTop === "number" ? Number(anyVv.offsetTop) : 0;
      if (Number.isFinite(ot) && ot) return Math.round(ot);
      const pt = typeof anyVv.pageTop === "number" ? Number(anyVv.pageTop) : 0;
      if (Number.isFinite(pt) && pt) return Math.round(pt);
      return 0;
    })();
    // For our "fullscreen fixed app" we only care about viewport shifts *down*.
    // Clamp to a sane range to avoid weird negative values on iOS/WebKit edge cases.
    let vvTop = Math.max(0, vvTopRaw);
    if (base && vvHeight) vvTop = Math.max(0, Math.min(vvTop, Math.max(0, base - vvHeight)));
    const coveredBottom = base && vvHeight ? Math.max(0, base - (vvHeight + vvTop)) : 0;
    let activeEditable = false;
    try {
      const ae = typeof document !== "undefined" ? (document as any).activeElement : null;
      const tag = ae && typeof ae.tagName === "string" ? String(ae.tagName).toLowerCase() : "";
      activeEditable = Boolean(ae && (tag === "input" || tag === "textarea" || Boolean((ae as any).isContentEditable)));
    } catch {
      activeEditable = false;
    }
    const keyboardThreshold = activeEditable ? USE_VISUAL_VIEWPORT_DIFF_FOCUSED_PX : USE_VISUAL_VIEWPORT_DIFF_PX;
    const keyboard = Boolean(vvHeight && base && coveredBottom >= keyboardThreshold);
    const resolved = keyboard ? vvHeight : base;
    const height = Math.round(Number(resolved) || 0);
    return { height: height > 0 ? height : 0, keyboard, vvTop };
  };

  const apply = () => {
    rafId = null;
    const { height, keyboard, vvTop } = read();
    if (!height) return;

    // When iOS keyboard is visible, safe-area inset bottom is not useful (it's under the keyboard)
    // and creates an ugly gap above the keyboard. Override it to 0 while keyboard is open.
    if (keyboard) root.style.setProperty("--safe-bottom", "0px");
    else root.style.removeProperty("--safe-bottom");

    // iOS Safari/PWA: when the keyboard opens WebKit can scroll the *visual* viewport (offsetTop > 0).
    // If we only shrink height to visualViewport.height, the app ends above the visible bottom and leaves a
    // "black strip" + composer jumps upward. Anchor the fixed app to visualViewport.offsetTop.
    if (keyboard && vvTop >= 1) root.style.setProperty("--app-vv-top", `${vvTop}px`);
    else root.style.removeProperty("--app-vv-top");

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
  window.addEventListener("scroll", onResize, { passive: true });
  vv?.addEventListener("resize", onResize, { passive: true });
  vv?.addEventListener("scroll", onResize, { passive: true });
  const doc = typeof document !== "undefined" ? (document as any) : null;
  const canFocusEvents = Boolean(doc && typeof doc.addEventListener === "function" && typeof doc.removeEventListener === "function");
  if (canFocusEvents) {
    doc.addEventListener("focusin", onResize, { passive: true });
    doc.addEventListener("focusout", onResize, { passive: true });
  }

  return () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onResize);
    vv?.removeEventListener("resize", onResize);
    vv?.removeEventListener("scroll", onResize);
    if (canFocusEvents) {
      doc.removeEventListener("focusin", onResize);
      doc.removeEventListener("focusout", onResize);
    }
    root.style.removeProperty("--app-vh");
    root.style.removeProperty("--safe-bottom");
    root.style.removeProperty("--app-vv-top");
  };
}
