import { describe, expect, it, vi } from "vitest";

vi.stubEnv("TZ", "Europe/Rome");

import type { IsoDateTime, TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { dueReminders, toPushMessage } from "@/domain/reminder-plan";
import { DEFAULT_REMINDER_DEFAULTS, reminderTimes } from "@/domain/reminders";
import type { ReminderInstance } from "@/domain/reminders";
import type { StatusId, Task, TaskPath } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

function iso(value: string): IsoDateTime {
	return value as IsoDateTime;
}

function task(overrides: Partial<Task> & { readonly title: string }): Task {
	return {
		path: `${overrides.title}.md` as TaskPath,
		status: "todo" as StatusId,
		priority: "normal",
		tags: [],
		...overrides,
	};
}

function onlyReminder(t: Task): ReminderInstance {
	const [instance] = reminderTimes(t, DEFAULT_REMINDER_DEFAULTS, true);
	if (instance === undefined) {
		throw new Error("unreachable: fixture task has no reminder instance");
	}
	return instance;
}

describe("dueReminders", () => {
	it("keeps only instances with from < at <= to", () => {
		const early = task({ title: "Early", due: date("2026-09-20T08:00") });
		const inRange = task({ title: "In range", due: date("2026-09-20T10:00") });
		const boundary = task({ title: "Boundary", due: date("2026-09-20T12:00") });
		const late = task({ title: "Late", due: date("2026-09-20T14:00") });

		const result = dueReminders(
			[early, inRange, boundary, late].map((t) => ({ task: t, isOpen: true })),
			iso("2026-09-20T09:00"),
			iso("2026-09-20T12:00"),
			DEFAULT_REMINDER_DEFAULTS,
		);

		expect(result.map((r) => r.task.title)).toEqual(["In range", "Boundary"]);
	});

	it("sorts by fire time, then by path", () => {
		const b = task({ title: "B", due: date("2026-09-20T09:00") });
		const a = task({ title: "A", due: date("2026-09-20T09:00") });
		const result = dueReminders(
			[b, a].map((t) => ({ task: t, isOpen: true })),
			iso("2026-09-20T00:00"),
			iso("2026-09-21T00:00"),
			DEFAULT_REMINDER_DEFAULTS,
		);
		expect(result.map((r) => r.task.title)).toEqual(["A", "B"]);
	});

	it("excludes closed tasks", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20T09:00") });
		const result = dueReminders(
			[{ task: t, isOpen: false }],
			iso("2026-09-20T00:00"),
			iso("2026-09-21T00:00"),
			DEFAULT_REMINDER_DEFAULTS,
		);
		expect(result).toEqual([]);
	});
});

describe("toPushMessage", () => {
	it("uses the task title", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20T15:00") });
		const message = toPushMessage(t, onlyReminder(t));
		expect(message.title).toBe("Buy milk");
	});

	it("carries the task path", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20T15:00") });
		const message = toPushMessage(t, onlyReminder(t));
		expect(message.path).toBe(t.path);
	});

	it.each([
		["normal", 3],
		["high", 4],
		["urgent", 5],
	] as const)("maps priority %s to ntfy priority %i", (priority, expected) => {
		const t = task({ title: "Buy milk", due: date("2026-09-20T15:00"), priority });
		expect(toPushMessage(t, onlyReminder(t)).priority).toBe(expected);
	});

	it("always tags alarm_clock, no URL", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20T15:00") });
		const message = toPushMessage(t, onlyReminder(t));
		expect(message.tags).toEqual(["alarm_clock"]);
	});

	it('body: "Scheduled today HH:mm" when the anchor fires today', () => {
		const t = task({ title: "Buy milk", scheduled: date("2026-09-20T15:00") });
		const reminder = onlyReminder(t); // offset 0 -> fires exactly at the anchor, i.e. "today"
		expect(toPushMessage(t, reminder).body).toBe("Scheduled today 15:00");
	});

	it('body: "Due tomorrow" when the reminder fires the day before a date-only due', () => {
		const t = task({
			title: "Buy milk",
			due: date("2026-09-21"),
			remind: [{ kind: "offset", minutes: 60 * 24 }],
		});
		const reminder = onlyReminder(t);
		expect(reminder.at).toBe("2026-09-20T09:00"); // 09:00 default time of day, minus 1 day
		expect(toPushMessage(t, reminder).body).toBe("Due tomorrow");
	});

	it('body: "Due <d MMM>" for a reminder further out than tomorrow', () => {
		const t = task({
			title: "Buy milk",
			due: date("2026-09-24"),
			remind: [{ kind: "offset", minutes: 60 * 24 * 4 }],
		});
		const reminder = onlyReminder(t);
		expect(toPushMessage(t, reminder).body).toBe("Due 24 Sep");
	});

	it("appends the project when set", () => {
		const t = task({ title: "Buy milk", scheduled: date("2026-09-20T15:00"), project: "Groceries" });
		const message = toPushMessage(t, onlyReminder(t));
		expect(message.body).toBe("Scheduled today 15:00 · Groceries");
	});

	it("falls back to a bare 'Reminder' body for an absolute reminder with no due/scheduled", () => {
		const t = task({ title: "Buy milk", remind: [{ kind: "absolute", at: iso("2026-09-20T09:00") }] });
		const reminder = onlyReminder(t);
		expect(toPushMessage(t, reminder).body).toBe("Reminder today 09:00");
	});
});
