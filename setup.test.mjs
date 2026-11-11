import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	buildInitialSpec,
	buildMarketplace,
	buildPiManifest,
	globalClaudePlugins,
	deepMerge,
	findSpec,
	formatCatalog,
	loadCatalog,
	loadPresets,
	piUpstreamEntries,
	packageIdentity,
	parseSkillMetadata,
	renderCliScript,
	replaceManagedPackages,
	validateSpec,
} from "./setup.mjs";

const skillFile = (harness, scope, machine = "local remote") =>
	`---\nname: x\ndescription: y\nmetadata:\n  harness: ${harness}\n  scope: ${scope}\n  machine: ${machine}\n---\nbody\n`;

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-harness-test-"));
	const addSkill = (name, harness, scope, machine) => {
		fs.mkdirSync(path.join(root, "skills", name), { recursive: true });
		fs.writeFileSync(path.join(root, "skills", name, "SKILL.md"), skillFile(harness, scope, machine));
	};
	addSkill("shared-global", "claude pi", "global");
	addSkill("claude-global", "claude", "global");
	addSkill("pi-global", "pi", "global");
	addSkill("opt-in-own", "claude pi", "opt-in");
	addSkill("pi-opt-in", "pi", "opt-in");
	fs.mkdirSync(path.join(root, "skills", "synced"));
	fs.mkdirSync(path.join(root, "commands"));
	fs.writeFileSync(path.join(root, "commands", "hello.md"), "x\n");
	fs.mkdirSync(path.join(root, "pi", "prompts"), { recursive: true });
	fs.writeFileSync(path.join(root, "pi", "prompts", "implement.md"), "x\n");
	fs.mkdirSync(path.join(root, "pi", "extensions", "subagent"), { recursive: true });
	fs.writeFileSync(path.join(root, "pi", "extensions", "subagent", "index.ts"), "");
	fs.writeFileSync(path.join(root, "pi", "extensions", "web-search.ts"), "");
	fs.writeFileSync(
		path.join(root, "upstream.json"),
		JSON.stringify({
			skills: [
				{ name: "subdir", repo: "o/r", path: "skills/subdir", harness: "claude pi", scope: "global", machine: "local remote" },
				{ name: "whole", repo: "o/r", path: "skills/whole", harness: "claude pi", scope: "opt-in", machine: "local remote" },
			],
			piPackages: [],
		}),
	);
	fs.writeFileSync(path.join(root, "upstream.lock.json"), JSON.stringify({ skills: { subdir: "a".repeat(40), whole: "b".repeat(40) }, npm: {} }));
	return root;
}

test("parseSkillMetadata reads harness and scope", () => {
	assert.deepEqual(parseSkillMetadata(skillFile("claude pi", "opt-in"), "x"), { harnesses: ["claude", "pi"], scope: "opt-in", machines: ["local", "remote"] });
});

test("parseSkillMetadata rejects missing or invalid metadata", () => {
	assert.throws(() => parseSkillMetadata("---\nname: x\n---\n", "x"), /metadata.harness/);
	assert.throws(() => parseSkillMetadata(skillFile("codex", "global"), "x"), /metadata.harness/);
	assert.throws(() => parseSkillMetadata(skillFile("pi", "sometimes"), "x"), /metadata.scope/);
	assert.throws(() => parseSkillMetadata(skillFile("pi", "global", "moon"), "x"), /metadata.machine/);
	assert.throws(() => parseSkillMetadata("---\nname: x\nmetadata:\n  harness: pi\n  scope: global\n---\n", "x"), /metadata.machine/);
});

test("loadCatalog rejects a name declared twice for one harness but allows disjoint harnesses", () => {
	const root = fixture();
	fs.writeFileSync(path.join(root, "upstream.json"), JSON.stringify({ skills: [{ name: "pi-global", repo: "o/r", path: "p", harness: "claude", scope: "global", machine: "local remote" }], piPackages: [] }));
	assert.equal(loadCatalog(root).skills.filter((skill) => skill.name === "pi-global").length, 2);
	fs.writeFileSync(path.join(root, "upstream.json"), JSON.stringify({ skills: [{ name: "pi-global", repo: "o/r", path: "p", harness: "pi", scope: "global", machine: "local remote" }], piPackages: [] }));
	assert.throws(() => loadCatalog(root), /declared twice/);
});

test("buildMarketplace puts own global skills in ai and pins upstream plugins", () => {
	const root = fixture();
	const marketplace = buildMarketplace(loadCatalog(root), root);
	const [ai, subdir, whole] = marketplace.plugins;
	assert.deepEqual(ai.skills, ["./skills/claude-global", "./skills/shared-global"]);
	assert.deepEqual(ai.commands, ["./commands/hello.md"]);
	assert.deepEqual(subdir.source, { source: "git-subdir", url: "https://github.com/o/r.git", path: "skills/subdir", sha: "a".repeat(40) });
	assert.deepEqual(subdir.skills, ["./"]);
	assert.deepEqual(whole.source, { source: "git-subdir", url: "https://github.com/o/r.git", path: "skills/whole", sha: "b".repeat(40) });
});

test("buildMarketplace gives the ai plugin a global wiki Stop hook", () => {
	const root = fixture();
	const [ai] = buildMarketplace(loadCatalog(root), root).plugins;
	assert.deepEqual(ai.hooks, {
		Stop: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/skills/wiki/scripts/wiki-stop-hook.mjs" --global' }] }],
	});
});

test("buildMarketplace fails when an upstream skill isn't locked", () => {
	const root = fixture();
	fs.writeFileSync(path.join(root, "upstream.lock.json"), JSON.stringify({ skills: {}, npm: {} }));
	assert.throws(() => buildMarketplace(loadCatalog(root), root), /upstream.lock.json/);
});

test("buildPiManifest lists only own global pi skills", () => {
	const root = fixture();
	const { pi } = buildPiManifest(loadCatalog(root), root);
	assert.deepEqual(pi.skills, ["./skills/pi-global", "./skills/shared-global"]);
	assert.deepEqual(pi.extensions, ["./pi/extensions/subagent/index.ts", "./pi/extensions/web-search.ts"]);
	assert.deepEqual(pi.prompts, ["./commands/hello.md", "./pi/prompts/implement.md"]);
});

test("validateSpec accepts a catalog-only spec", () => {
	const root = fixture();
	const spec = { version: 1, harnesses: ["pi"], global: false, skills: ["whole", "pi-opt-in"], workflows: ["implement"], extensions: ["subagent"], config: ["instructions"], env: ["API_TOKEN"] };
	assert.deepEqual(validateSpec(spec, loadCatalog(root), root), []);
});

test("validateSpec rejects anything outside the catalog", () => {
	const root = fixture();
	const catalog = loadCatalog(root);
	const cases = [
		[{ version: 1, harnesses: ["pi"], hooks: {} }, /unknown field: hooks/],
		[{ version: 1, harnesses: ["pi"], settings: {} }, /unknown field: settings/],
		[{ version: 1, harnesses: ["pi"], skills: ["https://evil.example/x"] }, /unknown skill/],
		[{ version: 1, harnesses: ["pi"], skills: ["../../etc"] }, /unknown skill/],
		[{ version: 1, harnesses: ["pi"], extensions: ["../evil"] }, /unknown extension/],
		[{ version: 1, harnesses: ["pi"], workflows: ["../evil"] }, /unknown workflow/],
		[{ version: 1, harnesses: ["pi"], config: ["claude-settings"] }, /unknown config/],
		[{ version: 1, harnesses: ["pi"], env: ["lower-case;rm"] }, /invalid env/],
		[{ version: 1, harnesses: ["pi"], aiRef: "--upload-pack=x" }, /aiRef/],
		[{ version: 1, harnesses: ["pi"], aiRef: "a..b" }, /aiRef/],
		[{ version: 1, harnesses: ["codex"] }, /unknown harness/],
		[{ version: 1, harnesses: [] }, /at least one harness/],
		[{ version: 2, harnesses: ["pi"] }, /version/],
		[{ version: 1, harnesses: ["claude"], skills: ["pi-opt-in"] }, /supports none/],
		[[], /JSON object/],
	];
	for (const [spec, expected] of cases) assert.match(validateSpec(spec, catalog, root).join("\n"), expected, JSON.stringify(spec));
});

test("deepMerge keeps unrelated keys and replaces arrays", () => {
	assert.deepEqual(deepMerge({ a: 1, n: { x: 1, y: 2 }, l: [1] }, { b: 2, n: { y: 3 }, l: [2] }), { a: 1, b: 2, n: { x: 1, y: 3 }, l: [2] });
});

test("packageIdentity ignores versions and refs", () => {
	assert.equal(packageIdentity("npm:@scope/name@1.2.3"), "npm:@scope/name");
	assert.equal(packageIdentity("npm:@scope/name"), "npm:@scope/name");
	assert.equal(packageIdentity("npm:plain@1.0.0"), "npm:plain");
	assert.equal(packageIdentity({ source: "git:github.com/o/r@abc" }), "git:github.com/o/r");
	assert.equal(packageIdentity("/abs/path"), "/abs/path");
});

test("replaceManagedPackages keeps user entries, drops stale ones, and updates pins", () => {
	const packages = ["npm:user-package", "git:github.com/o/old@1", "git:github.com/o/r@1"];
	const next = replaceManagedPackages(packages, ["git:github.com/o/old", "git:github.com/o/r"], ["git:github.com/o/r@2"]);
	assert.deepEqual(next, ["npm:user-package", "git:github.com/o/r@2"]);
});

test("machine-only global skills get their own Claude plugin", () => {
	const root = fixture();
	fs.mkdirSync(path.join(root, "skills", "mac-only"));
	fs.writeFileSync(path.join(root, "skills", "mac-only", "SKILL.md"), skillFile("claude", "global", "local"));
	const catalog = loadCatalog(root);
	const { plugins } = buildMarketplace(catalog, root);
	assert.deepEqual(plugins.find(({ name }) => name === "ai-local").skills, ["./skills/mac-only"]);
	assert.ok(!plugins.find(({ name }) => name === "ai").skills.includes("./skills/mac-only"));
	assert.ok(globalClaudePlugins(catalog, "local").includes("ai-local"));
	assert.ok(!globalClaudePlugins(catalog, "remote").includes("ai-local"));
});

test("listExtensions includes local-only extensions in the pi manifest", () => {
	const root = fixture();
	fs.mkdirSync(path.join(root, "pi", "extensions-local"));
	fs.writeFileSync(path.join(root, "pi", "extensions-local", "guard.ts"), "");
	const { pi } = buildPiManifest(loadCatalog(root), root);
	assert.ok(pi.extensions.includes("./pi/extensions-local/guard.ts"));
	assert.deepEqual(validateSpec({ version: 1, harnesses: ["pi"], extensions: ["guard"] }, loadCatalog(root), root), []);
});

test("piUpstreamEntries gives one entry per repo so pi doesn't drop skills", () => {
	const skills = [
		{ repo: "o/r", path: "skills/a", sha: "1" },
		{ repo: "o/r", path: "skills/b", sha: "1" },
		{ repo: "o/x", path: "skills/c", sha: "2" },
	];
	assert.deepEqual(
		piUpstreamEntries(skills).map(({ source, skills }) => [source, skills]),
		[
			["git:github.com/o/r@1", ["skills/a", "skills/b"]],
			["git:github.com/o/x@2", ["skills/c"]],
		],
	);
});

test("presets combine without duplicates and are validated against the catalog", () => {
	const root = fixture();
	fs.mkdirSync(path.join(root, "presets"));
	fs.writeFileSync(path.join(root, "presets", "one.json"), JSON.stringify({ skills: ["whole", "pi-opt-in"] }));
	fs.writeFileSync(path.join(root, "presets", "two.json"), JSON.stringify({ skills: ["whole", "opt-in-own"] }));
	fs.writeFileSync(path.join(root, "presets", "bad.json"), JSON.stringify({ skills: ["missing"] }));
	const catalog = loadCatalog(root);
	assert.deepEqual(loadPresets(["one", "two"], root), ["whole", "pi-opt-in", "opt-in-own"]);
	assert.deepEqual(validateSpec({ version: 1, harnesses: ["pi"], presets: ["one"] }, catalog, root), []);
	assert.match(validateSpec({ version: 1, harnesses: ["pi"], presets: ["bad"] }, catalog, root).join(), /unknown skill: missing/);
	assert.match(validateSpec({ version: 1, harnesses: ["pi"], presets: ["nope"] }, catalog, root).join(), /unknown preset/);
	assert.match(validateSpec({ version: 1, harnesses: ["pi"], presets: ["../../etc/passwd"] }, catalog, root).join(), /unknown preset/);
});

test("findSpec finds the nearest spec and stops at the repo root", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-harness-spec-"));
	const repo = path.join(root, "repo");
	const nested = path.join(repo, "src", "deep");
	fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
	fs.mkdirSync(nested, { recursive: true });
	fs.writeFileSync(path.join(root, "harness.json"), "{}");
	assert.equal(findSpec(nested, "/nowhere"), undefined);
	fs.writeFileSync(path.join(repo, "harness.json"), "{}");
	assert.equal(findSpec(nested, "/nowhere"), path.join(repo, "harness.json"));
});

test("findSpec doesn't search above the home directory", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-harness-home-"));
	const nested = path.join(home, "work");
	fs.mkdirSync(nested);
	fs.writeFileSync(path.join(path.dirname(home), "harness.json"), "{}");
	try {
		assert.equal(findSpec(nested, home), undefined);
	} finally {
		fs.rmSync(path.join(path.dirname(home), "harness.json"));
	}
});

test("renderCliScript quotes the setup path", () => {
	const script = renderCliScript("/home/o'neil/my ai/setup.mjs");
	assert.match(script, /^#!\/bin\/sh\n/);
	assert.ok(script.includes(`exec node '/home/o'\\''neil/my ai/setup.mjs' "$@"`));
});

test("formatCatalog lists skills and presets", () => {
	const root = fixture();
	fs.mkdirSync(path.join(root, "presets"));
	fs.writeFileSync(path.join(root, "presets", "one.json"), JSON.stringify({ skills: ["whole"] }));
	const output = formatCatalog(loadCatalog(root), ["one"], root);
	assert.match(output, /^SKILL\s+HARNESS\s+SCOPE\s+MACHINE\s+SOURCE/);
	assert.match(output, /whole\s+claude pi\s+opt-in\s+local remote\s+o\/r/);
	assert.match(output, /shared-global\s+claude pi\s+global\s+local remote\s+this repo/);
	assert.match(output, /one: whole/);
});

test("buildInitialSpec produces a valid spec", () => {
	const root = fixture();
	assert.deepEqual(buildInitialSpec(["pi"], []), { version: 1, harnesses: ["pi"] });
	fs.mkdirSync(path.join(root, "presets"));
	fs.writeFileSync(path.join(root, "presets", "one.json"), JSON.stringify({ skills: ["whole"] }));
	assert.deepEqual(validateSpec(buildInitialSpec(["claude", "pi"], ["one"]), loadCatalog(root), root), []);
});
