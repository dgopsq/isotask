import type { Plugin } from "obsidian";

import { registerResolvedGate } from "@/adapters/obsidian/completion-watcher";
import type { FireDueReminders } from "@/app/fire-due-reminders";
import type { Notifier } from "@/ports/notifier";
import type { PushError } from "@/ports/push-channel";

const TICK_INTERVAL_MS = 60_000;

export interface ReminderTickerDeps {
	readonly fire: FireDueReminders;
	readonly notifier: Notifier;
	readonly describeError: (error: PushError) => string;
}

/**
 * Ticks on a timer, on window focus, on the tab becoming visible, and once
 * indexing settles after startup. Single-flight (a slow server can't stack
 * overlapping ticks) and only Notices the first failure after a success — a
 * dead server would otherwise spam a Notice every minute.
 */
export function registerReminderTicker(plugin: Plugin, deps: ReminderTickerDeps): void {
	let inFlight = false;
	let lastTickFailed = false;

	async function tick(): Promise<void> {
		if (inFlight) {
			return;
		}
		inFlight = true;
		try {
			const outcome = await deps.fire();
			if (outcome.kind === "disabled") {
				return;
			}
			const firstFailure = outcome.failed[0];
			if (firstFailure === undefined) {
				lastTickFailed = false;
				return;
			}
			console.error(`Isotask: reminder ${firstFailure.id} failed to send`, firstFailure.error);
			if (!lastTickFailed) {
				deps.notifier.error(deps.describeError(firstFailure.error));
			}
			lastTickFailed = true;
		} finally {
			inFlight = false;
		}
	}

	registerResolvedGate(plugin, () => {
		void tick();
	});
	plugin.registerInterval(
		window.setInterval(() => {
			void tick();
		}, TICK_INTERVAL_MS),
	);
	plugin.registerDomEvent(window, "focus", () => {
		void tick();
	});
	plugin.registerDomEvent(document, "visibilitychange", () => {
		if (document.visibilityState === "visible") {
			void tick();
		}
	});
}
