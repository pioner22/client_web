const ID_STORAGE_KEY = "yagodka_auth_id";
const SESSION_STORAGE_KEY = "yagodka_auth_session";
const COOKIE_ID = "yagodka_auth_id";
const COOKIE_SESSION = "yagodka_auth_session";

const MAX_TOKEN_LEN = 512;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,512}$/;

const AUTOAUTH_BLOCK_KEY = "yagodka_autoauth_block_v1";

function getCookie(name: string): string | null {
  try {
    const parts = String(document.cookie || "").split(";");
    for (const raw of parts) {
      const [k, ...rest] = raw.trim().split("=");
      if (!k) continue;
      if (k === name) return decodeURIComponent(rest.join("=") || "");
    }
  } catch {
    // ignore
  }
  return null;
}

function getCookieDomain(): string | null {
  try {
    const host = String(window.location.hostname || "").trim().toLowerCase();
    if (!host) return null;
    // Share auth cookies between yagodka.org and www.yagodka.org (web + PWA).
    if (host === "yagodka.org" || host.endsWith(".yagodka.org")) return "yagodka.org";
  } catch {
    // ignore
  }
  return null;
}

function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    const base = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Strict`;
    document.cookie = `${base}${secure}`;
    const domain = getCookieDomain();
    if (domain) {
      document.cookie = `${base}; Domain=${domain}${secure}`;
    }
  } catch {
    // ignore
  }
}

function deleteCookie(name: string): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    const base = `${name}=; Path=/; Max-Age=0; SameSite=Strict`;
    document.cookie = `${base}${secure}`;
    const domain = getCookieDomain();
    if (domain) {
      document.cookie = `${base}; Domain=${domain}${secure}`;
    }
  } catch {
    // ignore
  }
}

function normalizeToken(input: unknown): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (raw.length > MAX_TOKEN_LEN) return null;
  if (!TOKEN_RE.test(raw)) return null;
  return raw;
}

export function getStoredAuthId(): string | null {
  try {
    const v = (localStorage.getItem(ID_STORAGE_KEY) || "").trim();
    if (v) return v;
  } catch {
    // ignore
  }
  const c = (getCookie(COOKIE_ID) || "").trim();
  return c ? c : null;
}

export function storeAuthId(id: string): void {
  const v = String(id ?? "").trim();
  if (!v) return;
  try {
    localStorage.setItem(ID_STORAGE_KEY, v);
  } catch {
    // ignore
  }
  setCookie(COOKIE_ID, v, 365 * 24 * 3600);
}

export function clearStoredAuthId(): void {
  try {
    localStorage.removeItem(ID_STORAGE_KEY);
  } catch {
    // ignore
  }
  deleteCookie(COOKIE_ID);
}

export function getStoredSessionToken(): string | null {
  try {
    const v = normalizeToken(localStorage.getItem(SESSION_STORAGE_KEY));
    if (v) return v;
  } catch {
    // ignore
  }
  return normalizeToken(getCookie(COOKIE_SESSION));
}

export function storeSessionToken(token: string): void {
  const v = normalizeToken(token);
  if (!v) return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, v);
  } catch {
    // ignore
  }
  // 30 days
  setCookie(COOKIE_SESSION, v, 30 * 24 * 3600);
}

export function clearStoredSessionToken(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
  deleteCookie(COOKIE_SESSION);
}

export function clearStoredAuthAll(): void {
  clearStoredAuthId();
  clearStoredSessionToken();
}

export function isSessionAutoAuthBlocked(): boolean {
  try {
    return sessionStorage.getItem(AUTOAUTH_BLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function blockSessionAutoAuth(): void {
  try {
    sessionStorage.setItem(AUTOAUTH_BLOCK_KEY, "1");
  } catch {
    // ignore
  }
}

export function clearSessionAutoAuthBlock(): void {
  try {
    sessionStorage.removeItem(AUTOAUTH_BLOCK_KEY);
  } catch {
    // ignore
  }
}
