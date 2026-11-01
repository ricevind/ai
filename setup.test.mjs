import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	buildMarketplace,
	buildPiManifest,
	globalClaudePlugins,
	deepMerge,
	loadCatalog,
	packageIdentity,
	parseSkillMetadata,
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
				{ name: "whole", repo: "o/w", harness: "claude pi", scope: "opt-in", machine: "local remote" },
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
	fs.writeFileSync(path.join(root, "upstream.json"), JSON.stringify({ skills: [{ name: "pi-global", repo: "o/r", harness: "claude", scope: "global", machine: "local remote" }], piPackages: [] }));
	assert.equal(loadCatalog(root).skills.filter((skill) => skill.name === "pi-global").length, 2);
	fs.writeFileSync(path.join(root, "upstream.json"), JSON.stringify({ skills: [{ name: "pi-global", repo: "o/r", harness: "pi", scope: "global", machine: "local remote" }], piPackages: [] }));
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
	assert.deepEqual(whole, { name: "whole", source: { source: "url", url: "https://github.com/o/w.git", sha: "b".repeat(40) } });
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
