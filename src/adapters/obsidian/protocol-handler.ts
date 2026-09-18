import type { Plugin } from "obsidian";
import { normalizePath, Notice } from "obsidian";

import { PROTOCOL_OPEN_ACTION } from "@/plugin-id";

/** Pure so it's testable without a `Plugin`/`App`; `path` is the only param the handler needs, `vault` is consumed by Obsidian before the handler runs. */
export function parseOpenParams(params: Record<string, string>): { readonly path: string } | undefined {
	const path = params["path"];
	return path === undefined || path === "" ? undefined : { path };
}

/** `obsidian://<id>/open?vault=…&path=…&rid=…` — the click-through URL `ntfy-request.ts#clickUrlFor` builds. `rid` isn't used yet (no per-reminder action on open); reserved for wave 2b. */
export function registerProtocolHandlers(plugin: Plugin): void {
	plugin.registerObsidianProtocolHandler(PROTOCOL_OPEN_ACTION, (params) => {
		const parsed = parseOpenParams(params);
		if (parsed === undefined) {
			return;
		}
		const path = normalizePath(parsed.path);
		if (plugin.app.vault.getFileByPath(path) === null) {
			new Notice(`Isotask: could not find ${path}.`);
			return;
		}
		void plugin.app.workspace.openLinkText(path, "", false);
	});
}
