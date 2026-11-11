import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { nudgeReason } from "../../skills/wiki/scripts/wiki-stop-hook.mjs";

export default function wikiExtension(pi: ExtensionAPI) {
	pi.on("agent_before_settle", async (event, ctx) => {
		try {
			const reason = await nudgeReason(ctx.cwd ?? process.cwd(), { global: false });
			if (!reason) return;
			return {
				entries: [...event.entries, { type: "custom_message", customType: "wiki-nudge", content: reason, display: false }],
				continue: true,
			};
		} catch {
			return;
		}
	});
}
