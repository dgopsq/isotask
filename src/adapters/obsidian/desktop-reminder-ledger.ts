import type { App } from "obsidian";

import type { FiredReminder } from "@/domain/desktop-reminders";
import type { FiredReminderLedger } from "@/ports/system-notifier";

const STORAGE_KEY = "isotask-fired-reminders";

function isFiredReminder(value: unknown): value is FiredReminder {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return typeof candidate["key"] === "string" && typeof candidate["at"] === "string";
}

/** `localStorage`, not `data.json`: deliberately per-device, so each desktop instance fires (and dedups) independently, unaffected by Sync. */
export function createDesktopReminderLedger(app: App): FiredReminderLedger {
	return {
		load: (): readonly FiredReminder[] => {
			const raw: unknown = app.loadLocalStorage(STORAGE_KEY);
			if (!Array.isArray(raw)) {
				return [];
			}
			return raw.filter(isFiredReminder);
		},

		save: (entries: readonly FiredReminder[]): void => {
			app.saveLocalStorage(STORAGE_KEY, entries);
		},
	};
}
