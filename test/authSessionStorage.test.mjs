import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadSessionModule() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/auth/session.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function mkStorage() {
  const map = new Map();
  return {
    getItem(k) {
      const v = map.get(String(k));
      return v === undefined ? null : v;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
    _dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

function withGlobals(stubs, run) {
  const prevDesc = {
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
  };

  if ("document" in stubs) Object.defineProperty(globalThis, "document", { value: stubs.document, configurable: true });
  if ("window" in stubs) Object.defineProperty(globalThis, "window", { value: stubs.window, configurable: true });
  if ("localStorage" in stubs) Object.defineProperty(globalThis, "localStorage", { value: stubs.localStorage, configurable: true });
  if ("sessionStorage" in stubs) Object.defineProperty(globalThis, "sessionStorage", { value: stubs.sessionStorage, configurable: true });

  try {
    return run();
  } finally {
    for (const k of Object.keys(prevDesc)) {
      const d = prevDesc[k];
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
}

function mkCookieDoc() {
  const jar = new Map();
  const writes = [];
  const doc = {};
  Object.defineProperty(doc, "cookie", {
    configurable: true,
    get() {
      return Array.from(jar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
    set(v) {
      const raw = String(v || "");
      writes.push(raw);
      const first = raw.split(";")[0] || "";
      const idx = first.indexOf("=");
      if (idx <= 0) return;
      const k = first.slice(0, idx).trim();
      const val = first.slice(idx + 1).trim();
      if (!k) return;
      if (raw.includes("Max-Age=0")) jar.delete(k);
      else jar.set(k, val);
    },
  });
  return { doc, jar, writes };
}

test("auth/session: storeSessionToken пишет cookie SameSite=Strict (+Secure для https) и localStorage", async () => {
  const { mod, cleanup } = await loadSessionModule();
  try {
    const { storeSessionToken, getStoredSessionToken } = mod;
    const localStorage = mkStorage();
    const sessionStorage = mkStorage();
    const { doc, writes } = mkCookieDoc();

    withGlobals(
      {
        document: doc,
        localStorage,
        sessionStorage,
        window: { location: { protocol: "https:", hostname: "yagodka.org" } },
      },
      () => {
        storeSessionToken("A".repeat(32));
        assert.equal(getStoredSessionToken(), "A".repeat(32));
        assert.equal(localStorage.getItem("yagodka_auth_session"), "A".repeat(32));
        assert.ok(writes.length >= 1);
        assert.ok(writes.some((x) => x.includes("SameSite=Strict")));
        assert.ok(writes.some((x) => x.includes("Secure")));
      }
    );
  } finally {
    await cleanup();
  }
});

test("auth/session: normalizeToken отбрасывает мусор и не пишет хранилище", async () => {
  const { mod, cleanup } = await loadSessionModule();
  try {
    const { storeSessionToken, getStoredSessionToken } = mod;
    const localStorage = mkStorage();
    const sessionStorage = mkStorage();
    const { doc, writes } = mkCookieDoc();

    withGlobals(
      {
        document: doc,
        localStorage,
        sessionStorage,
        window: { location: { protocol: "https:", hostname: "yagodka.org" } },
      },
      () => {
        storeSessionToken("short");
        storeSessionToken("bad token with spaces");
        storeSessionToken("x".repeat(600));
        assert.equal(getStoredSessionToken(), null);
        assert.equal(localStorage.getItem("yagodka_auth_session"), null);
        assert.equal(writes.length, 0);
      }
    );
  } finally {
    await cleanup();
  }
});

test("auth/session: cookies шарятся между www.yagodka.org и yagodka.org", async () => {
  const { mod, cleanup } = await loadSessionModule();
  try {
    const { storeAuthId } = mod;
    const localStorage = mkStorage();
    const sessionStorage = mkStorage();
    const { doc, writes } = mkCookieDoc();

    withGlobals(
      {
        document: doc,
        localStorage,
        sessionStorage,
        window: { location: { protocol: "https:", hostname: "www.yagodka.org" } },
      },
      () => {
        storeAuthId("854-432-319");
        assert.ok(writes.some((x) => x.includes("Domain=yagodka.org")));
      }
    );
  } finally {
    await cleanup();
  }
});

