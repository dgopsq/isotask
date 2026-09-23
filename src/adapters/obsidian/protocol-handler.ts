import type { App, Plugin } from "obsidian";
import { normalizePath, Notice } from "obsidian";

import { PROTOCOL_OPEN_ACTION } from "@/plugin-id";

/** Pure so it's testable without a `Plugin`/`App`; `path` is the only param the handler needs, `vault` is consumed by Obsidian before the handler runs. */
export function parseOpenParams(params: Record<string, string>): { readonly path: string } | undefined {
	const path = params["path"];
	return path === undefined || path === "" ? undefined : { path };
}

/** Shared by the protocol handler and the desktop reminder notifier's click-through. Notices, rather than throwing, when the note is gone. */
export function openTaskNote(app: App, path: string): void {
	const normalized = normalizePath(path);
	if (app.vault.getFileByPath(normalized) === null) {
		new Notice(`Isotask: could not find ${normalized}.`);
		return;
	}
	void app.workspace.openLinkText(normalized, "", false);
}

/** `obsidian://<id>/open?vault=…&path=…&rid=…` — the click-through URL `ntfy-request.ts#clickUrlFor` builds. `rid` isn't used yet (no per-reminder action on open); reserved for wave 2b. */
export function registerProtocolHandlers(plugin: Plugin): void {
	plugin.registerObsidianProtocolHandler(PROTOCOL_OPEN_ACTION, (params) => {
		const parsed = parseOpenParams(params);
		if (parsed === undefined) {
			return;
		}
		openTaskNote(plugin.app, parsed.path);
	});
}
