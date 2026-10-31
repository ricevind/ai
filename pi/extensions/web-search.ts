/**
 * Web Search extension for pi
 *
 * Registers two tools:
 * - web_search  : search the web (Tavily or Brave, auto-detected by env var)
 * - fetch_page  : fetch a URL and return readable text
 *
 * Setup (either one enables web_search):
 *   export TAVILY_API_KEY="tvly-..."   # https://tavily.com  (free tier)
 *   export BRAVE_API_KEY="BSA..."      # https://brave.com/search/api  (free tier)
 *
 * fetch_page needs no key. If no search key is set, only fetch_page registers.
 *
 * Rendering (quiet by default, matching quiet-mode.ts):
 *   - Collapsed results show a one-line label ("→ 5 results", "→ 128 lines").
 *   - Expanded (Ctrl+O or /quiet off) shows the full output.
 *   - Errors always print in full (capped to a few lines) so failures stay
 *     visible. Images from fetch_page are still displayed below the label.
 */

import type {
	ExtensionAPI,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	truncateHead,
	DEFAULT_MAX_LINES,
	DEFAULT_MAX_BYTES,
	formatSize,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface SearchHit {
	title: string;
	url: string;
	snippet: string;
}

async function tavilySearch(
	query: string,
	maxResults: number,
	apiKey: string,
	signal?: AbortSignal,
): Promise<SearchHit[]> {
	const res = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({ query, max_results: maxResults }),
		signal,
	});
	if (!res.ok) {
		throw new Error(`Tavily error ${res.status}: ${await res.text()}`);
	}
	const data = (await res.json()) as {
		results?: Array<{ title: string; url: string; content: string }>;
	};
	return (data.results ?? []).map((r) => ({
		title: r.title,
		url: r.url,
		snippet: r.content,
	}));
}

async function braveSearch(
	query: string,
	maxResults: number,
	apiKey: string,
	signal?: AbortSignal,
): Promise<SearchHit[]> {
	const url = `https://api.brave.com/search/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
	const res = await fetch(url, {
		headers: {
			"X-Subscription-Token": apiKey,
			Accept: "application/json",
		},
		signal,
	});
	if (!res.ok) {
		throw new Error(`Brave error ${res.status}: ${await res.text()}`);
	}
	const data = (await res.json()) as {
		web?: { results?: Array<{ title: string; url: string; description: string }> };
	};
	return (data.web?.results ?? []).map((r) => ({
		title: r.title,
		url: r.url,
		snippet: r.description,
	}));
}

/** Crude but dependency-free HTML → text */
function htmlToText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<(br|\/p|\/div|\/h[1-6]|\/li)[^>]*>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n\s*\n+/g, "\n\n")
		.trim();
}

// ---------------------------------------------------------------------------
// Quiet rendering (same collapsed style as quiet-mode.ts; no shared code —
// pi loads each extension file as a fresh module, so imports would not share
// state. Quiet-mode drives the global expanded state; these renderers are
// stateless: collapsed → label, expanded → full output).
// ---------------------------------------------------------------------------

const MAX_ERROR_LINES = 12;

function toolText(result: any): string {
	if (!result?.content) return "";
	return result.content
		.filter((c: any) => c.type === "text" && typeof c.text === "string")
		.map((c: any) => c.text)
		.join("\n");
}

/** Errors always stay visible, even in quiet mode (capped to a few lines). */
function errorComponent(result: any, theme: any): Text {
	const text = toolText(result).trim() || "Tool failed";
	const lines = text.split("\n");
	const shown = lines.slice(0, MAX_ERROR_LINES);
	const rest = lines.length - shown.length;
	let body = shown.map((l) => theme.fg("error", l)).join("\n");
	if (rest > 0) body += theme.fg("muted", `\n... (${rest} more lines)`);
	return new Text(`\n${body}`, 0, 0);
}

function makeQuietRenderResult(summarize: (result: any) => string) {
	return (
		result: any,
		options: ToolRenderResultOptions,
		theme: any,
		context: any,
	): any => {
		// Expanded (Ctrl+O or /quiet off) → full output.
		if (options.expanded) {
			const out = toolText(result);
			const body = out
				? out.split("\n").map((l) => theme.fg("toolOutput", l)).join("\n")
				: "";
			return new Text(body, 0, 0);
		}
		// Errors stay visible.
		if (context.isError) {
			return errorComponent(result, theme);
		}
		// While running: call label + pending background is enough.
		if (options.isPartial) {
			return new Text("", 0, 0);
		}
		return new Text(theme.fg("muted", `  ${summarize(result)}`), 0, 0);
	};
}

/** One-line labels for the web tools in quiet (collapsed) mode. */
const summarizeWebSearch = (result: any): string => {
	const n = result?.details?.hits?.length ?? 0;
	return n > 0 ? `→ ${n} result${n === 1 ? "" : "s"}` : "→ no results";
};

const summarizeFetchPage = (result: any): string => {
	if (result?.content?.some((c: any) => c.type === "image")) return "→ image";
	const text = toolText(result);
	const lines = text.trim() ? text.trim().split("\n").length : 0;
	let label = lines > 0 ? `→ ${lines} line${lines === 1 ? "" : "s"}` : "→ empty";
	if (result?.details?.truncated) label += " (truncated)";
	return label;
};

export default function webSearchExtension(pi: ExtensionAPI) {
	const tavilyKey = process.env.TAVILY_API_KEY;
	const braveKey = process.env.BRAVE_API_KEY;
	const searchProvider = tavilyKey ? "tavily" : braveKey ? "brave" : undefined;
	const searchKey = tavilyKey ?? braveKey;

	if (!searchProvider) {
		// No key — still register fetch_page, which is useful on its own.
		registerFetchPage(pi);
		return;
	}

	registerFetchPage(pi);

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: `Search the web via ${searchProvider}. Returns titles, URLs, and snippets. Use fetch_page on a result's URL to read the full page.`,
		promptSnippet: "Search the web for current information, docs, and answers",
		promptGuidelines: [
			"Use web_search when you need current information, external docs, or anything not knowable from the local project. Follow up with fetch_page on promising URLs.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			max_results: Type.Optional(
				Type.Integer({ minimum: 1, maximum: 10, description: "Max results (default 5)" }),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			onUpdate?.({ content: [{ type: "text", text: `Searching: ${params.query}` }] });

			const hits = searchProvider === "tavily"
				? await tavilySearch(params.query, params.max_results ?? 5, searchKey!, signal)
				: await braveSearch(params.query, params.max_results ?? 5, searchKey!, signal);

			if (hits.length === 0) {
				return {
					content: [{ type: "text", text: `No results for: ${params.query}` }],
					details: { hits: [] },
				};
			}

			const text = hits
				.map((h, i) => `${i + 1}. ${h.title}\n   URL: ${h.url}\n   ${h.snippet}`)
				.join("\n\n");

			return {
				content: [{ type: "text", text: `Web results for "${params.query}":\n\n${text}` }],
				details: { hits },
			};
		},
		renderResult: makeQuietRenderResult(summarizeWebSearch),
	});
}

function registerFetchPage(pi: ExtensionAPI) {
	pi.registerTool({
		name: "fetch_page",
		label: "Fetch Page",
		description:
			"Fetch a URL and return its text content. Use after web_search to read a full page. Pass an image URL to return the image data.",
		promptSnippet: "Fetch a web page's text (or an image) by URL",
		promptGuidelines: [
			"Use fetch_page to read the content of a URL, especially pages returned by web_search.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch (http/https)" }),
			max_bytes: Type.Optional(
				Type.Integer({ minimum: 1000, maximum: 200_000, description: "Max text bytes returned (default 50KB)" }),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			onUpdate?.({ content: [{ type: "text", text: `Fetching: ${params.url}` }] });

			let url: URL;
			try {
				url = new URL(params.url);
			} catch {
				throw new Error(`Invalid URL: ${params.url}`);
			}
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				throw new Error(`Unsupported protocol: ${url.protocol} (use http/https)`);
			}

			const res = await fetch(url, {
				headers: { "User-Agent": "pi-web-search-extension/1.0" },
				signal,
				redirect: "follow",
			});
			if (!res.ok) {
				throw new Error(`Fetch failed: HTTP ${res.status} for ${url}`);
			}

			const mediaType = res.headers.get("content-type") ?? "";

			// Images: return base64 so vision-capable models can see them.
			if (mediaType.startsWith("image/")) {
				const buf = Buffer.from(await res.arrayBuffer());
				if (buf.length > 4_000_000) {
					throw new Error(`Image too large: ${formatSize(buf.length)}`);
				}
				return {
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								mediaType: mediaType.split(";")[0] as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
								data: buf.toString("base64"),
							},
						},
					],
					details: { url: url.href, mediaType, bytes: buf.length },
				};
			}

			// Text: convert HTML to readable text and truncate.
			const raw = await res.text();
			const isHtml = mediaType.includes("html");
			const text = isHtml ? htmlToText(raw) : raw;

			const truncation = truncateHead(text, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: params.max_bytes ?? DEFAULT_MAX_BYTES,
			});

			let result = truncation.content;
			if (truncation.truncated) {
				// Write full content to a temp file so nothing is lost
				const dir = await mkdtemp(join(tmpdir(), "pi-fetch-"));
				const tempFile = join(dir, "page.txt");
				await writeFile(tempFile, text, "utf8");
				result += `\n\n[Truncated: showing ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}. Full content saved to: ${tempFile}]`;
			}

			return {
				content: [{ type: "text", text: result }],
				details: { url: url.href, mediaType, status: res.status, truncated: truncation.truncated },
			};
		},
		renderResult: makeQuietRenderResult(summarizeFetchPage),
	});
}
