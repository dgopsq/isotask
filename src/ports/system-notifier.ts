import type { FiredReminder } from "@/domain/desktop-reminders";

/** A single OS notification to show; `id` is the reminder id, used as the platform's replace/dedup tag. */
export interface SystemNotification {
	readonly id: string;
	readonly title: string;
	readonly body: string;
}

/** Desktop-only OS notifications, independent of the ntfy push channel. Implemented by `adapters/obsidian/desktop-notifier.ts`. */
export interface SystemNotifier {
	readonly isAvailable: () => boolean;
	readonly requestPermission: () => Promise<boolean>;
	readonly show: (notification: SystemNotification, onClick: () => void) => void;
}

/** Per-device record of reminder occurrences already shown, so a poll doesn't re-notify. Implemented by `adapters/obsidian/desktop-reminder-ledger.ts`. */
export interface FiredReminderLedger {
	readonly load: () => readonly FiredReminder[];
	readonly save: (entries: readonly FiredReminder[]) => void;
}
