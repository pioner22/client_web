import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test(".hidden forces display:none", async () => {
  const css = await readFile(path.resolve("src/scss/modal.css"), "utf8");
  assert.match(css, /\.hidden\s*\{[\s\S]*?display:\s*none\s*!important\s*;[\s\S]*?\}/);
});

