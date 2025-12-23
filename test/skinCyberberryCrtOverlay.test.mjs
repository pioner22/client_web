import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("skin cyberberry-crt: overlay #app::before/#app::after учитывает visualViewport vars (top/bottom)", async () => {
  const css = await readFile(path.resolve("public/skins/cyberberry-crt.css"), "utf8");
  assert.match(css, /#app::before\s*\{/);
  assert.match(css, /#app::after\s*\{/);
  assert.match(css, /top:\s*var\(--app-vv-top,\s*0px\)\s*;/);
  assert.match(css, /bottom:\s*var\(--app-vv-bottom,\s*0px\)\s*;/);
});

