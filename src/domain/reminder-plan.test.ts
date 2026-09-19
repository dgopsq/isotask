import { describe, expect, it, vi } from "vitest";

vi.stubEnv("TZ", "Europe/Rome");

import type { IsoDateTime, TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { dueReminders, planReminders, toPushMessage } from "@/domain/reminder-plan";
import type { KnownReminder, PushMessage } from "@/domain/reminder-plan";
import { DEFAULT_REMINDER_DEFAULTS, reminderTimes } from "@/domain/reminders";
import type { ReminderId, ReminderInstance } from "@/domain/reminders";
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

function pushMessage(id: string, at: IsoDateTime): PushMessage {
	return {
		id: id as ReminderId,
		path: "task.md" as TaskPath,
		at,
		title: "Task",
		body: "Body",
		priority: 3,
		tags: [],
	};
}

function knownReminder(id: string, at: IsoDateTime): KnownReminder {
	return { id: id as ReminderId, at };
}

describe("planReminders", () => {
	it("publishes every desired message when known is empty", () => {
		const now = iso("2026-09-20T09:00");
		const delayed = pushMessage("isotask-1", iso("2026-09-21T09:00"));
		const immediate = pushMessage("isotask-2", iso("2026-09-20T09:00"));
		const plan = planReminders([delayed, immediate], [], now);
		expect(plan.publish[0]).toEqual({ message: delayed, delayUntil: delayed.at });
		expect(plan.publish[1]).not.toHaveProperty("delayUntil");
		expect(plan.publish[1]?.message).toEqual(immediate);
	});

	it("does not publish a delayed message already known at the same time", () => {
		const now = iso("2026-09-20T09:00");
		const message = pushMessage("isotask-1", iso("2026-09-21T09:00"));
		const plan = planReminders([message], [knownReminder("isotask-1", iso("2026-09-21T09:00"))], now);
		expect(plan.publish).toEqual([]);
		expect(plan.cancel).toEqual([]);
	});

	it("republishes with the new delayUntil when the anchor moved", () => {
		const now = iso("2026-09-20T09:00");
		const message = pushMessage("isotask-1", iso("2026-09-20T11:00"));
		const plan = planReminders([message], [knownReminder("isotask-1", iso("2026-09-20T10:00"))], now);
		expect(plan.publish).toEqual([{ message, delayUntil: iso("2026-09-20T11:00") }]);
	});

	it("cancels a known future reminder that is no longer desired", () => {
		const now = iso("2026-09-20T09:00");
		const plan = planReminders([], [knownReminder("isotask-1", iso("2026-09-21T09:00"))], now);
		expect(plan.cancel).toEqual(["isotask-1" as ReminderId]);
		expect(plan.publish).toEqual([]);
	});

	it("does not cancel an already-delivered reminder", () => {
		const now = iso("2026-09-20T09:00");
		const plan = planReminders([], [knownReminder("isotask-1", iso("2026-09-20T08:00"))], now);
		expect(plan.cancel).toEqual([]);
	});

	it("ignores a foreign (non-isotask) known id for cancellation", () => {
		const now = iso("2026-09-20T09:00");
		const plan = planReminders([], [knownReminder("abc123", iso("2026-09-21T09:00"))], now);
		expect(plan.cancel).toEqual([]);
	});

	it("still publishes a desired message whose id matches a foreign known entry", () => {
		const now = iso("2026-09-20T09:00");
		const message = pushMessage("abc123", iso("2026-09-21T09:00"));
		const plan = planReminders([message], [knownReminder("abc123", iso("2026-09-21T09:00"))], now);
		expect(plan.publish).toEqual([{ message, delayUntil: message.at }]);
	});

	it("treats an exact cutoff match (now + 1 min) as immediate, one minute later as delayed", () => {
		const now = iso("2026-09-20T09:00");
		const atCutoff = pushMessage("isotask-1", iso("2026-09-20T09:01"));
		const afterCutoff = pushMessage("isotask-2", iso("2026-09-20T09:02"));
		const plan = planReminders([atCutoff, afterCutoff], [], now);
		expect(plan.publish[0]).not.toHaveProperty("delayUntil");
		expect(plan.publish[1]).toEqual({ message: afterCutoff, delayUntil: afterCutoff.at });
	});

	it("treats a same-minute catch-up publish as satisfied", () => {
		const now = iso("2026-09-20T09:20");
		const message = pushMessage("isotask-1", iso("2026-09-20T09:00"));
		const plan = planReminders([message], [knownReminder("isotask-1", iso("2026-09-20T09:20"))], now);
		expect(plan.publish).toEqual([]);
	});

	it("republishes an immediate reminder when the known publish was for a previous day", () => {
		const now = iso("2026-09-20T09:20");
		const message = pushMessage("isotask-1", iso("2026-09-20T09:00"));
		const plan = planReminders([message], [knownReminder("isotask-1", iso("2026-09-19T09:00"))], now);
		expect(plan.publish).toEqual([{ message }]);
	});

	it("publishes immediately when the known entry is scheduled for a later time, and does not cancel it", () => {
		const now = iso("2026-09-20T09:05");
		const message = pushMessage("isotask-1", iso("2026-09-20T09:00"));
		const laterKnown = knownReminder("isotask-1", iso("2026-09-20T10:00"));
		const plan = planReminders([message], [laterKnown], now);
		expect(plan.publish).toEqual([{ message }]);
		expect(plan.cancel).toEqual([]);
	});

	it("returns an empty plan for no desired and no known reminders", () => {
		const plan = planReminders([], [], iso("2026-09-20T09:00"));
		expect(plan).toEqual({ publish: [], cancel: [] });
	});

	it("preserves desired order in publish", () => {
		const now = iso("2026-09-20T09:00");
		const c = pushMessage("isotask-3", iso("2026-09-22T09:00"));
		const a = pushMessage("isotask-1", iso("2026-09-20T09:00"));
		const b = pushMessage("isotask-2", iso("2026-09-21T09:00"));
		const plan = planReminders([c, a, b], [], now);
		expect(plan.publish.map((p) => p.message.id)).toEqual([c.id, a.id, b.id]);
	});
});
