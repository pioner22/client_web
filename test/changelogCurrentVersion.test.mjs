import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");

test("changelog starts with current package version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const changelog = fs.readFileSync(path.join(root, "src/config/changelog/part01.ts"), "utf8");
  const match = changelog.match(/CHANGELOG_PART_01:\s*ChangelogEntry\[\]\s*=\s*\[\s*\{\s*version:\s*"([^"]+)"/s);
  assert.ok(match, "top changelog version not found");
  assert.equal(match[1], pkg.version);
});
