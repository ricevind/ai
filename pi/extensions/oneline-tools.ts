/**
 * One-line tool display.
 *
 * When tool display is collapsed (the default view, toggled with ctrl+o),
 * the built-in tools render as exactly ONE line:
 *
 *   ✓ bash npm test
 *   … read src/foo.ts:1-50
 *   ✗ edit src/main.ts
 *
 * No output previews, no diffs, no args dumps. Toggling expand (ctrl+o)
 * brings back the full built-in rendering (output, diffs, syntax highlights).
 *
 * This is display-only: it hooks tool rendering through
 * `pi.registerToolRenderer()` and never re-registers the tools themselves.
 * Their definitions, options, and exposure stay exactly as pi set them up,
 * so scripts and codemode keep calling the real built-in tools.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

const MAX_LINE = 160;

/** Tool rows that collapse to one line when tool display is collapsed. */
const ONE_LINE_TOOLS = new Set([
	"read",
	"bash",
	"powershell",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"codemode",
]);

function shortenPath(path: string): string {
	const home = homedir();
	if (path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

function str(v: unknown): string {
	return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

/** First meaningful line of a codemode script: skips blanks, comments, and the `// @options:` line. */
function scriptSummary(code: string): string {
	const all = code.replace(/\r/g, "").split("\n");
	const body = all.filter((line) => line.trim() && !line.trim().startsWith("//"));
	const first = (body[0] ?? all.find((line) => line.trim()) ?? "").replace(/\s+/g, " ").trim();
	const extra = all.filter((line) => line.trim()).length - 1;
	return extra > 0 ? `${first} (+${extra} lines)` : first;
}

/** Compact single-line argument summary per tool. */
function summarize(name: string, args: any, cwd: string): string {
	const a = args ?? {};
	const p = (v: unknown) => shortenPath(str(v));
	let s: string;
	switch (name) {
		case "read": {
			s = p(a.file_path ?? a.path) || "…";
			if (a.offset !== undefined || a.limit !== undefined) {
				const start = a.offset ?? 1;
				const end = a.limit !== undefined ? start + a.limit - 1 : "";
				s += `:${start}${end ? `-${end}` : ""}`;
			}
			break;
		}
		case "bash":
			s = `$ ${str(a.command).replace(/\s+/g, " ").trim() || "…"}`;
			break;
		case "powershell":
			s = `PS> ${str(a.command).replace(/\s+/g, " ").trim() || "…"}`;
			break;
		case "edit": {
			const n = Array.isArray(a.edits) ? a.edits.length : 1;
			s = `${p(a.file_path ?? a.path) || "…"}`;
			if (n > 1) s += ` (${n} edits)`;
			break;
		}
		case "write": {
			const content = str(a.content);
			const lines = content ? content.split("\n").length : 0;
			s = `${p(a.file_path ?? a.path) || "…"}`;
			if (lines > 0) s += ` (${lines} lines)`;
			break;
		}
		case "grep": {
			s = `/${str(a.pattern)}/ in ${p(a.path ?? ".")}`;
			if (a.glob) s += ` (${str(a.glob)})`;
			break;
		}
		case "find":
			s = `${str(a.pattern) || "…"} in ${p(a.path ?? ".")}`;
			break;
		case "ls":
			s = p(a.path ?? ".");
			break;
		case "codemode":
			s = scriptSummary(str(a.code)) || "…";
			break;
		default:
			s = "";
	}
	if (s.length > MAX_LINE) s = `${s.slice(0, MAX_LINE - 1)}…`;
	return s;
}

/** Reuse our marked Text for the slot, or create a fresh one. */
function oneLineText(marked: unknown): Text {
	if (marked && (marked as any).__oneline === true) return marked as Text;
	const t = new Text("", 0, 0);
	(t as any).__oneline = true;
	return t;
}

/** Built-in renderers must never receive our Text as lastComponent (they expect their own component types). */
function builtInLast(ctx: any): unknown {
	const lc = ctx?.lastComponent;
	return lc && (lc as any).__oneline !== true ? lc : undefined;
}

/**
 * Collapsed result suffix for codemode: nested call count, failures, and duration.
 * Appended to the call line so the whole row stays one line.
 */
function codemodeSuffix(result: any, ctx: any, theme: any): string {
	const parts: string[] = [];
	const calls: any[] = result?.details?.calls ?? [];
	if (calls.length > 0) {
		const failed = calls.filter((c) => c.status === "error").length;
		const running = calls.filter((c) => c.status === "running").length;
		parts.push(theme.fg("muted", `${calls.length} call${calls.length === 1 ? "" : "s"}`));
		if (running > 0) parts.push(theme.fg("warning", `${running} running`));
		if (failed > 0) parts.push(theme.fg("error", `${failed} failed`));
	}
	if (ctx.isError) {
		const text = (result?.content ?? [])
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n");
		// Error results keep the partial output before a trailing "Script error:" line.
		const match = text.match(/Script error:\s*([\s\S]*)$/);
		const error = (match ? match[1] : text).split("\n").find((l: string) => l.trim()) ?? "error";
		parts.push(theme.fg("error", error.length > 60 ? `${error.slice(0, 59)}…` : error));
	}
	if (ctx.durationMs !== undefined) {
		const ms = ctx.durationMs;
		parts.push(theme.fg("dim", ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`));
	}
	return parts.join(" ");
}

/** The collapsed call line as a string, so the result renderer can append to it later. */
function oneLineString(name: string, args: any, ctx: any, theme: any): string {
	const icon = ctx.isError
		? theme.fg("error", "✗")
		: ctx.isPartial
			? theme.fg("dim", "…")
			: theme.fg("dim", "✓");
	const label = theme.fg("toolTitle", theme.bold(name));
	const summary = theme.fg("accent", summarize(name, args, ctx.cwd));
	return `${icon} ${label} ${summary}`.trimEnd();
}

function renderOneLine(name: string, args: any, ctx: any, theme: any): Text {
	const text = oneLineText(ctx.lastComponent);
	text.setText(oneLineString(name, args, ctx, theme));
	return text;
}

export default function (pi: ExtensionAPI) {
	pi.registerToolRenderer((toolName, next) => {
		if (!ONE_LINE_TOOLS.has(toolName)) return next();
		// What the row would otherwise use: the tool definition with its built-in
		// renderers (bash shells, read images, edit diffs, ...).
		const builtIn = next();
		return {
			// Preserve the tool's own framing (edit renders with renderShell: "self").
			...(builtIn && typeof builtIn.renderShell === "string" ? { renderShell: builtIn.renderShell } : {}),
			renderCall(args: any, theme: any, ctx: any) {
				if (ctx.expanded && builtIn?.renderCall) {
					// Preserve shell elapsed-time tracking across collapsed phases.
					if (ctx.executionStarted && ctx.state.startedAt === undefined) {
						ctx.state.startedAt = Date.now();
					}
					return builtIn.renderCall(args, theme, { ...ctx, lastComponent: builtInLast(ctx) });
				}
				const text = renderOneLine(toolName, args, ctx, theme);
				// The result renderer gets its own slot, so keep the call line in shared state.
				ctx.state.oneLineCall = text;
				ctx.state.oneLineBase = oneLineString(toolName, args, ctx, theme);
				return text;
			},
			renderResult(result: any, options: any, theme: any, ctx: any) {
				if (options.expanded && builtIn?.renderResult) {
					return builtIn.renderResult(result, options, theme, { ...ctx, lastComponent: builtInLast(ctx) });
				}
				if (toolName === "codemode" && ctx.state.oneLineCall) {
					// Fold the result into the call line: still exactly one line.
					const suffix = codemodeSuffix(result, ctx, theme);
					(ctx.state.oneLineCall as Text).setText(
						suffix ? `${ctx.state.oneLineBase ?? ""} ${suffix}` : (ctx.state.oneLineBase ?? ""),
					);
				}
				// Collapsed: contribute zero lines — the call line above is the whole display.
				const text = oneLineText(ctx.lastComponent);
				text.setText("");
				return text;
			},
		};
	});
}