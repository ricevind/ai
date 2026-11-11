import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { hasRepoHook } from "./wiki-stop-hook.mjs";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "wiki-stop-hook.mjs");

let root;

function write(rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function nudge(options) {
  const script = `import { nudgeReason } from ${JSON.stringify(HOOK)};
    process.stdout.write(JSON.stringify((await nudgeReason(${JSON.stringify(root)}, ${JSON.stringify(options)})) ?? null));`;
  const result = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function settingsWithStopCommand(command) {
  write(".claude/settings.local.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-hook-test-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  write("harness.json", JSON.stringify({ wiki: { sourceDirs: ["src"] } }));
  write("docs/wiki/t/page.md", "---\ncovers:\n  - src/a.ts\n---\n# Page\n");
  write("src/a.ts", "export {};\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: root });
  write("src/a.ts", "export const changed = true;\n");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("nudgeReason", () => {
  test("returns a reason when covered code changed and its page did not", () => {
    const reason = nudge({ global: false });
    assert.match(reason, /docs\/wiki\/t\/page\.md/);
    assert.match(reason, /node scripts\/wiki\.mjs/);
    assert.match(reason, /docs\/README\.md/);
  });

  test("returns undefined the second time for the same changes", () => {
    assert.ok(nudge({ global: false }));
    assert.equal(nudge({ global: false }), null);
  });

  test("global mode is a no-op without docs/wiki, without a wiki key, with malformed harness.json, or when hasRepoHook is true", () => {
    settingsWithStopCommand("node '/x/skills/wiki/scripts/wiki-stop-hook.mjs'");
    assert.equal(nudge({ global: true }), null);
    fs.rmSync(path.join(root, ".claude"), { recursive: true });

    write("harness.json", "{}");
    assert.equal(nudge({ global: true }), null);

    write("harness.json", "{not json");
    assert.equal(nudge({ global: true }), null);

    write("harness.json", JSON.stringify({ wiki: { sourceDirs: ["src"] } }));
    fs.renameSync(path.join(root, "docs/wiki"), path.join(root, "docs/gone"));
    assert.equal(nudge({ global: true }), null);
  });

  test("global mode nudges when nothing else covers it", () => {
    assert.match(nudge({ global: true }), /page\.md/);
  });
});

describe("hasRepoHook", () => {
  test("detects a repo-level hook but not the global one", () => {
    assert.equal(hasRepoHook(root), false);
    settingsWithStopCommand("node '/x/wiki-stop-hook.mjs' --global");
    assert.equal(hasRepoHook(root), false);
    settingsWithStopCommand("node '/x/wiki-stop-hook.mjs'");
    assert.equal(hasRepoHook(root), true);
  });
});

describe("CLI", () => {
  test("exits 0 with no output outside a git repo", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-hook-nogit-"));
    try {
      const result = spawnSync("node", [HOOK, "--global"], { cwd: outside, input: "{}", encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: outside } });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test("prints a block decision for stale pages and stays silent when stop_hook_active", () => {
    const run = (input) => spawnSync("node", [HOOK], { cwd: root, input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    assert.equal(run('{"stop_hook_active":true}').stdout, "");
    const decision = JSON.parse(run("{}").stdout);
    assert.equal(decision.decision, "block");
    assert.match(decision.reason, /page\.md/);
  });
});
