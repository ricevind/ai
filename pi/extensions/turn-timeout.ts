/**
 * Turn Time Limit — a guardrail that caps how long any agent turn may run.
 *
 * A "turn" is everything pi does to answer one prompt: every LLM response,
 * tool call, automatic retry, auto-compaction, and queued steering/follow-up
 * message, until the run fully settles. One user prompt = one turn = one
 * shared deadline.
 *
 * When the limit is reached while the agent is still working, the extension
 * aborts the run (exactly like pressing Esc), notifies you, and records a
 * `turn-timeout-abort` entry in the session file for audit. If the first
 * abort doesn't fully stop the run (for example the turn was mid
 * auto-compaction and gets retried), the extension re-aborts a few times
 * before giving up.
 *
 * Time spent waiting on interactive extension dialogs (permission gates,
 * questions, pickers) does NOT count against the limit — the countdown is
 * paused while a dialog is open. The status bar shows a live countdown
 * (⏱ m:ss left) while a turn is running.
 *
 * Default: 5 minutes.
 *
 * Configuration (highest precedence first):
 *   1. Session override    /turn-timeout <duration>  (persisted in the session)
 *   2. Environment         PI_TURN_TIMEOUT_MS  (e.g. "300000", "5m", "90s", "off")
 *   3. Project settings    .pi/settings.json             "agentTurnTimeoutMs": 300000
 *                          (only read when the project is trusted)
 *   4. Global settings     ~/.pi/agent/settings.json     "agentTurnTimeoutMs": 300000
 *   5. Built-in default    5 minutes
 *
 * Values may be a number of milliseconds (300000), a duration string
 * ("5m", "90s", "1h30m", "2m30s", "500ms"), or 0/"off" to disable the
 * guardrail. Config changes made while a turn is running apply from the
 * next turn on.
 *
 * Commands:
 *   /turn-timeout             Show the active limit and where it comes from
 *   /turn-timeout <duration>  Set a session-scoped limit ("10m", "90s",
 *                             "300000", "off") — survives /resume
 *   /turn-timeout reset       Clear the session override, fall back to
 *                             env/settings/default
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/** Default cap for a single agent turn: 5 minutes. */
export const DEFAULT_TURN_TIMEOUT_MS = 5 * 60 * 1000;

const SETTING_KEY = "agentTurnTimeoutMs";
const ENV_KEY = "PI_TURN_TIMEOUT_MS";
/** How long before the deadline a "time is running out" warning is shown. */
const WARNING_LEAD_MS = 60_000;
/** Interval for the countdown status indicator. */
const STATUS_TICK_MS = 5_000;
/** Delay between repeated abort attempts when the first abort doesn't stick. */
const SWEEP_DELAY_MS = 10_000;
/** Maximum number of follow-up abort attempts before giving up. */
const MAX_SWEEPS = 12;
/** Node/Bun clamp timers at 2^31-1 ms (~24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const STATUS_KEY = "turn-timeout";
const CONFIG_ENTRY_TYPE = "turn-timeout-config";
const AUDIT_ENTRY_TYPE = "turn-timeout-abort";

interface TimeoutConfig {
	/** Effective limit in ms; 0 disables the guardrail. */
	timeoutMs: number;
	/** Where the effective value came from (for /turn-timeout display). */
	source: string;
}

/**
 * Parse a duration into milliseconds.
 * Accepts "300000" (plain number = ms), "5m", "90s", "1h30m", "2m30s",
 * "500ms", "1.5h", and "off"/"none"/"disabled"/"0" (→ 0, disables the limit).
 * Returns undefined for anything unparseable or negative.
 */
export function parseDurationMs(raw: string): number | undefined {
	const text = raw.trim().toLowerCase();
	if (!text) return undefined;
	if (text === "off" || text === "none" || text === "disabled") return 0;
	if (/^\d+$/.test(text)) return normalizeMs(Number(text));
	if (!/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(text)) return undefined;
	let total = 0;
	for (const match of text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
		const value = Number(match[1]);
		const unit = match[2];
		total += unit === "h" ? value * 3_600_000 : unit === "m" ? value * 60_000 : unit === "s" ? value * 1_000 : value;
	}
	return normalizeMs(total);
}

function normalizeMs(ms: number): number | undefined {
	if (!Number.isFinite(ms) || ms < 0) return undefined;
	return Math.min(Math.round(ms), MAX_TIMEOUT_MS);
}

/** Format a limit for display: "5m", "4m 30s", "1h 30s", "100ms", "off". */
export function formatDurationMs(ms: number): string {
	if (ms <= 0) return "off";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const totalSeconds = Math.round(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const parts: string[] = [];
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (seconds > 0 && hours === 0) parts.push(`${seconds}s`);
	return parts.length > 0 ? parts.join(" ") : "0s";
}

/** Format a countdown clock: "4:32" or "1:04:07". */
function formatClock(ms: number): string {
	const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
	return `${minutes}:${pad(seconds)}`;
}

/**
 * Read `agentTurnTimeoutMs` from one settings.json file.
 * Accepts a number (ms) or a duration string ("5m"). Invalid values are
 * ignored so a malformed file can't disable the guardrail silently.
 */
function readTimeoutFromFile(path: string): number | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
		const value = parsed[SETTING_KEY];
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
			return normalizeMs(value);
		}
		if (typeof value === "string") {
			const duration = parseDurationMs(value);
			if (duration !== undefined) return duration;
		}
	} catch {
		// Malformed JSON: ignore (pi surfaces settings file errors itself).
	}
	return undefined;
}

/** Resolve the effective limit. Precedence: override → env → project → global → default. */
function resolveTurnTimeout(cwd: string, projectTrusted: boolean, override: number | undefined): TimeoutConfig {
	if (override !== undefined) {
		return { timeoutMs: override, source: "session override (/turn-timeout)" };
	}
	const envRaw = process.env[ENV_KEY];
	if (envRaw !== undefined && envRaw.trim() !== "") {
		const parsed = parseDurationMs(envRaw);
		if (parsed !== undefined) {
			return { timeoutMs: parsed, source: `environment (${ENV_KEY})` };
		}
	}
	if (projectTrusted) {
		const project = readTimeoutFromFile(join(cwd, CONFIG_DIR_NAME, "settings.json"));
		if (project !== undefined) {
			return { timeoutMs: project, source: "project settings (.pi/settings.json)" };
		}
	}
	const global = readTimeoutFromFile(join(getAgentDir(), "settings.json"));
	if (global !== undefined) {
		return { timeoutMs: global, source: "global settings (~/.pi/agent/settings.json)" };
	}
	return { timeoutMs: DEFAULT_TURN_TIMEOUT_MS, source: "built-in default" };
}

/** Restore the session-scoped override from the session's custom entries (last entry wins). */
function restoreSessionOverride(entries: readonly unknown[]): number | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; customType?: string; data?: { timeoutMs?: unknown } } | undefined;
		if (!entry || entry.type !== "custom" || entry.customType !== CONFIG_ENTRY_TYPE) continue;
		const value = entry.data?.timeoutMs;
		return typeof value === "number" && Number.isFinite(value) && value >= 0 ? normalizeMs(value) : undefined;
	}
	return undefined;
}

export default function turnTimeoutExtension(pi: ExtensionAPI) {
	// --- Configuration ---
	let config: TimeoutConfig = { timeoutMs: DEFAULT_TURN_TIMEOUT_MS, source: "built-in default" };
	let sessionOverride: number | undefined;

	// --- State machine ---
	let running = false; // an agent run cycle is active (first agent_start until agent_settled)
	let countdownActive = false; // logical countdown in progress for this turn
	let sweeping = false; // post-timeout re-abort loop active
	let paused = false; // countdown frozen while an extension dialog waits for the user
	let pausedRemainingMs = 0; // remaining budget captured when the countdown was paused
	let pauseDepth = 0; // nested ui_prompt_start/end coalescing
	let armOnResume = false; // a run started while a dialog was open; arm when it closes
	let deadline = 0; // wall-clock deadline of the current countdown
	let sweeps = 0; // follow-up abort attempts after the first one

	// --- Timers ---
	let timer: ReturnType<typeof setTimeout> | undefined;
	let warnTimer: ReturnType<typeof setTimeout> | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let activeCtx: ExtensionContext | undefined;

	function clearTimers(): void {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		if (warnTimer !== undefined) {
			clearTimeout(warnTimer);
			warnTimer = undefined;
		}
		if (ticker !== undefined) {
			clearInterval(ticker);
			ticker = undefined;
		}
	}

	function updateStatus(): void {
		const ctx = activeCtx;
		if (!ctx || !ctx.hasUI) return;
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "⏱ 0:00"));
			return;
		}
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", `⏱ ${formatClock(remaining)} left`));
	}

	function showDisabledStatus(): void {
		const ctx = activeCtx;
		if (!ctx || !ctx.hasUI) return;
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", "⏱ turn limit off"));
	}

	function startCountdown(ms: number): void {
		clearTimers();
		countdownActive = true;
		paused = false;
		pausedRemainingMs = 0;
		deadline = Date.now() + Math.max(0, ms);
		// Timer callbacks are wrapped: after /reload or a session switch the
		// captured ctx goes stale and throws; swallow that instead of crashing.
		timer = setTimeout(() => {
			try {
				onDeadline();
			} catch {
				clearTimers();
				countdownActive = false;
			}
		}, Math.max(0, ms));
		if (ms > WARNING_LEAD_MS) {
			warnTimer = setTimeout(() => {
				try {
					warnNearDeadline();
				} catch {
					/* stale ctx — ignore */
				}
			}, ms - WARNING_LEAD_MS);
		}
		ticker = setInterval(() => {
			try {
				updateStatus();
			} catch {
				/* stale ctx — ignore */
			}
		}, STATUS_TICK_MS);
		updateStatus();
	}

	function warnNearDeadline(): void {
		const ctx = activeCtx;
		if (!ctx || !ctx.hasUI || !countdownActive || paused) return;
		ctx.ui.notify(`⏱ Turn limit: ${formatClock(WARNING_LEAD_MS)} remaining`, "warning");
	}

	function pauseCountdown(): void {
		pausedRemainingMs = Math.max(0, deadline - Date.now());
		clearTimers();
		const ctx = activeCtx;
		if (ctx?.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", "⏱ paused (waiting for input)"));
		}
	}

	function finishTurn(ctx: ExtensionContext | undefined): void {
		running = false;
		countdownActive = false;
		sweeping = false;
		paused = false;
		pausedRemainingMs = 0;
		pauseDepth = 0;
		armOnResume = false;
		sweeps = 0;
		clearTimers();
		if (ctx?.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	/** Deadline reached: abort the turn, record why, and sweep until it stops. */
	function onDeadline(): void {
		clearTimers();
		countdownActive = false;
		const ctx = activeCtx;
		if (!ctx) return;
		if (ctx.isIdle()) {
			finishTurn(ctx);
			return;
		}
		try {
			// Same as the user pressing Esc: stops the run and restores any
			// queued steering/follow-up messages to the editor.
			ctx.abort();
		} catch {
			return; // stale ctx (reloaded/replaced session) — the new incarnation owns the turn
		}
		const limitText = formatDurationMs(config.timeoutMs);
		if (ctx.hasUI) {
			ctx.ui.notify(`⏱ Turn limit reached (${limitText}) — turn stopped.`, "warning");
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "⏱ limit reached"));
		}
		try {
			pi.appendEntry(AUDIT_ENTRY_TYPE, {
				timeoutMs: config.timeoutMs,
				source: config.source,
				limit: limitText,
				at: new Date().toISOString(),
			});
		} catch {
			// Session may be read-only in this state; the abort itself still stands.
		}
		sweeps = 0;
		sweeping = true;
		// A single abort may not stick if the turn was mid auto-compaction
		// (the retried run only starts streaming later). Sweep until idle.
		timer = setTimeout(() => {
			try {
				sweepOnce();
			} catch {
				clearTimers();
			}
		}, SWEEP_DELAY_MS);
	}

	function sweepOnce(): void {
		const ctx = activeCtx;
		if (!ctx) {
			clearTimers();
			return;
		}
		if (ctx.isIdle()) {
			finishTurn(ctx);
			return;
		}
		try {
			ctx.abort();
		} catch {
			clearTimers();
			return;
		}
		sweeps += 1;
		if (sweeps >= MAX_SWEEPS) {
			sweeping = false;
			if (ctx.hasUI) {
				ctx.ui.notify("⏱ Turn limit: repeated aborts did not stop the turn — giving up.", "error");
			}
			clearTimers();
			return;
		}
		timer = setTimeout(() => {
			try {
				sweepOnce();
			} catch {
				clearTimers();
			}
		}, SWEEP_DELAY_MS);
	}

	// --- Configuration lifecycle ---

	pi.on("session_start", (_event, ctx) => {
		sessionOverride = restoreSessionOverride(ctx.sessionManager.getEntries());
		config = resolveTurnTimeout(ctx.cwd, ctx.isProjectTrusted(), sessionOverride);
		// /reload mid-run: this fresh instance never saw agent_start, but a
		// run may still be active — arm a countdown so the guardrail keeps working.
		if (!ctx.isIdle() && !countdownActive && config.timeoutMs > 0) {
			running = true;
			activeCtx = ctx;
			startCountdown(config.timeoutMs);
		}
	});

	// --- Guardrail lifecycle ---

	pi.on("agent_start", (_event, ctx) => {
		activeCtx = ctx;
		if (running && (countdownActive || sweeping)) {
			// A later low-level run within the same turn cycle (auto-retry,
			// compaction retry, queued follow-up): keep the shared deadline.
			return;
		}
		if (running) {
			// Stale state: the previous cycle never settled cleanly (e.g. the
			// sweep loop gave up on a stuck run). Treat this as a fresh cycle.
			running = false;
			countdownActive = false;
			sweeping = false;
			paused = false;
			pausedRemainingMs = 0;
			pauseDepth = 0;
			armOnResume = false;
		}
		running = true;
		if (paused) {
			armOnResume = true;
			return;
		}
		if (config.timeoutMs > 0) {
			startCountdown(config.timeoutMs);
		} else {
			showDisabledStatus();
		}
	});

	// Pause while pi waits on a blocking extension dialog (permission gate,
	// question, picker): user think-time is not agent work-time.
	pi.on("ui_prompt_start", () => {
		pauseDepth += 1;
		if (pauseDepth === 1 && countdownActive && !paused) {
			paused = true;
			pauseCountdown();
		}
	});

	pi.on("ui_prompt_end", () => {
		if (pauseDepth > 0) pauseDepth -= 1;
		if (pauseDepth > 0) return;
		if (paused) {
			paused = false;
			if (countdownActive) {
				// Remaining budget of 0 re-arms a timer that fires immediately.
				startCountdown(pausedRemainingMs);
				return;
			}
		}
		if (armOnResume && running) {
			armOnResume = false;
			if (config.timeoutMs > 0) {
				startCountdown(config.timeoutMs);
			} else {
				showDisabledStatus();
			}
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		finishTurn(ctx);
	});

	pi.on("session_shutdown", () => {
		clearTimers();
	});

	// --- /turn-timeout command ---

	function describeConfig(): string {
		return `${formatDurationMs(config.timeoutMs)} (${config.source})`;
	}

	pi.registerCommand("turn-timeout", {
		description: "View or set the agent turn time limit (guardrail)",
		handler: async (args, ctx) => {
			const input = args.trim();
			if (!input) {
				const chain =
					`Precedence: /turn-timeout override → $${ENV_KEY} → .pi/settings.json` +
					` → ~/.pi/agent/settings.json → built-in default (${formatDurationMs(DEFAULT_TURN_TIMEOUT_MS)})`;
				const usage =
					'Set: /turn-timeout <duration> (e.g. "10m", "90s", "1h30m", "300000", "off") · Clear: /turn-timeout reset';
				ctx.ui.notify(
					`Turn limit: ${describeConfig()}\n${chain}\n${usage}` +
						(sessionOverride !== undefined ? "\nA session override is active." : ""),
					"info",
				);
				return;
			}
			if (input === "reset" || input === "clear" || input === "default") {
				sessionOverride = undefined;
				try {
					pi.appendEntry(CONFIG_ENTRY_TYPE, { timeoutMs: null });
				} catch {
					/* session write failed — override is still cleared for this session */
				}
				config = resolveTurnTimeout(ctx.cwd, ctx.isProjectTrusted(), sessionOverride);
				ctx.ui.notify(`Turn limit override cleared. Active limit: ${describeConfig()}`, "info");
				return;
			}
			const parsed = parseDurationMs(input);
			if (parsed === undefined) {
				ctx.ui.notify(
					`Invalid duration "${input}". Examples: 5m, 90s, 1h30m, 300000 (ms), 0/off (disable), reset.`,
					"error",
				);
				return;
			}
			sessionOverride = parsed;
			config = { timeoutMs: parsed, source: "session override (/turn-timeout)" };
			try {
				pi.appendEntry(CONFIG_ENTRY_TYPE, { timeoutMs: parsed });
			} catch {
				/* session write failed — override still applies for this session */
			}
			ctx.ui.notify(
				parsed === 0
					? "Turn limit disabled for this session (guardrail off)."
					: `Turn limit set to ${formatDurationMs(parsed)} for this session. Applies from the next turn.`,
				"info",
			);
		},
	});
}
