import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "wiki.mjs");

let root;

function write(rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function wiki(...args) {
  return spawnSync("node", [SCRIPT, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, WIKI_ROOT: root } });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-test-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  write("harness.json", JSON.stringify({ wiki: { sourceDirs: ["src"] } }));
  write("docs/wiki/t/page.md", "---\ncovers:\n  - src/a.ts\n---\n# Page\n\n## Rules\n\n## Code\n");
  write("docs/wiki/t/glossary.md", "# Glossary\n\n- **Thing** — a thing. [Page](page.md)\n");
  write("src/a.ts", "export {};\n");
  write("docs/specs/2026-01-01-x.md", "# Spec\n\n[gone](./missing.md)\n");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("wiki.mjs", () => {
  test("index writes docs/index/src.md from covers", () => {
    const result = wiki();
    assert.equal(result.status, 0, result.stderr);
    const index = fs.readFileSync(path.join(root, "docs/index/src.md"), "utf8");
    assert.match(index, /page\.md/);
    assert.match(index, /node scripts\/wiki\.mjs/);
  });

  test("check passes and ignores dead links under docs/specs", () => {
    wiki();
    const result = wiki("check");
    assert.equal(result.status, 0, result.stderr);
  });

  test("check reports an uncovered file in a sourceDir", () => {
    write("src/b.ts", "export {};\n");
    wiki();
    const result = wiki("check");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no wiki page covers this file/);
  });

  test("cli fails without a wiki key", () => {
    write("harness.json", "{}");
    const result = wiki("check");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no `wiki` key in harness\.json/);
  });
});

describe("readWikiConfig", () => {
  const load = async () => {
    process.env.WIKI_ROOT = root;
    return (await import(`${SCRIPT}?${Math.random()}`)).readWikiConfig;
  };

  test("returns undefined without harness.json or wiki key", async () => {
    const readWikiConfig = await load();
    assert.deepEqual(readWikiConfig(root), { sourceDirs: ["src"] });
    write("harness.json", "{}");
    assert.equal(readWikiConfig(root), undefined);
    fs.rmSync(path.join(root, "harness.json"));
    assert.equal(readWikiConfig(root), undefined);
  });

  test("throws on malformed harness.json", async () => {
    const readWikiConfig = await load();
    write("harness.json", "{nope");
    assert.throws(() => readWikiConfig(root), /harness\.json/);
  });
});
