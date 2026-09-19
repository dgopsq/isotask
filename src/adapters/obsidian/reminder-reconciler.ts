import type { Plugin } from "obsidian";
import { TFile } from "obsidian";

import { registerResolvedGate } from "@/adapters/obsidian/completion-watcher";
import type { ReconcileReminders } from "@/app/reconcile-reminders";
import { isTaskNote } from "@/domain/frontmatter";
import type { PropertyKeys } from "@/domain/property-keys";
import type { Notifier } from "@/ports/notifier";
import type { PushError } from "@/ports/push-channel";

const RECONCILE_INTERVAL_MS = 15 * 60_000;
const CHANGE_DEBOUNCE_MS = 5_000;

export interface ReminderReconcilerDeps {
	readonly reconcile: ReconcileReminders;
	readonly notifier: Notifier;
	readonly describeError: (error: PushError) => string;
	readonly getPropertyKeys: () => PropertyKeys;
}

/** Task-note events are debounced: one edit fires several `changed` events. */
export function registerReminderReconciler(plugin: Plugin, deps: ReminderReconcilerDeps): void {
	let gateOpen = false;
	let lastRunFailed = false;
	let lastNoticedCap: number | undefined;
	let debounceTimer: number | undefined;

	function noticeFailure(error: PushError): void {
		if (!lastRunFailed) {
			deps.notifier.error(deps.describeError(error));
		}
		lastRunFailed = true;
	}

	function noticeCapIfChanged(cap: number | undefined): void {
		if (cap !== undefined && cap !== lastNoticedCap) {
			lastNoticedCap = cap;
			deps.notifier.info(`ntfy capped the reminder lookahead at ${String(cap)} hours.`);
		}
	}

	async function run(): Promise<void> {
		if (!gateOpen) {
			return;
		}
		const outcome = await deps.reconcile();
		switch (outcome.kind) {
			case "disabled":
				return;
			case "unreachable":
				console.error("Isotask: could not read the ntfy topic", outcome.error);
				noticeFailure(outcome.error);
				return;
			case "reconciled": {
				noticeCapIfChanged(outcome.clampedLookaheadHours);
				const firstFailure = outcome.failed[0];
				if (firstFailure === undefined) {
					lastRunFailed = false;
					return;
				}
				console.error(`Isotask: reminder ${firstFailure.id} failed`, firstFailure.error);
				noticeFailure(firstFailure.error);
				return;
			}
			default: {
				const exhaustive: never = outcome;
				return exhaustive;
			}
		}
	}

	function scheduleRun(): void {
		if (debounceTimer !== undefined) {
			window.clearTimeout(debounceTimer);
		}
		debounceTimer = window.setTimeout(() => {
			debounceTimer = undefined;
			void run();
		}, CHANGE_DEBOUNCE_MS);
	}

	registerResolvedGate(plugin, () => {
		gateOpen = true;
		void run();
	});

	plugin.registerInterval(
		window.setInterval(() => {
			void run();
		}, RECONCILE_INTERVAL_MS),
	);
	plugin.registerDomEvent(window, "focus", () => {
		void run();
	});
	plugin.registerDomEvent(document, "visibilitychange", () => {
		if (document.visibilityState === "visible") {
			void run();
		}
	});

	plugin.registerEvent(
		plugin.app.metadataCache.on("changed", (file, _data, cache) => {
			if (!gateOpen || file.extension !== "md" || !isTaskNote(cache.frontmatter ?? {}, deps.getPropertyKeys())) {
				return;
			}
			scheduleRun();
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("delete", (file) => {
			// A deleted note has no cache left to test task-ness against, so any deleted .md counts.
			if (!gateOpen || !(file instanceof TFile) || file.extension !== "md") {
				return;
			}
			scheduleRun();
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("rename", (file) => {
			if (!gateOpen || !(file instanceof TFile) || file.extension !== "md") {
				return;
			}
			scheduleRun();
		}),
	);

	plugin.register(() => {
		if (debounceTimer !== undefined) {
			window.clearTimeout(debounceTimer);
		}
	});
}
