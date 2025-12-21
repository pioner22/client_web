import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("security: index.html без inline <script> (CSP script-src 'self')", async () => {
  const htmlPath = path.resolve("index.html");
  const html = await readFile(htmlPath, "utf8");

  const inline = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = String(m[1] || "");
    const body = String(m[2] || "");
    const hasSrc = /\bsrc\s*=\s*["'][^"']+["']/i.test(attrs);
    if (hasSrc) continue;
    if (body.trim().length === 0) continue;
    inline.push({ attrs: attrs.trim().slice(0, 120), body: body.trim().slice(0, 120) });
  }

  assert.equal(inline.length, 0, `Найдены inline <script> в index.html: ${JSON.stringify(inline)}`);
});

