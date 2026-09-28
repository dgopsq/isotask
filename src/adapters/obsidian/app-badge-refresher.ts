import type { Plugin } from "obsidian";

import { registerResolvedGate } from "@/adapters/obsidian/completion-watcher";

const REFRESH_INTERVAL_MS = 15 * 60_000;
const CHANGE_DEBOUNCE_MS = 1_000;

export function registerAppBadgeRefresher(plugin: Plugin, refresh: () => void): void {
	let gateOpen = false;
	let debounceTimer: number | undefined;

	function scheduleRefresh(): void {
		if (debounceTimer !== undefined) {
			window.clearTimeout(debounceTimer);
		}
		debounceTimer = window.setTimeout(() => {
			debounceTimer = undefined;
			refresh();
		}, CHANGE_DEBOUNCE_MS);
	}

	registerResolvedGate(plugin, () => {
		gateOpen = true;
		refresh();
	});

	// Gated too: before the metadata cache resolves, the count would be too low.
	const refreshIfReady = (): void => {
		if (gateOpen) {
			refresh();
		}
	};
	plugin.registerInterval(window.setInterval(refreshIfReady, REFRESH_INTERVAL_MS));
	plugin.registerDomEvent(window, "focus", refreshIfReady);
	plugin.registerDomEvent(document, "visibilitychange", () => {
		if (document.visibilityState === "visible") {
			refreshIfReady();
		}
	});

	// Not filtered by isTaskNote: a note that just lost its task marker must drop out of the count.
	plugin.registerEvent(
		plugin.app.metadataCache.on("changed", (file) => {
			if (gateOpen && file.extension === "md") {
				scheduleRefresh();
			}
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("delete", (file) => {
			if (gateOpen && "extension" in file && file.extension === "md") {
				scheduleRefresh();
			}
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("rename", (file) => {
			if (gateOpen && "extension" in file && file.extension === "md") {
				scheduleRefresh();
			}
		}),
	);

	plugin.register(() => {
		if (debounceTimer !== undefined) {
			window.clearTimeout(debounceTimer);
		}
	});
}
