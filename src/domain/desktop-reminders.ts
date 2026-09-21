import type { IsoDateTime } from "@/domain/dates";
import { compareTaskDate } from "@/domain/dates";
import type { ReminderId, ReminderInstance } from "@/domain/reminders";

/** One reminder occurrence a desktop Notification has already shown, tracked per device (not synced). */
export interface FiredReminder {
	readonly key: string;
	readonly at: IsoDateTime;
}

/** `at` is part of the key so a rescheduled reminder (new fire time, same id) fires again. */
export function firedKey(id: ReminderId, at: IsoDateTime): string {
	return `${id}@${at}`;
}

/** The due items not already recorded as fired. */
export function remindersToShow<T extends { readonly reminder: ReminderInstance }>(
	due: readonly T[],
	fired: readonly FiredReminder[],
): readonly T[] {
	const firedKeys = new Set(fired.map((entry) => entry.key));
	return due.filter((item) => !firedKeys.has(firedKey(item.reminder.id, item.reminder.at)));
}

/** Drops entries outside the catch-up window so the ledger doesn't grow forever. */
export function pruneFired(fired: readonly FiredReminder[], cutoff: IsoDateTime): readonly FiredReminder[] {
	return fired.filter((entry) => compareTaskDate(entry.at, cutoff) > 0);
}
