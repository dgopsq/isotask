import type { IsoDateTime } from "@/domain/dates";
import { addMinutes } from "@/domain/dates";
import { firedKey, pruneFired, remindersToShow } from "@/domain/desktop-reminders";
import type { FiredReminder } from "@/domain/desktop-reminders";
import { dueReminders, toPushMessage } from "@/domain/reminder-plan";
import type { IsotaskSettings } from "@/domain/settings";
import { reminderDefaultsOf } from "@/domain/settings";
import { isOpenStatus } from "@/domain/status";
import type { TaskPath } from "@/domain/task";
import type { Clock } from "@/ports/clock";
import type { FiredReminderLedger, SystemNotifier } from "@/ports/system-notifier";
import type { TaskStore } from "@/ports/task-store";

export interface FireDesktopRemindersDeps {
	readonly store: TaskStore;
	readonly clock: Clock;
	readonly notifier: SystemNotifier;
	readonly ledger: FiredReminderLedger;
	readonly settings: () => IsotaskSettings;
	readonly openTask: (path: TaskPath) => void;
}

/** Live-fires due reminders as OS notifications; the fired ledger (not the poll) is the dedup source, so this never needs a server. */
export function makeFireDesktopReminders(deps: FireDesktopRemindersDeps): () => Promise<number> {
	let inFlight: Promise<number> | undefined;

	async function run(): Promise<number> {
		const settings = deps.settings();
		if (!settings.reminders.desktopNotifications || !deps.notifier.isAvailable()) {
			return 0;
		}

		const now = deps.clock.now();
		const cutoff = addMinutes(now, -settings.reminders.catchUpMinutes) as IsoDateTime;
		const loaded = deps.ledger.load();
		const fired = pruneFired(loaded, cutoff);

		const tasks = await deps.store.list();
		const tasksWithIsOpen = tasks.map((task) => ({ task, isOpen: isOpenStatus(settings.statuses, task.status) }));
		const due = dueReminders(tasksWithIsOpen, cutoff, now, reminderDefaultsOf(settings.reminders));
		const toShow = remindersToShow(due, fired);

		for (const { task, reminder } of toShow) {
			const message = toPushMessage(task, reminder);
			deps.notifier.show({ id: message.id, title: message.title, body: message.body }, () => {
				deps.openTask(task.path);
			});
		}

		const newlyFired: readonly FiredReminder[] = toShow.map(({ reminder }) => ({ key: firedKey(reminder.id, reminder.at), at: reminder.at }));
		if (newlyFired.length > 0 || fired.length !== loaded.length) {
			deps.ledger.save([...fired, ...newlyFired]);
		}

		return toShow.length;
	}

	return async () => {
		if (inFlight !== undefined) {
			return inFlight;
		}
		const promise = run().finally(() => {
			inFlight = undefined;
		});
		inFlight = promise;
		return promise;
	};
}

export type FireDesktopReminders = ReturnType<typeof makeFireDesktopReminders>;
