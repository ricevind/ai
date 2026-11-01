#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MARKETPLACE = "ai";
const HARNESSES = ["claude", "pi"];
const SCOPES = ["global", "opt-in"];
const MACHINES = ["local", "remote"];
const EXTENSION_DIRS = [
	{ dir: "pi/extensions", machines: MACHINES },
	{ dir: "pi/extensions-local", machines: ["local"] },
];
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const ENV_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const SPEC_KEYS = ["version", "aiRef", "harnesses", "global", "skills", "workflows", "extensions", "config", "env", "presets"];
const SPEC_CONFIG = ["instructions", "pi-models", "pi-mcp"];
const PI_PROJECT_CACHE_DIRS = [".pi/git/", ".pi/npm/"];
const PI_HOST_PACKAGES = ["@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"];

class SetupError extends Error {}

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
const piDir = () => process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
const statePath = () =>
	path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "ai-harness", "applied.json");

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);
const toJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function writeFile(file, content) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

export function parseSkillMetadata(text, label) {
	const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
	const block = frontmatter?.match(/^metadata:\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/m)?.[1] ?? "";
	const harness = block.match(/^\s+harness:\s*(.+?)\s*$/m)?.[1];
	const scope = block.match(/^\s+scope:\s*(.+?)\s*$/m)?.[1];
	const machine = block.match(/^\s+machine:\s*(.+?)\s*$/m)?.[1];
	return { harnesses: parseHarnesses(harness, label), scope: parseScope(scope, label), machines: parseMachines(machine, label) };
}

function parseHarnesses(value, label) {
	const harnesses = value?.split(/\s+/).filter(Boolean) ?? [];
	if (harnesses.length === 0 || harnesses.some((harness) => !HARNESSES.includes(harness))) {
		throw new SetupError(`${label}: metadata.harness must list ${HARNESSES.join(" and/or ")}`);
	}
	return harnesses;
}

function parseScope(value, label) {
	if (!SCOPES.includes(value)) throw new SetupError(`${label}: metadata.scope must be one of ${SCOPES.join(", ")}`);
	return value;
}

function parseMachines(value, label) {
	const machines = value?.split(/\s+/).filter(Boolean) ?? [];
	if (machines.length === 0 || machines.some((machine) => !MACHINES.includes(machine))) {
		throw new SetupError(`${label}: metadata.machine must list ${MACHINES.join(" and/or ")}`);
	}
	return machines;
}

export function loadCatalog(root = ROOT) {
	const upstream = readJson(path.join(root, "upstream.json"), { skills: [], piPackages: [] });
	const lock = readJson(path.join(root, "upstream.lock.json"), { skills: {}, npm: {} });
	const own = fs
		.readdirSync(path.join(root, "skills"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== "synced")
		.map((entry) => ({
			name: entry.name,
			origin: "own",
			dir: `skills/${entry.name}`,
			...parseSkillMetadata(fs.readFileSync(path.join(root, "skills", entry.name, "SKILL.md"), "utf8"), entry.name),
		}));
	const external = upstream.skills.map((skill) => {
		if (!REPO_PATTERN.test(skill.repo)) throw new SetupError(`${skill.name}: invalid repo ${skill.repo}`);
		if (!skill.path) throw new SetupError(`${skill.name}: path is required`);
		return {
			name: skill.name,
			origin: "upstream",
			repo: skill.repo,
			path: skill.path,
			sha: lock.skills[skill.name],
			harnesses: parseHarnesses(skill.harness, skill.name),
			scope: parseScope(skill.scope, skill.name),
			machines: parseMachines(skill.machine, skill.name),
		};
	});
	const skills = [...own, ...external];
	for (const harness of HARNESSES) {
		const names = skills.filter((skill) => skill.harnesses.includes(harness)).map((skill) => skill.name);
		const duplicate = names.find((name, index) => names.indexOf(name) !== index);
		if (duplicate) throw new SetupError(`${duplicate}: declared twice for ${harness}`);
	}
	const piPackages = upstream.piPackages.map((item) => ({ npm: item.npm, machines: parseMachines(item.machine, item.npm) }));
	return { skills, piPackages, lock };
}

const listFiles = (root, dir, extension) =>
	fs.existsSync(path.join(root, dir))
		? fs
				.readdirSync(path.join(root, dir))
				.filter((file) => file.endsWith(extension))
				.sort()
				.map((file) => `./${dir}/${file}`)
		: [];

function listExtensions(root) {
	return EXTENSION_DIRS.flatMap(({ dir, machines }) => {
		const absolute = path.join(root, dir);
		if (!fs.existsSync(absolute)) return [];
		return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
			if (entry.isFile() && entry.name.endsWith(".ts")) return [{ name: entry.name.slice(0, -3), file: `${dir}/${entry.name}`, machines }];
			return entry.isDirectory() && fs.existsSync(path.join(absolute, entry.name, "index.ts"))
				? [{ name: entry.name, file: `${dir}/${entry.name}/index.ts`, machines }]
				: [];
		});
	}).sort((left, right) => left.name.localeCompare(right.name));
}

// Claude clones the owner/repo shorthand over SSH, which fails on machines without SSH keys.
const repoUrl = (repo) => `https://github.com/${repo}.git`;

const requireSha = (skill) => {
	if (!skill.sha) throw new SetupError(`${skill.name}: missing from upstream.lock.json, run setup.mjs update`);
	return skill.sha;
};

const isOwnGlobal = (skill, harness) => skill.origin === "own" && skill.scope === "global" && skill.harnesses.includes(harness);
const isUpstreamGlobal = (skill, harness) => skill.origin === "upstream" && skill.scope === "global" && skill.harnesses.includes(harness);

// Claude plugins can't be filtered per machine, so machine-specific skills need their own plugin.
const machineOnly = (catalog, machine) =>
	catalog.skills.filter((skill) => isOwnGlobal(skill, "claude") && skill.machines.length === 1 && skill.machines[0] === machine);

export function globalClaudePlugins(catalog, machine) {
	return [
		"ai",
		...(machineOnly(catalog, machine).length ? [`ai-${machine}`] : []),
		...catalog.skills.filter((skill) => isUpstreamGlobal(skill, "claude") && skill.machines.includes(machine)).map((skill) => skill.name),
	];
}

export function buildMarketplace(catalog, root = ROOT) {
	const skillPaths = (skills) => skills.map((skill) => `./${skill.dir}`).sort();
	const shared = catalog.skills.filter((skill) => isOwnGlobal(skill, "claude") && skill.machines.length === MACHINES.length);
	const machinePlugins = MACHINES.filter((machine) => machineOnly(catalog, machine).length).map((machine) => ({
		name: `ai-${machine}`,
		description: `Global skills for ${machine} machines`,
		source: "./",
		strict: false,
		skills: skillPaths(machineOnly(catalog, machine)),
		commands: [],
	}));
	const upstream = catalog.skills
		.filter((skill) => skill.origin === "upstream" && skill.harnesses.includes("claude"))
		.map((skill) => ({
			name: skill.name,
			source: { source: "git-subdir", url: repoUrl(skill.repo), path: skill.path, sha: requireSha(skill) },
			strict: false,
			skills: ["./"],
		}));
	return {
		name: MARKETPLACE,
		description: "Personal Claude Code skills and commands. Generated by setup.mjs.",
		owner: { name: "ricevind" },
		plugins: [
			{
				name: "ai",
				description: "Global skills and commands",
				source: "./",
				strict: false,
				skills: skillPaths(shared),
				commands: listFiles(root, "commands", ".md"),
			},
			...machinePlugins,
			...upstream,
		],
	};
}

export function buildPiManifest(catalog, root = ROOT) {
	return {
		name: "ai-harness",
		private: true,
		description: "Personal pi extensions, skills, and prompts. Generated by setup.mjs.",
		peerDependencies: Object.fromEntries(PI_HOST_PACKAGES.map((name) => [name, "*"])),
		pi: {
			extensions: listExtensions(root).map(({ file }) => `./${file}`),
			skills: catalog.skills
				.filter((skill) => isOwnGlobal(skill, "pi"))
				.map((skill) => `./${skill.dir}`)
				.sort(),
			prompts: [...listFiles(root, "commands", ".md"), ...listFiles(root, "pi/prompts", ".md")],
		},
	};
}

const generatedFiles = (catalog, root = ROOT) => [
	[path.join(root, ".claude-plugin", "marketplace.json"), toJson(buildMarketplace(catalog, root))],
	[path.join(root, "package.json"), toJson(buildPiManifest(catalog, root))],
];

export function loadPresets(names, root = ROOT) {
	return [
		...new Set(
			names.flatMap((name) => {
				const file = path.join(root, "presets", `${name}.json`);
				if (typeof name !== "string" || !NAME_PATTERN.test(name) || !fs.existsSync(file)) throw new SetupError(`unknown preset: ${name}`);
				const { skills } = JSON.parse(fs.readFileSync(file, "utf8"));
				if (!Array.isArray(skills)) throw new SetupError(`preset ${name}: skills must be a list`);
				return skills;
			}),
		),
	];
}

const withPresets = (spec, root = ROOT) => ({ ...spec, skills: [...new Set([...loadPresets(spec.presets ?? [], root), ...(spec.skills ?? [])])] });

export function validateSpec(spec, catalog, root = ROOT) {
	const errors = [];
	if (typeof spec !== "object" || spec === null || Array.isArray(spec)) return ["spec must be a JSON object"];
	for (const key of Object.keys(spec)) if (!SPEC_KEYS.includes(key)) errors.push(`unknown field: ${key}`);
	if (spec.version !== 1) errors.push("version must be 1");
	if (spec.aiRef !== undefined && (typeof spec.aiRef !== "string" || !REF_PATTERN.test(spec.aiRef) || spec.aiRef.includes(".."))) {
		errors.push("aiRef must be a branch, tag, or commit");
	}
	if (spec.global !== undefined && typeof spec.global !== "boolean") errors.push("global must be a boolean");

	const stringList = (key) => {
		if (spec[key] === undefined) return [];
		if (!Array.isArray(spec[key]) || spec[key].some((item) => typeof item !== "string")) {
			errors.push(`${key} must be a list of strings`);
			return [];
		}
		return spec[key];
	};
	const harnesses = stringList("harnesses");
	if (harnesses.length === 0) errors.push("harnesses must list at least one harness");
	for (const harness of harnesses) if (!HARNESSES.includes(harness)) errors.push(`unknown harness: ${harness}`);

	for (const name of stringList("skills")) {
		const matches = catalog.skills.filter((skill) => skill.name === name);
		if (!NAME_PATTERN.test(name) || matches.length === 0) errors.push(`unknown skill: ${name}`);
		else if (!matches.some((skill) => skill.harnesses.some((harness) => harnesses.includes(harness)))) {
			errors.push(`skill ${name} supports none of: ${harnesses.join(", ")}`);
		}
	}
	try {
		for (const name of loadPresets(stringList("presets"), root)) {
			if (!catalog.skills.some((skill) => skill.name === name)) errors.push(`preset lists unknown skill: ${name}`);
		}
	} catch (error) {
		if (!(error instanceof SetupError)) throw error;
		errors.push(error.message);
	}
	const workflows = [...listFiles(root, "commands", ".md"), ...listFiles(root, "pi/prompts", ".md")];
	for (const name of stringList("workflows")) {
		if (!workflows.some((file) => path.basename(file, ".md") === name)) errors.push(`unknown workflow: ${name}`);
	}
	const extensions = listExtensions(root).map(({ name }) => name);
	for (const name of stringList("extensions")) if (!extensions.includes(name)) errors.push(`unknown extension: ${name}`);
	for (const name of stringList("config")) if (!SPEC_CONFIG.includes(name)) errors.push(`unknown config: ${name}`);
	for (const name of stringList("env")) if (!ENV_PATTERN.test(name)) errors.push(`invalid env name: ${name}`);
	return errors;
}

export function deepMerge(target, source) {
	if (typeof target !== "object" || target === null || Array.isArray(target)) return source;
	if (typeof source !== "object" || source === null || Array.isArray(source)) return source;
	const merged = { ...target };
	for (const [key, value] of Object.entries(source)) merged[key] = key in target ? deepMerge(target[key], value) : value;
	return merged;
}

export function packageIdentity(entry) {
	const source = typeof entry === "string" ? entry : entry.source;
	if (source.startsWith("npm:")) return source.replace(/(?!^npm:@)(@[^@/]+)$/, "");
	if (source.startsWith("git:")) return source.replace(/@[^@/]+$/, "");
	return path.resolve(source);
}

export function replaceManagedPackages(packages, previousIds, nextEntries) {
	const replaced = new Set([...previousIds, ...nextEntries.map(packageIdentity)]);
	return [...packages.filter((entry) => !replaced.has(packageIdentity(entry))), ...nextEntries];
}

// Pi identifies a git package by its repo, so all skills from one repo must share one entry.
export function piUpstreamEntries(skills) {
	const entries = new Map();
	for (const skill of skills) {
		const source = `git:github.com/${skill.repo}@${requireSha(skill)}`;
		const entry = entries.get(source) ?? { source, extensions: [], prompts: [], themes: [], skills: [] };
		entry.skills.push(skill.path);
		entries.set(source, entry);
	}
	return [...entries.values()];
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.error) throw new SetupError(`${command}: ${result.error.message}`);
	if (result.status !== 0) {
		throw new SetupError(`${command} ${args.join(" ")} failed:\n${`${result.stdout ?? ""}${result.stderr ?? ""}`.trim()}`);
	}
	return result.stdout;
}

const hasCommand = (command) => spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;

function requireCommands(harnesses) {
	for (const command of ["git", ...harnesses]) {
		if (!hasCommand(command)) throw new SetupError(`${command} is required but was not found on PATH`);
	}
}

function configItems(name) {
	const items = {
		instructions: [
			{ harness: "claude", from: "config/instructions.md", to: path.join(claudeDir(), "CLAUDE.md") },
			{ harness: "pi", from: "config/instructions.md", to: path.join(piDir(), "AGENTS.md") },
		],
		"claude-settings": [{ harness: "claude", from: "config/claude/settings.json", to: path.join(claudeDir(), "settings.json"), merge: true }],
		"pi-settings": [{ harness: "pi", from: "config/pi/settings.json", to: path.join(piDir(), "settings.json"), merge: true }],
		"pi-models": [{ harness: "pi", from: "config/pi/models.json", to: path.join(piDir(), "models.json") }],
		"pi-mcp": [{ harness: "pi", from: "config/pi/mcp.json", to: path.join(piDir(), "mcp.json") }],
		"pi-voice": [{ harness: "pi", from: "config/pi/pi-voice.json", to: path.join(piDir(), "pi-voice.json"), merge: true }],
	};
	return items[name];
}

async function confirmOverwrite(target, content, force) {
	if (force) return;
	const staged = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ai-harness-")), path.basename(target));
	fs.writeFileSync(staged, content);
	const diff = spawnSync("git", ["--no-pager", "diff", "--no-index", "--", target, staged], { encoding: "utf8" }).stdout;
	if (!process.stdin.isTTY) throw new SetupError(`${target} has local changes, rerun with --force:\n${diff}`);
	console.log(diff);
	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await prompt.question(`Overwrite ${target}? [y/N] `);
	prompt.close();
	if (answer.trim().toLowerCase() !== "y") throw new SetupError(`Kept ${target}, nothing further was applied`);
}

async function applyConfig(names, harnesses, force) {
	for (const name of names) {
		for (const item of configItems(name).filter(({ harness }) => harnesses.includes(harness))) {
			const source = fs.readFileSync(path.join(ROOT, item.from), "utf8");
			const existing = fs.existsSync(item.to) ? fs.readFileSync(item.to, "utf8") : undefined;
			const next = item.merge ? toJson(deepMerge(existing ? JSON.parse(existing) : {}, JSON.parse(source))) : source;
			if (existing === next) continue;
			if (existing !== undefined && !item.merge) await confirmOverwrite(item.to, next, force);
			writeFile(item.to, next);
			console.log(`config: wrote ${item.to}`);
		}
	}
}

const claudePlugins = (cwd) => JSON.parse(run("claude", ["plugin", "list", "--json"], cwd ? { cwd } : {}));

function ensureMarketplace() {
	const marketplaces = JSON.parse(run("claude", ["plugin", "marketplace", "list", "--json"]));
	if (marketplaces.some(({ name }) => name === MARKETPLACE)) run("claude", ["plugin", "marketplace", "update", MARKETPLACE]);
	else run("claude", ["plugin", "marketplace", "add", ROOT]);
}

function ensurePlugin(name, scope, cwd) {
	const id = `${name}@${MARKETPLACE}`;
	const installed = claudePlugins(cwd).some((plugin) => plugin.id === id && plugin.scope === scope && plugin.enabled);
	run("claude", ["plugin", installed ? "update" : "install", id, "--scope", scope], cwd ? { cwd } : {});
}

function removePlugin(name, scope, cwd) {
	run("claude", ["plugin", "uninstall", `${name}@${MARKETPLACE}`, "--scope", scope], cwd ? { cwd } : {});
}

const readProfiles = () => readJson(path.join(ROOT, "config", "profiles.json"), {});
const currentMachine = (state) => readProfiles()[state.machine?.profile]?.machine ?? "remote";

function aiPackageEntry(catalog, machine, { global = true, extensions, workflows } = {}) {
	const manifest = buildPiManifest(catalog);
	const allowed = listExtensions(ROOT).filter((extension) => extension.machines.includes(machine));
	const entry = {
		source: ROOT,
		skills: global ? catalog.skills.filter((skill) => isOwnGlobal(skill, "pi") && skill.machines.includes(machine)).map((skill) => skill.dir).sort() : [],
		extensions: allowed.filter(({ name }) => !extensions || extensions.includes(name)).map(({ file }) => file),
	};
	if (!workflows) return entry;
	return { ...entry, prompts: manifest.pi.prompts.map((file) => file.slice(2)).filter((file) => workflows.includes(path.basename(file, ".md"))) };
}

function globalPiEntries(catalog, machine, presetSkills) {
	const upstream = piUpstreamEntries([...catalog.skills.filter((skill) => isUpstreamGlobal(skill, "pi") && skill.machines.includes(machine)), ...presetSkills]);
	const npm = catalog.piPackages
		.filter((item) => item.machines.includes(machine))
		.map((item) => {
			const version = catalog.lock.npm[item.npm];
			if (!version) throw new SetupError(`${item.npm}: missing from upstream.lock.json, run setup.mjs update`);
			return `npm:${item.npm}@${version}`;
		});
	return [aiPackageEntry(catalog, machine), ...upstream, ...npm];
}

async function install({ profile, harnesses, force, presets = [] }) {
	const profiles = readProfiles();
	if (!profiles[profile]) throw new SetupError(`Unknown profile: ${profile}`);
	requireCommands(harnesses);
	const catalog = loadCatalog();
	const state = readJson(statePath(), { projects: {} });
	const { machine } = profiles[profile];
	const presetSkills = loadPresets(presets);
	const unknown = presetSkills.filter((name) => !catalog.skills.some((skill) => skill.name === name));
	if (unknown.length) throw new SetupError(`Presets list unknown skills: ${unknown.join(", ")}`);
	const fromPresets = (harness) => selectForHarness({ skills: presetSkills }, catalog, harness, machine);
	const ofOrigin = (skills, origin) => skills.filter((skill) => skill.origin === origin);
	await applyConfig(profiles[profile].config, harnesses, force);

	if (harnesses.includes("claude")) {
		ensureMarketplace();
		const selected = fromPresets("claude");
		const copies = ofOrigin(selected, "own").map((skill) => skill.name);
		const wanted = [...globalClaudePlugins(catalog, machine), ...ofOrigin(selected, "upstream").map((skill) => skill.name)];
		for (const name of (state.machine?.claudePlugins ?? []).filter((name) => !wanted.includes(name))) removePlugin(name, "user");
		for (const name of wanted) ensurePlugin(name, "user");
		syncCopiedSkills(claudeDir(), "skills", copies, state.machine?.claudeCopies ?? []);
		state.machine = { ...state.machine, claudePlugins: wanted, claudeCopies: copies };
	}
	if (harnesses.includes("pi")) {
		const settingsPath = path.join(piDir(), "settings.json");
		const settings = readJson(settingsPath, {});
		const selected = fromPresets("pi");
		const copies = ofOrigin(selected, "own").map((skill) => skill.name);
		const entries = globalPiEntries(catalog, machine, ofOrigin(selected, "upstream"));
		syncCopiedSkills(piDir(), "skills", copies, state.machine?.piCopies ?? []);
		settings.packages = replaceManagedPackages(settings.packages ?? [], state.machine?.piPackages ?? [], entries);
		writeFile(settingsPath, toJson(settings));
		run("pi", ["update", "--extensions"], { cwd: os.homedir() });
		state.machine = { ...state.machine, piPackages: entries.map(packageIdentity), piCopies: copies };
	}
	state.machine = { ...state.machine, profile, harnesses, presets };
	writeFile(statePath(), toJson(state));
	console.log(`Installed ${profile} profile for ${harnesses.join(", ")}`);
}

function excludeFromGit(project, entries) {
	const inside = spawnSync("git", ["-C", project, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
	if (inside.stdout?.trim() !== "true") return;
	const excludePath = path.resolve(project, run("git", ["-C", project, "rev-parse", "--git-path", "info/exclude"]).trim());
	const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
	const lines = current.split("\n");
	const missing = entries.filter((entry) => !lines.includes(entry));
	if (missing.length) writeFile(excludePath, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
}

function isTracked(project, file) {
	return spawnSync("git", ["-C", project, "ls-files", "--error-unmatch", file], { stdio: "ignore" }).status === 0;
}

function assertPlainDirectoryChain(project, relative) {
	let current = project;
	for (const segment of relative.split("/")) {
		current = path.join(current, segment);
		if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
			throw new SetupError(`Refusing to write through symlink: ${current}`);
		}
	}
}

function syncCopiedSkills(project, base, wanted, previous) {
	for (const name of previous.filter((name) => !wanted.includes(name))) {
		assertPlainDirectoryChain(project, `${base}/${name}`);
		fs.rmSync(path.join(project, base, name), { recursive: true, force: true });
	}
	for (const name of wanted) {
		const relative = `${base}/${name}`;
		assertPlainDirectoryChain(project, relative);
		const target = path.join(project, relative);
		if (fs.existsSync(target) && !previous.includes(name)) throw new SetupError(`${target} already exists and wasn't created by setup`);
		fs.rmSync(target, { recursive: true, force: true });
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.cpSync(path.join(ROOT, "skills", name), target, { recursive: true });
	}
}

function selectForHarness(spec, catalog, harness, machine) {
	const useGlobal = spec.global !== false;
	return (spec.skills ?? [])
		.map((name) => catalog.skills.find((skill) => skill.name === name && skill.harnesses.includes(harness)))
		.filter((skill) => skill && skill.machines.includes(machine) && !(useGlobal && skill.scope === "global"));
}

function ensureAiRef(ref, checkout) {
	if (ref === undefined) return;
	if (typeof ref !== "string" || !REF_PATTERN.test(ref) || ref.includes("..")) throw new SetupError("aiRef must be a branch, tag, or commit");
	const resolved = spawnSync("git", ["-C", ROOT, "rev-parse", "--verify", `${ref}^{commit}`], { encoding: "utf8" });
	if (checkout) {
		run("git", ["-C", ROOT, "fetch", "--tags", "origin"]);
		run("git", ["-C", ROOT, "checkout", "--detach", ref]);
		return;
	}
	const contained = resolved.status === 0 && spawnSync("git", ["-C", ROOT, "merge-base", "--is-ancestor", resolved.stdout.trim(), "HEAD"]).status === 0;
	if (!contained) throw new SetupError(`This ai clone doesn't contain ${ref}. Update it, or pass --checkout to switch to that version.`);
}

async function apply({ specPath, checkout, force }) {
	const rawSpec = JSON.parse(fs.readFileSync(specPath, "utf8"));
	ensureAiRef(rawSpec.aiRef, checkout);
	if (checkout && rawSpec.aiRef) {
		const relaunch = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "apply", "--spec", specPath, ...(force ? ["--force"] : [])], { stdio: "inherit" });
		process.exitCode = relaunch.status ?? 1;
		return;
	}
	const catalog = loadCatalog();
	const errors = validateSpec(rawSpec, catalog);
	if (errors.length) throw new SetupError(`Invalid ${specPath}:\n- ${errors.join("\n- ")}`);
	const spec = withPresets(rawSpec);
	const missingEnv = (spec.env ?? []).filter((name) => !process.env[name]);
	if (missingEnv.length) throw new SetupError(`Missing environment variables: ${missingEnv.join(", ")}`);
	requireCommands(spec.harnesses);

	const project = path.dirname(path.resolve(specPath));
	const state = readJson(statePath(), { projects: {} });
	if (spec.global !== false && !state.machine) await install({ profile: "sandbox", harnesses: spec.harnesses, force });
	else if (spec.harnesses.includes("claude")) ensureMarketplace();
	await applyConfig(spec.config ?? [], spec.harnesses, force);

	const latest = readJson(statePath(), { projects: {} });
	const machine = currentMachine(latest);
	for (const name of spec.skills ?? []) {
		if (!catalog.skills.some((skill) => skill.name === name && skill.machines.includes(machine))) console.log(`Skipped ${name}: not available on ${machine} machines`);
	}
	const previous = latest.projects[project] ?? {};
	const next = {};
	const excludes = [];

	if (spec.harnesses.includes("claude")) {
		const selected = selectForHarness(spec, catalog, "claude", machine);
		const plugins = selected.filter((skill) => skill.origin === "upstream").map((skill) => skill.name);
		const copies = selected.filter((skill) => skill.origin === "own").map((skill) => skill.name);
		for (const name of (previous.claudePlugins ?? []).filter((name) => !plugins.includes(name))) removePlugin(name, "local", project);
		for (const name of plugins) ensurePlugin(name, "local", project);
		syncCopiedSkills(project, ".claude/skills", copies, previous.claudeCopies ?? []);
		next.claudePlugins = plugins;
		next.claudeCopies = copies;
		excludes.push(".claude/settings.local.json", ...copies.map((name) => `.claude/skills/${name}`));
	}
	if (spec.harnesses.includes("pi")) {
		const selected = selectForHarness(spec, catalog, "pi", machine);
		const copies = selected.filter((skill) => skill.origin === "own").map((skill) => skill.name);
		syncCopiedSkills(project, ".pi/skills", copies, previous.piCopies ?? []);
		const entries = piUpstreamEntries(selected.filter((skill) => skill.origin === "upstream"));
		if (spec.extensions || spec.workflows) {
			entries.push(aiPackageEntry(catalog, machine, { global: spec.global !== false, extensions: spec.extensions ?? [], workflows: spec.workflows ?? [] }));
		}
		const settingsPath = path.join(project, ".pi", "settings.json");
		assertPlainDirectoryChain(project, ".pi/settings.json");
		const settings = readJson(settingsPath, {});
		const packages = replaceManagedPackages(settings.packages ?? [], previous.piPackages ?? [], entries);
		if (packages.length || settings.packages) {
			settings.packages = packages;
			writeFile(settingsPath, toJson(settings));
		}
		next.piCopies = copies;
		next.piPackages = entries.map(packageIdentity);
		excludes.push(...PI_PROJECT_CACHE_DIRS, ...copies.map((name) => `.pi/skills/${name}`));
		if (isTracked(project, ".pi/settings.json")) console.warn("warning: .pi/settings.json is tracked by git, generated package entries will show as changes");
		else excludes.push(".pi/settings.json");
	}
	excludeFromGit(project, excludes);
	latest.projects[project] = next;
	writeFile(statePath(), toJson(latest));
	console.log(`Applied ${specPath}`);
}

function piCommands(cwd, approve) {
	return new Promise((resolve, reject) => {
		const child = spawn("pi", ["--mode", "rpc", "--offline", "--no-session", approve ? "--approve" : "--no-approve"], { cwd, stdio: ["pipe", "pipe", "ignore"] });
		const timer = setTimeout(() => {
			child.kill();
			reject(new SetupError("Timed out reading pi commands"));
		}, 60_000);
		let buffer = "";
		child.stdout.on("data", (chunk) => {
			buffer += chunk;
			for (const line of buffer.split("\n").slice(0, -1)) {
				let message;
				try {
					message = JSON.parse(line);
				} catch {
					continue;
				}
				if (message.command !== "get_commands") continue;
				clearTimeout(timer);
				child.kill();
				resolve(message.data.commands);
			}
			buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
		});
		child.on("error", reject);
		child.stdin.write(`${JSON.stringify({ id: "1", type: "get_commands" })}\n`);
	});
}

async function check({ specPath, harnesses: requested, approve, presets = [] }) {
	const catalog = loadCatalog();
	const problems = [];
	for (const [file, expected] of generatedFiles(catalog)) {
		if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expected) problems.push(`${file} is out of date, run setup.mjs generate`);
	}
	const rawSpec = specPath ? JSON.parse(fs.readFileSync(specPath, "utf8")) : undefined;
	const specErrors = rawSpec ? validateSpec(rawSpec, catalog) : [];
	if (specErrors.length) throw new SetupError(`Check failed:\n- ${specErrors.map((error) => `spec: ${error}`).join("\n- ")}`);
	const spec = rawSpec && withPresets(rawSpec);
	const presetSkills = loadPresets(presets);
	const project = specPath ? path.dirname(path.resolve(specPath)) : undefined;
	const state = readJson(statePath(), { projects: {} });
	const harnesses = spec?.harnesses ?? requested;
	const useGlobal = spec?.global !== false;
	const machine = currentMachine(state);

	if (harnesses.includes("claude")) {
		const plugins = claudePlugins(project);
		const expectEnabled = (name) => {
			const plugin = plugins.find(({ id }) => id === `${name}@${MARKETPLACE}`);
			if (!plugin?.enabled || plugin.errors?.length) problems.push(`claude: ${name} is not loaded${plugin?.errors?.length ? `: ${JSON.stringify(plugin.errors)}` : ""}`);
		};
		if (useGlobal) {
			for (const name of globalClaudePlugins(catalog, machine)) expectEnabled(name);
		}
		for (const skill of selectForHarness({ skills: presetSkills }, catalog, "claude", machine)) {
			if (skill.origin === "upstream") expectEnabled(skill.name);
			else if (!fs.existsSync(path.join(claudeDir(), "skills", skill.name, "SKILL.md"))) problems.push(`claude: ${skill.name} is missing from ${claudeDir()}/skills`);
		}
		if (spec) {
			for (const skill of selectForHarness(spec, catalog, "claude", machine)) {
				if (skill.origin === "upstream") expectEnabled(skill.name);
				else if (!fs.existsSync(path.join(project, ".claude", "skills", skill.name, "SKILL.md"))) problems.push(`claude: ${skill.name} is missing from .claude/skills`);
			}
		}
	}
	if (harnesses.includes("pi")) {
		const commands = await piCommands(project ?? os.homedir(), approve);
		const loaded = new Set(commands.filter(({ source }) => source === "skill").map(({ name }) => name.replace(/^skill:/, "")));
		const expectLoaded = (name, where) => {
			if (!loaded.has(name)) problems.push(`pi: ${name} is not loaded${where}`);
		};
		if (useGlobal) {
			for (const skill of catalog.skills.filter((skill) => skill.scope === "global" && skill.harnesses.includes("pi") && skill.machines.includes(machine))) expectLoaded(skill.name, "");
			for (const skill of catalog.skills.filter((skill) => skill.scope === "global" && skill.harnesses.includes("pi") && !skill.machines.includes(machine))) {
				if (loaded.has(skill.name)) problems.push(`pi: ${skill.name} should not load on ${machine} machines`);
			}
		}
		for (const skill of selectForHarness({ skills: presetSkills }, catalog, "pi", machine)) expectLoaded(skill.name, "");
		if (spec) {
			for (const skill of selectForHarness(spec, catalog, "pi", machine)) {
				if (skill.origin === "own" && !fs.existsSync(path.join(project, ".pi", "skills", skill.name, "SKILL.md"))) {
					problems.push(`pi: ${skill.name} is missing from .pi/skills`);
				} else if (approve && skill.origin === "own") {
					expectLoaded(skill.name, " (with --approve)");
				} else if (skill.origin === "upstream" && !(state.projects?.[project]?.piPackages ?? []).includes(packageIdentity(piUpstreamEntries([skill])[0]))) {
					problems.push(`pi: ${skill.name} is missing from .pi/settings.json`);
				}
			}
		}
	}
	if (problems.length) throw new SetupError(`Check failed:\n- ${problems.join("\n- ")}`);
	console.log("Check passed");
}

function generate() {
	for (const [file, content] of generatedFiles(loadCatalog())) writeFile(file, content);
	console.log("Generated marketplace.json and package.json");
}

function update() {
	const upstream = readJson(path.join(ROOT, "upstream.json"), { skills: [], piPackages: [] });
	const skills = {};
	const heads = new Map();
	for (const skill of upstream.skills) {
		if (!REPO_PATTERN.test(skill.repo)) throw new SetupError(`${skill.name}: invalid repo ${skill.repo}`);
		if (!heads.has(skill.repo)) heads.set(skill.repo, execFileSync("git", ["ls-remote", repoUrl(skill.repo), "HEAD"], { encoding: "utf8" }).split(/\s/)[0]);
		skills[skill.name] = heads.get(skill.repo);
	}
	const npm = {};
	for (const item of upstream.piPackages) npm[item.npm] = run("npm", ["view", item.npm, "version"]).trim();
	writeFile(path.join(ROOT, "upstream.lock.json"), toJson({ skills, npm }));
	generate();
	console.log("Review and commit the changes, then run setup.mjs install");
}

function parseArgs(argv) {
	const options = { positional: [] };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--spec") options.specPath = argv[++index];
		else if (arg === "--profile") options.profile = argv[++index];
		else if (arg === "--harness") options.harnesses = argv[++index]?.split(",");
		else if (arg === "--preset") options.presets = argv[++index]?.split(",");
		else if (arg === "--force") options.force = true;
		else if (arg === "--checkout") options.checkout = true;
		else if (arg === "--approve") options.approve = true;
		else options.positional.push(arg);
	}
	return options;
}

const USAGE = `Usage:
  setup.mjs install [--profile workstation|sandbox] [--preset name,name] [--harness claude,pi] [--force]
  setup.mjs apply --spec <repo>/harness.json [--checkout] [--force]
  setup.mjs check [--spec <repo>/harness.json] [--preset name,name] [--harness claude,pi] [--approve]
  setup.mjs update
  setup.mjs generate`;

async function main() {
	const { positional, ...options } = parseArgs(process.argv.slice(2));
	const harnesses = options.harnesses ?? HARNESSES.filter(hasCommand);
	const invalid = harnesses.filter((harness) => !HARNESSES.includes(harness));
	if (invalid.length) throw new SetupError(`Unknown harness: ${invalid.join(", ")}`);
	switch (positional[0]) {
		case "install":
			return install({ profile: options.profile ?? "sandbox", harnesses, force: options.force, presets: options.presets });
		case "apply":
			if (!options.specPath) throw new SetupError(USAGE);
			return apply(options);
		case "check":
			return check({ ...options, harnesses });
		case "update":
			return update();
		case "generate":
			return generate();
		default:
			throw new SetupError(USAGE);
	}
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof SetupError ? error.message : error);
		process.exitCode = 1;
	});
}
