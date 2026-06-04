import { isIOS, isStandaloneDisplayMode } from "./iosInputAssistant";

export function installAppViewportHeightVar(root: HTMLElement): () => void {
  let rafId: number | null = null;
  let lastHeight = 0;
  let lastLayout = 0;
  let lastStableLayout = 0;
  let lastEditableFocusTs = 0;
  let lastEditablePointerTs = 0;
  const isIos = isIOS();
  const standalone = isStandaloneDisplayMode();
  const iosStandalone = isIos && standalone;
  const docEl = typeof document !== "undefined" ? document.documentElement : null;
  const EDITABLE_INTENT_MS = 1200;
  const diagnosticAttrNames = [
    "data-viewport-diagnostic",
    "data-app-vh",
    "data-app-frame-vh",
    "data-app-gap-bottom",
    "data-app-layout-gap-bottom",
    "data-app-safe-bottom",
    "data-app-vv-bottom",
    "data-app-keyboard",
    "data-app-shell-spill",
  ];

  const isEditableElement = (el: unknown): boolean => {
    if (!el || typeof el !== "object") return false;
    const anyEl = el as HTMLElement & { isContentEditable?: boolean };
    const tag = typeof anyEl.tagName === "string" ? anyEl.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea") return true;
    return Boolean(anyEl.isContentEditable);
  };

  const markEditableFocus = (target: EventTarget | null) => {
    if (isEditableElement(target)) lastEditableFocusTs = Date.now();
  };

  const clearEditableFocus = (target: EventTarget | null) => {
    if (isEditableElement(target)) lastEditableFocusTs = 0;
  };

  const markEditablePointer = (target: EventTarget | null) => {
    if (isEditableElement(target)) lastEditablePointerTs = Date.now();
  };

  try {
    if (isIos && docEl?.classList) docEl.classList.add("is-ios");
    if (standalone && docEl?.classList) docEl.classList.add("is-standalone");
  } catch {
    // ignore
  }

  const varCache = new Map<string, string | null>();

  const setVar = (name: string, value: string | null) => {
    const docStyle = docEl && (docEl as HTMLElement).style ? (docEl as HTMLElement).style : null;
    const prev = varCache.get(name);
    if (prev === value) return;
    varCache.set(name, value);
    if (value === null) {
      root.style.removeProperty(name);
      docStyle?.removeProperty(name);
      return;
    }
    root.style.setProperty(name, value);
    docStyle?.setProperty(name, value);
  };

  const setDiagnosticAttr = (name: string, value: string | null) => {
    const targets: Array<HTMLElement | null> = [
      root,
      docEl as HTMLElement | null,
      typeof document !== "undefined" ? ((document as any).body as HTMLElement | null) : null,
    ];
    for (const target of targets) {
      try {
        if (!target || typeof target.setAttribute !== "function") continue;
        if (value === null) target.removeAttribute?.(name);
        else target.setAttribute(name, value);
      } catch {
        // ignore
      }
    }
  };

  const clearDiagnosticAttrs = () => {
    for (const name of diagnosticAttrNames) setDiagnosticAttr(name, null);
  };

  const readBoolish = (value: unknown): boolean | null => {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return null;
    if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
    if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
    return null;
  };

  const bottomDiagnosticsEnabled = (): boolean => {
    try {
      const url = new URL(window.location.href);
      const value = readBoolish(url.searchParams.get("__bottom_diag"));
      if (value === true) {
        window.sessionStorage?.setItem("yagodka_bottom_diagnostics", "1");
        return true;
      }
      if (value === false) {
        window.sessionStorage?.removeItem("yagodka_bottom_diagnostics");
        window.localStorage?.removeItem("yagodka_bottom_diagnostics");
        return false;
      }
    } catch {
      // ignore
    }
    try {
      const sessionValue = readBoolish(window.sessionStorage?.getItem("yagodka_bottom_diagnostics"));
      if (sessionValue !== null) return sessionValue;
    } catch {
      // ignore
    }
    try {
      const localValue = readBoolish(window.localStorage?.getItem("yagodka_bottom_diagnostics"));
      if (localValue !== null) return localValue;
      return readBoolish(window.localStorage?.getItem("yagodka_debug")) === true;
    } catch {
      return false;
    }
  };

  const read = (): {
    height: number;
    keyboard: boolean;
    vvTop: number;
    vvBottom: number;
    gapBottom: number;
    layoutGapBottom: number;
    safeBottomRaw: number;
    vhHeight: number;
    frameHeight: number;
  } => {
    const USE_VISUAL_VIEWPORT_DIFF_PX = 96;
    const USE_VISUAL_VIEWPORT_DIFF_FOCUSED_PX = 32;
    // On iOS/Safari even a small (few px) mismatch between layout viewport and visual viewport
    // can clip fixed bottom bars under browser chrome. Prefer visualViewport when it is smaller.
    const USE_VISUAL_VIEWPORT_NONKEYBOARD_DIFF_PX = 2;
    // Modern rounded iPhones in standalone/PWA mode can report a larger delta
    // between screen.height and the layout viewport than the classic 34px home
    // indicator. Own that physical bottom inside the app shell instead of
    // leaving it as an external unused strip.
    const USE_SCREEN_HEIGHT_SLACK_PX = 180;
    const inner = Math.round(Number(window.innerHeight) || 0);
    const docEl = typeof document !== "undefined" ? document.documentElement : null;
    const client = docEl && typeof docEl.clientHeight === "number" ? Math.round(Number(docEl.clientHeight) || 0) : 0;
    // Prefer the *visual* viewport height for app layout (like tweb `--vh`),
    // otherwise fixed/fullscreen elements may end up behind Safari UI and get clipped.
    const iosEnv = isIos || iosStandalone;
    let screenMax = 0;
    try {
      const sh = Math.round(Number((window as any).screen?.height) || 0);
      if (sh > 0) screenMax = Math.max(screenMax, sh);
      const avail = Math.round(Number((window as any).screen?.availHeight) || 0);
      if (avail > 0) screenMax = Math.max(screenMax, avail);
      const outer = Math.round(Number((window as any).outerHeight) || 0);
      if (iosEnv && outer > 0) screenMax = Math.max(screenMax, outer);
    } catch {
      // ignore
    }
    const base = inner > 0 ? inner : client > 0 ? client : lastStableLayout > 0 ? lastStableLayout : screenMax;
    const safeBottomRaw = (() => {
      if (!docEl || typeof window === "undefined" || typeof window.getComputedStyle !== "function") return 0;
      try {
        const raw = window.getComputedStyle(docEl).getPropertyValue("--safe-bottom-raw");
        const parsed = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? Math.round(parsed) : 0;
      } catch {
        return 0;
      }
    })();
    // iOS PWA: sometimes innerHeight/clientHeight are missing the physical rounded-screen bottom.
    // Treat that measured slack as part of the app shell, while keeping keyboard mode tied to visualViewport.
    let gapBottom = 0;
    let screenGap = 0;
    // Only treat screen.height deltas as a "gap" in standalone mode.
    // In Safari, the difference often includes browser chrome and should NOT be treated as safe-area.
    if (iosStandalone && base > 0 && screenMax > base) {
      const diff = screenMax - base;
      screenGap = diff;
      if (diff >= 6 && diff <= USE_SCREEN_HEIGHT_SLACK_PX) gapBottom = diff;
    }
    // Fallback: some iOS PWA builds report screen.height without the rounded-screen slack while
    // `env(safe-area-inset-bottom)` still exposes the physical bottom that must belong to the app frame.
    if (iosStandalone && safeBottomRaw > 0 && safeBottomRaw <= USE_SCREEN_HEIGHT_SLACK_PX) {
      gapBottom = Math.max(gapBottom, safeBottomRaw);
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
    // "Layout viewport" height: stable baseline for vvTop/vvBottom math.
    // When iOS keyboard opens WebKit may shrink innerHeight/clientHeight; keep the pre-keyboard height to compute coveredBottom.
    const layoutBase = Math.max(inner, client);
    const layout = Math.max(layoutBase, lastStableLayout);
    lastLayout = layout;
    // For our "fullscreen fixed app" we only care about viewport shifts *down*.
    // Clamp to a sane range to avoid weird negative values on iOS/WebKit edge cases.
    let vvTop = Math.max(0, vvTopRaw);
    const layoutClamp = Math.max(layout, iosEnv ? screenMax : 0);
    if (layoutClamp && vvHeight) vvTop = Math.max(0, Math.min(vvTop, Math.max(0, layoutClamp - vvHeight)));
    // Bottom area covered by keyboard (or other UI) in the *layout viewport* coordinate space.
    //
    // iOS/WebKit can report a mix of:
    // - layout viewport that shrinks (resize) to match visualViewport (then coveredBottom should be ~0),
    // - layout viewport that stays stable while only visualViewport shrinks (then coveredBottom is keyboard height),
    // - visualViewport.offsetTop shifts while the layout also resizes (the tricky case).
    //
    // For keyboard detection we want a robust (often larger) estimate, but for positioning (app-vv-offset)
    // we must avoid overestimating the inset, otherwise the composer floats above the keyboard with a visible gap.
    const coveredBottomStable = layout && vvHeight ? Math.max(0, layout - (vvHeight + vvTop)) : 0;
    const coveredBottomNow = layoutBase && vvHeight ? Math.max(0, layoutBase - (vvHeight + vvTop)) : 0;
    const hasLayoutBase = layoutBase > 0;
    const coveredBottomForKeyboard = hasLayoutBase ? Math.max(coveredBottomStable, coveredBottomNow) : coveredBottomStable;
    const coveredBottomForLayout = hasLayoutBase ? Math.min(coveredBottomStable, coveredBottomNow) : coveredBottomStable;
    const keyboardCoveredBottom = Math.max(0, coveredBottomForKeyboard - gapBottom);
    const layoutCoveredBottom = Math.max(0, coveredBottomForLayout - gapBottom);
    let activeEditable = false;
    try {
      const ae = typeof document !== "undefined" ? (document as any).activeElement : null;
      activeEditable = Boolean(ae && isEditableElement(ae));
    } catch {
      activeEditable = false;
    }
    const now = Date.now();
    const recentFocus = Boolean(lastEditableFocusTs && now - lastEditableFocusTs <= EDITABLE_INTENT_MS);
    const recentPointer = Boolean(lastEditablePointerTs && now - lastEditablePointerTs <= EDITABLE_INTENT_MS);
    const focusLikely = Boolean(activeEditable || (iosEnv && (recentFocus || recentPointer)));
    const keyboardThreshold = activeEditable ? USE_VISUAL_VIEWPORT_DIFF_FOCUSED_PX : USE_VISUAL_VIEWPORT_DIFF_PX;
    const keyboardByViewport = Boolean(
      focusLikely && vvHeight && layout && keyboardCoveredBottom >= USE_VISUAL_VIEWPORT_DIFF_PX
    );
    const keyboard = Boolean(activeEditable && vvHeight && layout && keyboardCoveredBottom >= keyboardThreshold);
    const innerDiffRaw = lastStableLayout && inner ? Math.max(0, lastStableLayout - inner) : 0;
    const innerDiff = Math.max(0, innerDiffRaw - gapBottom);
    const keyboardByInner = Boolean(iosEnv && focusLikely && innerDiff >= USE_VISUAL_VIEWPORT_DIFF_PX);
    const keyboardVisible = Boolean(keyboard || (iosEnv && (keyboardByViewport || keyboardByInner)));
    const allowVisualViewportHeight = Boolean(
      iosEnv && vvHeight && vvHeight > 0 && base > 0 && base - vvHeight >= USE_VISUAL_VIEWPORT_NONKEYBOARD_DIFF_PX
    );
    // iOS standalone: prefer layout height when keyboard is closed to avoid clipping header/footer.
    const useVisualViewportHeight = Boolean(allowVisualViewportHeight && (!iosStandalone || keyboardVisible));
    const resolved = keyboardVisible ? (vvHeight > 0 ? vvHeight : base) : useVisualViewportHeight ? vvHeight : base;
    const rawHeight = Math.round(Number(resolved) || 0);
    // Guard against transient 0-1px heights from WebKit that collapse the layout.
    const minHeight = 200;
    const height = rawHeight > 0 && rawHeight < minHeight && base >= minHeight ? base : rawHeight;
    const fallbackHeight =
      lastStableLayout > 0 ? lastStableLayout : lastHeight > 0 ? lastHeight : screenMax > 0 ? screenMax : 0;
    const resolvedHeight = height > 0 ? height : fallbackHeight;
    const vhHeight = keyboardVisible ? (vvHeight > 0 ? vvHeight : base) : base;
    const resolvedVhHeight = vhHeight > 0 ? vhHeight : resolvedHeight;
    const layoutOwnedGap = keyboardVisible ? 0 : gapBottom;
    const frameHeight = resolvedHeight > 0 ? resolvedHeight + layoutOwnedGap : 0;
    return {
      height: resolvedHeight,
      keyboard: keyboardVisible,
      vvTop,
      vvBottom: Math.round(layoutCoveredBottom),
      gapBottom,
      layoutGapBottom: layoutOwnedGap,
      safeBottomRaw,
      vhHeight: resolvedVhHeight,
      frameHeight,
    };
  };

  const apply = () => {
    rafId = null;
    const { height, keyboard, vvTop, vvBottom, gapBottom, layoutGapBottom, safeBottomRaw, vhHeight, frameHeight } =
      read();
    if (!height) {
      if (docEl?.classList) docEl.classList.remove("app-vv-offset");
      if (docEl?.classList) docEl.classList.remove("kbd-open");
      if (docEl?.classList) docEl.classList.remove("app-shell-physical-bottom");
      setVar("--app-vv-top", null);
      setVar("--app-vv-bottom", null);
      setVar("--app-gap-bottom", null);
      setVar("--app-layout-gap-bottom", null);
      setVar("--app-frame-vh", null);
      setVar("--app-shell-bottom-spill", null);
      setVar("--safe-bottom-pad", null);
      setVar("--safe-bottom-raw", null);
      clearDiagnosticAttrs();
      return;
    }

    if (docEl?.classList) docEl.classList.toggle("kbd-open", keyboard);

    const vhSource = vhHeight > 0 ? vhHeight : height;
    const vh = +((vhSource * 0.01) as number).toFixed(2);
    setVar("--vh", `${vh}px`);
    setVar("--app-frame-vh", `${frameHeight > 0 ? frameHeight : height}px`);

    // When iOS keyboard is visible, safe-area inset bottom is not useful (it's under the keyboard)
    // and creates an ugly gap above the keyboard. Override it to 0 while keyboard is open.
    // Use viewport-based detection too: sometimes activeElement is not yet an input when resize fires.
    // iPhone safe-area bottom is typically 34px; keep at least that when safe-area is present.
    const minSafeBottomPad = (() => {
      if (!isIos || keyboard) return 0;
      const candidate = Math.max(safeBottomRaw, gapBottom);
      return candidate >= 28 ? 34 : 0;
    })();
    if (keyboard) {
      setVar("--safe-bottom-pad", "0px");
      setVar("--safe-bottom-raw", "0px");
    } else {
      if (minSafeBottomPad) setVar("--safe-bottom-pad", `${Math.max(safeBottomRaw, minSafeBottomPad)}px`);
      else setVar("--safe-bottom-pad", null);
      setVar("--safe-bottom-raw", null);
    }

    // iOS Safari/PWA: when the keyboard opens WebKit can scroll the *visual* viewport (offsetTop > 0).
    // If we only shrink height to visualViewport.height, the app ends above the visible bottom and leaves a
    // "black strip" + composer jumps upward. Anchor the fixed app to visualViewport.offsetTop.
    const shouldOffset = Boolean(keyboard && vvTop >= 1);
    if (shouldOffset) setVar("--app-vv-top", `${vvTop}px`);
    else setVar("--app-vv-top", null);
    if (docEl?.classList) docEl.classList.toggle("app-vv-offset", shouldOffset);

    // Similarly, when keyboard is open we want the fixed app to end at the visual viewport bottom.
    // Expose the covered bottom (usually keyboard height) as CSS var so mobile layout can use `bottom: ...`
    // instead of relying solely on `height: ...` (more stable on iOS).
    if (keyboard && vvBottom >= 1) setVar("--app-vv-bottom", `${vvBottom}px`);
    else setVar("--app-vv-bottom", null);

    const gap = gapBottom;
    const physicalBottom = iosStandalone && !keyboard && gap >= 1;
    const shellBottomSpill = 0;
    if (gap >= 1) setVar("--app-gap-bottom", `${gap}px`);
    else setVar("--app-gap-bottom", null);
    setVar("--app-shell-bottom-spill", null);
    if (docEl?.classList) docEl.classList.toggle("app-shell-physical-bottom", physicalBottom);
    if (keyboard) setVar("--app-layout-gap-bottom", "0px");
    else if (layoutGapBottom >= 1) setVar("--app-layout-gap-bottom", `${layoutGapBottom}px`);
    else setVar("--app-layout-gap-bottom", null);

    if (bottomDiagnosticsEnabled()) {
      setDiagnosticAttr("data-viewport-diagnostic", "1");
      setDiagnosticAttr("data-app-vh", `${height}`);
      setDiagnosticAttr("data-app-frame-vh", `${frameHeight > 0 ? frameHeight : height}`);
      setDiagnosticAttr("data-app-gap-bottom", `${gap}`);
      setDiagnosticAttr("data-app-layout-gap-bottom", `${keyboard ? 0 : layoutGapBottom}`);
      setDiagnosticAttr("data-app-safe-bottom", `${keyboard ? 0 : Math.max(safeBottomRaw, gapBottom)}`);
      setDiagnosticAttr("data-app-vv-bottom", `${keyboard ? vvBottom : 0}`);
      setDiagnosticAttr("data-app-keyboard", keyboard ? "1" : "0");
      setDiagnosticAttr("data-app-shell-spill", `${shellBottomSpill}`);
    } else {
      clearDiagnosticAttrs();
    }

    if (Math.abs(height - lastHeight) < 1) return;
    lastHeight = height;
    if (!keyboard) lastStableLayout = lastLayout;
    setVar("--app-vh", `${height}px`);
  };

  const schedule = () => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(apply);
  };

  schedule();

  const onResize = () => schedule();
  const onVisibility = () => {
    try {
      if (document.visibilityState !== "visible") return;
    } catch {
      // ignore
    }
    schedule();
  };
  const vv = window.visualViewport;
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("pageshow", onResize, { passive: true });
  window.addEventListener("orientationchange", onResize, { passive: true });
  vv?.addEventListener("resize", onResize, { passive: true });
  vv?.addEventListener("scroll", onResize, { passive: true });
  const doc = typeof document !== "undefined" ? (document as any) : null;
  let onFocusIn: ((ev: Event) => void) | null = null;
  let onFocusOut: ((ev: Event) => void) | null = null;
  let onPointer: ((ev: Event) => void) | null = null;
  const canFocusEvents = Boolean(doc && typeof doc.addEventListener === "function" && typeof doc.removeEventListener === "function");
  if (canFocusEvents) {
    onFocusIn = (ev: Event) => {
      markEditableFocus((ev as Event & { target: EventTarget | null }).target);
      onResize();
    };
    onFocusOut = (ev: Event) => {
      clearEditableFocus((ev as Event & { target: EventTarget | null }).target);
      onResize();
    };
    onPointer = (ev: Event) => {
      markEditablePointer((ev as Event & { target: EventTarget | null }).target);
    };
    doc.addEventListener("focusin", onFocusIn, { passive: true });
    doc.addEventListener("focusout", onFocusOut, { passive: true });
    doc.addEventListener("pointerdown", onPointer, { passive: true });
    doc.addEventListener("touchstart", onPointer, { passive: true });
    doc.addEventListener("visibilitychange", onVisibility, { passive: true });
  }

  return () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pageshow", onResize);
    window.removeEventListener("orientationchange", onResize);
    vv?.removeEventListener("resize", onResize);
    vv?.removeEventListener("scroll", onResize);
    if (canFocusEvents) {
      if (onFocusIn) doc.removeEventListener("focusin", onFocusIn);
      if (onFocusOut) doc.removeEventListener("focusout", onFocusOut);
      if (onPointer) doc.removeEventListener("pointerdown", onPointer);
      if (onPointer) doc.removeEventListener("touchstart", onPointer);
      doc.removeEventListener("visibilitychange", onVisibility);
    }
    try {
      if (isIos && docEl?.classList) docEl.classList.remove("is-ios");
      if (standalone && docEl?.classList) docEl.classList.remove("is-standalone");
    } catch {
      // ignore
    }
    if (docEl?.classList) docEl.classList.remove("kbd-open");
    setVar("--vh", null);
    setVar("--app-vh", null);
    setVar("--app-frame-vh", null);
    setVar("--safe-bottom-pad", null);
    setVar("--safe-bottom-raw", null);
    setVar("--app-vv-top", null);
    setVar("--app-vv-bottom", null);
    setVar("--app-gap-bottom", null);
    setVar("--app-layout-gap-bottom", null);
    setVar("--app-shell-bottom-spill", null);
    clearDiagnosticAttrs();
    if (docEl?.classList) docEl.classList.remove("app-vv-offset");
    if (docEl?.classList) docEl.classList.remove("app-shell-physical-bottom");
  };
}
