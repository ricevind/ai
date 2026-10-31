import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type BuildSystemPromptOptions,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const marker = "<!-- pi:available-tools -->";

function buildToolsList(options: BuildSystemPromptOptions): string {
	return (options.selectedTools ?? [])
		.filter((name) => !!options.toolSnippets?.[name])
		.map((name) => `- ${name}: ${options.toolSnippets?.[name]}`)
		.join("\n");
}

// Read the repo's own .pi/SYSTEM.md the same way pi loads it (BOM stripped,
// otherwise verbatim).
function readProjectSystemMd(cwd: string): string | undefined {
	const path = join(cwd, CONFIG_DIR_NAME, "SYSTEM.md");
	if (!existsSync(path)) return undefined;
	try {
		return readFileSync(path, "utf-8").replace(/^\uFEFF/, "");
	} catch {
		return undefined;
	}
}

// The custom machinery only ever applies when pi itself loaded the repo's own
// .pi/SYSTEM.md as the custom prompt. Everything else (no SYSTEM.md, explicit
// --system-prompt input) is left to pi's native stock machinery, so the stock
// prompt always tracks pi's built-in builder on upgrades.
function isProjectSystemPrompt(customPrompt: string | undefined, cwd: string): boolean {
	if (!customPrompt) return false;
	return customPrompt === readProjectSystemMd(cwd);
}

// Decide what the system prompt for this turn should look like.
// Returns undefined to leave pi's prompt untouched.
function resolveTurnPrompt(prompt: string, options: BuildSystemPromptOptions): string | undefined {
	// Only fill the placeholder when pi loaded this repo's .pi/SYSTEM.md.
	if (!isProjectSystemPrompt(options.customPrompt, options.cwd)) return undefined;
	// Nothing to fill if the SYSTEM.md has no placeholder.
	if (!prompt.includes(marker)) return undefined;
	return prompt.replace(marker, buildToolsList(options) || "(none)");
}

export default function (pi: ExtensionAPI) {
	// On every turn: fill the "Available tools" placeholder in the repo's
	// .pi/SYSTEM.md from the live tool registry. Repos without a SYSTEM.md
	// keep pi's stock system prompt untouched.
	pi.on("before_agent_start", async (event) => {
		const next = resolveTurnPrompt(event.systemPrompt, event.systemPromptOptions);
		if (next === undefined) return;
		return { systemPrompt: next };
	});

	pi.registerCommand("system-prompt", {
		description:
			"Dump the current system prompt to a temp file (/system-prompt print to print it inline)",
		handler: async (args, ctx) => {
			const options = ctx.getSystemPromptOptions?.() ?? { cwd: process.cwd() };
			const base = ctx.getSystemPrompt() ?? "";
			const prompt = resolveTurnPrompt(base, options) ?? base;

			if (args.trim() === "print") {
				ctx.ui.notify(prompt, "info");
				return;
			}

			const outPath = join(tmpdir(), `pi-system-prompt-${Date.now()}.md`);
			writeFileSync(outPath, prompt, "utf-8");

			const lines = prompt.split("\n").length;
			const contextPaths = (options.contextFiles ?? [])
				.map((f) => f.path)
				.join(", ");

			ctx.ui.notify(
				[
					`System prompt: ${prompt.length} chars / ${lines} lines`,
					`Saved to: ${outPath}`,
					`Context files: ${contextPaths || "(none)"}`,
				].join("\n"),
				"info",
			);
		},
	});
}