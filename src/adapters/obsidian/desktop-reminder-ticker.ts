import type { Plugin } from "obsidian";

import { registerResolvedGate } from "@/adapters/obsidian/completion-watcher";
import type { FireDesktopReminders } from "@/app/fire-desktop-reminders";

const TICK_INTERVAL_MS = 30_000;

/** Fires on vault-ready, every 30s, and on window focus — the same "catch up after being backgrounded" triggers as the ntfy reconciler. */
export function registerDesktopReminderTicker(plugin: Plugin, fire: FireDesktopReminders): void {
	function run(): void {
		fire().catch((error: unknown) => {
			console.error("Isotask: desktop reminder tick failed", error);
		});
	}

	registerResolvedGate(plugin, run);

	plugin.registerInterval(window.setInterval(run, TICK_INTERVAL_MS));
	plugin.registerDomEvent(window, "focus", run);
}
