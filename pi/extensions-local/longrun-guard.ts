/**
 * Long-Run Guard
 *
 * Blocks bash calls that would occupy the tool for an open-ended time — dev
 * servers, watchers, log tails, and anything that detaches with `&`, `nohup`,
 * `disown`, or `setsid` — and redirects the model to the `longrun` skill, which
 * runs the command in a persistent Herdr pane instead.
 *
 * Why this exists:
 *   - Pi's bash tool blocks the turn until the command exits, and cancelling
 *     kills the whole process tree.
 *   - `nohup ... &` "works", but the process is orphaned and reparented to
 *     PID 1, so nothing tracks it, its output is lost, and stopping it means
 *     hunting PIDs by hand.
 *   - A Herdr pane gives a real terminal that outlives the turn, with
 *     `pane read` / `pane wait-output` / `pane run` as the control surface.
 *
 * Scope:
 *   - Active only when this Pi runs inside Herdr (HERDR_ENV=1). Outside Herdr
 *     the remedy does not exist, so blocking would only remove a working
 *     escape hatch. Use the bash tool's own `timeout` there.
 *   - `herdr ...` invocations are exempt: the sanctioned path wraps the long
 *     command inside a `pane run` argument, which would otherwise match.
 *   - A command containing the literal marker `HERDR_LONGRUN_OK=1` is exempt,
 *     so the skill can hand a command through unchanged.
 *
 * This is a speed bump, not a security control: an agent that wants to bypass
 * it can. The goal is to make the correct path the obvious one, not to make
 * the wrong one impossible.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Marker that exempts a command, used by the `longrun` skill. */
export const BYPASS_MARKER = "HERDR_LONGRUN_OK=1";

/**
 * A single `&` used as a shell background operator.
 * Excludes `&&`, `&>`, and the `&` in `2>&1`.
 */
export const RE_BACKGROUND_AMP = /(?<![&>])&(?![&>])/;

export interface Rule {
	/** Short identifier, surfaced in the block reason. */
	id: string;
	/** Human-readable explanation of what matched. */
	why: string;
	test: (cmd: string) => boolean;
}

const has = (re: RegExp) => (cmd: string) => re.test(cmd);

/** `docker compose up` only counts when it is not detached. */
const composeUpForeground = (cmd: string) =>
	/\bdocker[-\s]compose\s+up\b/.test(cmd) && !/\s(-d|--detach)\b/.test(cmd);

export const RULES: Rule[] = [
	// --- detachment: the pattern that produces orphaned PID-1 processes ---
	{ id: "ampersand", why: "uses a bare `&` to background the command", test: has(RE_BACKGROUND_AMP) },
	{ id: "nohup", why: "detaches with `nohup`", test: has(/\bnohup\b/) },
	{ id: "disown", why: "detaches with `disown`", test: has(/\bdisown\b/) },
	{ id: "setsid", why: "detaches with `setsid`", test: has(/\bsetsid\b/) },

	// --- JS/TS toolchain servers and watchers ---
	{
		id: "npm-serve",
		why: "starts a package dev/start/serve script",
		test: has(/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch)\b/),
	},
	{ id: "vite", why: "starts a Vite server", test: (c) => /\bvite\b/.test(c) && !/\bvite\s+build\b/.test(c) },
	{ id: "next", why: "starts a Next.js dev server", test: has(/\bnext\s+dev\b/) },
	{ id: "nuxt", why: "starts a Nuxt dev server", test: has(/\bnuxt\s+dev\b/) },
	{ id: "astro", why: "starts an Astro dev server", test: has(/\bastro\s+dev\b/) },
	{ id: "nodemon", why: "runs a file watcher", test: has(/\bnodemon\b/) },

	// --- Python / PHP ---
	{ id: "http-server", why: "starts a static file server", test: has(/\bpython3?\s+-m\s+http\.server\b/) },
	{ id: "uvicorn", why: "starts an ASGI server", test: has(/\b(uvicorn|gunicorn)\b/) },
	{ id: "flask", why: "starts a Flask server", test: has(/\bflask\s+run\b/) },
	{ id: "runserver", why: "starts a Django dev server", test: has(/\brunserver\b/) },
	{ id: "php-s", why: "starts a PHP server", test: has(/\bphp\s+-S\b/) },
	{ id: "jupyter", why: "starts a Jupyter server", test: has(/\bjupyter\s+(notebook|lab)\b/) },
	{ id: "streamlit", why: "starts a Streamlit app", test: has(/\bstreamlit\s+run\b/) },

	// --- generic servers / watchers ---
	{ id: "npx-serve", why: "starts a static server", test: has(/\bnpx\s+(--yes\s+)?(serve|http-server)\b/) },
	{ id: "watch", why: "runs a watch loop", test: has(/\bwatch\s+-n\b|\bwatch\s+"|\bcargo\s+watch\b/) },
	{ id: "test-watch", why: "runs tests in watch mode", test: has(/\s--watch\b|\s--looponfail\b/) },
	{ id: "docker-up", why: "brings up containers in the foreground", test: composeUpForeground },

	// --- streaming output that never returns ---
	{ id: "tail-f", why: "follows a log file", test: has(/\btail\s+-[fF]\b|\btail\s+--follow\b/) },
	{ id: "logs-f", why: "follows container logs", test: has(/\bdocker\s+logs\s+.*-f\b/) },
	{ id: "journal-f", why: "follows the system journal", test: has(/\bjournalctl\s+.*-f\b/) },
	{ id: "ssh", why: "opens an interactive SSH session", test: has(/^\s*ssh\s+[^-\s]\S*\s*$/) },
];

/** A Herdr control call, possibly after a `cd` or other prefix. */
export const RE_HERDR_CALL = /\bherdr\s+(pane|agent|workspace|tab|worktree|terminal|session)\b/;

/** Returns the first matching rule, or null when the command is fine. */
export function matchLongRunning(command: string): Rule | null {
	const cmd = command.trim();
	if (!cmd) return null;
	// The sanctioned path wraps long commands inside a `pane run` argument.
	if (RE_HERDR_CALL.test(cmd)) return null;
	if (cmd.includes(BYPASS_MARKER)) return null;
	for (const rule of RULES) {
		try {
			if (rule.test(cmd)) return rule;
		} catch {
			// A broken rule must never block a command.
		}
	}
	return null;
}

function blockReason(rule: Rule): string {
	return [
		`Blocked by longrun-guard: this command ${rule.why}.`,
		`It would occupy this tool until it exits, and cancelling would kill its whole process tree.`,
		``,
		`Do NOT retry with \`&\`, \`nohup\`, or \`setsid\` — that orphans the process under PID 1 with no way to read its output or stop it cleanly.`,
		``,
		`Start it in a persistent Herdr pane instead:`,
		`  1. herdr pane split --current --direction right --cwd "$PWD" --no-focus`,
		`     (read the new pane id from .result.pane.pane_id)`,
		`  2. herdr pane run <pane-id> "<the original command>"`,
		`  3. herdr pane wait-output <pane-id> --match "<ready marker>" --timeout 60000`,
		`  4. herdr pane read <pane-id> --source recent-unwrapped --lines 120`,
		``,
		`Follow the \`longrun\` skill for the full procedure (/skill:longrun).`,
	].join("\n");
}

export default function longRunGuard(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash" && event.toolName !== "powershell") return;
		// Only meaningful inside Herdr: that is where the replacement lives.
		if (process.env.HERDR_ENV !== "1") return;

		const command = String((event.input as { command?: unknown }).command ?? "");
		const rule = matchLongRunning(command);
		if (!rule) return;

		return { block: true, reason: blockReason(rule) };
	});
}
