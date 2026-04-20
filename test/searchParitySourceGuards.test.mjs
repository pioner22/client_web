import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("search parity: global search uses pivot query builder and active-tab visibility helper", async () => {
  const src = await readFile(path.resolve("src/pages/search/createSearchPage.ts"), "utf8");
  assert.match(src, /buildPivotSearchQuery\(filters\)/);
  assert.match(src, /keepActiveControlVisible\(tabsBar, "\.search-tab\.is-active"\)/);
  assert.match(src, /keepActiveControlVisible\(filterBar, "\.search-filter\.is-active"\)/);
});

test("search parity: chat search uses active-filter visibility helper", async () => {
  const src = await readFile(path.resolve("src/components/chat/renderChat.ts"), "utf8");
  assert.match(src, /keepActiveControlVisible\(searchBar, "\.chat-search-filter\.is-active"\)/);
});
