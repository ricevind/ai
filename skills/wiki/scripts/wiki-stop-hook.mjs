#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_HOOK_COMMAND = /^node '((?:[^']|'\\'')+)'$/;

function repoHookScript(command) {
  const script = REPO_HOOK_COMMAND.exec(command ?? "")?.[1].replaceAll("'\\''", "'");
  return script?.endsWith("/skills/wiki/scripts/wiki-stop-hook.mjs") ? script : undefined;
}

export function hasRepoHook(projectDir) {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(projectDir, ".claude/settings.local.json"), "utf8"));
    const entries = settings.hooks?.Stop ?? [];
    return entries.some((entry) =>
      (entry.hooks ?? []).some((hook) => {
        const script = repoHookScript(hook.command);
        return script !== undefined && fs.existsSync(script);
      }),
    );
  } catch {
    return false;
  }
}

export async function nudgeReason(projectDir, { global }) {
  if (!fs.existsSync(path.join(projectDir, "docs/wiki"))) return;
  if (global && hasRepoHook(projectDir)) return;

  // wiki.mjs reads WIKI_ROOT once at load, so it must be set before the first import.
  const previousRoot = process.env.WIKI_ROOT;
  process.env.WIKI_ROOT = projectDir;
  let wiki;
  try {
    wiki = await import("./wiki.mjs");
  } finally {
    if (previousRoot === undefined) delete process.env.WIKI_ROOT;
    else process.env.WIKI_ROOT = previousRoot;
  }
  const { affectedPages, changedFiles, readWikiConfig } = wiki;
  let config;
  try {
    config = readWikiConfig(projectDir);
  } catch (error) {
    if (global) return;
    throw error;
  }
  if (!config) return;

  const changed = changedFiles();
  const changedSet = new Set(changed);
  const code = changed.filter((f) => !f.startsWith("docs/"));
  const stale = affectedPages(code).filter((p) => !changedSet.has(p.page));
  if (!stale.length) return;

  // Nudge once per set of changes, so an answer of "no update needed" sticks.
  const fingerprint = createHash("sha1")
    .update(JSON.stringify(stale.map((p) => [p.page, p.files])))
    .digest("hex");
  const marker = execFileSync("git", ["rev-parse", "--git-path", "wiki-nudge"], { cwd: projectDir, encoding: "utf8" }).trim();
  const markerPath = path.resolve(projectDir, marker);
  if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, "utf8") === fingerprint) return;
  fs.writeFileSync(markerPath, fingerprint);

  const list = stale.map((p) => `- ${p.page} (covers ${p.files.join(", ")})`).join("\n");
  return [
    "These wiki pages cover code you changed, but are unchanged:",
    list,
    "",
    "If a change alters what a page states (behaviour, rules, key files), update the page following docs/README.md, then run `node scripts/wiki.mjs`.",
    "If no page needs a change, say so in one line and stop.",
  ].join("\n");
}

async function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    // No input: run as if this were a first stop.
  }
  if (input.stop_hook_active) return;

  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const reason = await nudgeReason(projectDir, { global: process.argv.includes("--global") });
  if (reason) process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch {
    // Not a git checkout, or anything else: let Claude stop.
  }
}
