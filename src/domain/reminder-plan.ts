import { format } from "date-fns";

import type { IsoDate, IsoDateTime, TaskDate } from "@/domain/dates";
import { addMinutes, compareTaskDate, formatTime, isDateTime, toDateOnly, toJsDate } from "@/domain/dates";
import type { ReminderAnchorKind, ReminderId, ReminderInstance, ReminderDefaults } from "@/domain/reminders";
import { reminderAnchor, reminderTimes } from "@/domain/reminders";
import type { Priority, Task, TaskPath } from "@/domain/task";

/** Every reminder instance due in `(from, to]` across the given tasks, sorted by fire time then path. */
export function dueReminders(
	tasks: readonly { readonly task: Task; readonly isOpen: boolean }[],
	from: IsoDateTime,
	to: IsoDateTime,
	defaults: ReminderDefaults,
): readonly { readonly task: Task; readonly reminder: ReminderInstance }[] {
	const results: { readonly task: Task; readonly reminder: ReminderInstance }[] = [];
	for (const { task, isOpen } of tasks) {
		for (const reminder of reminderTimes(task, defaults, isOpen)) {
			if (compareTaskDate(reminder.at, from) > 0 && compareTaskDate(reminder.at, to) <= 0) {
				results.push({ task, reminder });
			}
		}
	}
	return [...results].sort((a, b) => {
		const byTime = compareTaskDate(a.reminder.at, b.reminder.at);
		return byTime !== 0 ? byTime : a.task.path.localeCompare(b.task.path);
	});
}

export interface PushMessage {
	readonly id: ReminderId;
	/** The adapter builds the click-through URL from it; the domain never sees URLs. */
	readonly path: TaskPath;
	readonly at: IsoDateTime;
	readonly title: string;
	readonly body: string;
	readonly priority: 1 | 2 | 3 | 4 | 5;
	readonly tags: readonly string[];
}

function pushPriority(priority: Priority): 1 | 2 | 3 | 4 | 5 {
	switch (priority) {
		case "urgent":
			return 5;
		case "high":
			return 4;
		case "normal":
			return 3;
		default: {
			const exhaustive: never = priority;
			return exhaustive;
		}
	}
}

/** "today"/"tomorrow"/"24 Sep", `day` relative to `from` — the day the push itself fires. */
function relativeDayLabel(day: IsoDate, from: IsoDate): string {
	if (day === from) {
		return "today";
	}
	if (day === (addMinutes(from, 1440) as IsoDate)) {
		return "tomorrow";
	}
	return format(toJsDate(day), "d MMM");
}

/** "today 15:00" / "tomorrow" / "24 Sep" — the time is only shown for "today", where it's the actionable part. */
function dateLabel(anchorAt: TaskDate, firedAt: IsoDateTime): string {
	const relative = relativeDayLabel(toDateOnly(anchorAt), toDateOnly(firedAt));
	return relative === "today" && isDateTime(anchorAt) ? `${relative} ${formatTime(anchorAt)}` : relative;
}

/** The due/scheduled date a reminder's body should reference — itself for an offset reminder, or task's own anchor for a bare absolute one. */
function anchorForBody(task: Task, reminder: ReminderInstance): { readonly kind: ReminderAnchorKind; readonly at: TaskDate } | undefined {
	if (reminder.anchor !== "absolute") {
		const at = reminder.anchor === "scheduled" ? task.scheduled : task.due;
		return at === undefined ? undefined : { kind: reminder.anchor, at };
	}
	return reminderAnchor(task);
}

function reminderBody(task: Task, reminder: ReminderInstance): string {
	const projectSuffix = task.project !== undefined ? ` · ${task.project}` : "";
	const anchor = anchorForBody(task, reminder);
	if (anchor === undefined) {
		return `Reminder ${dateLabel(reminder.at, reminder.at)}${projectSuffix}`;
	}
	const prefix = anchor.kind === "scheduled" ? "Scheduled" : "Due";
	return `${prefix} ${dateLabel(anchor.at, reminder.at)}${projectSuffix}`;
}

/** ntfy push payload for one reminder instance. */
export function toPushMessage(task: Task, reminder: ReminderInstance): PushMessage {
	return {
		id: reminder.id,
		path: task.path,
		at: reminder.at,
		title: task.title,
		body: reminderBody(task, reminder),
		priority: pushPriority(task.priority),
		tags: ["alarm_clock"],
	};
}
