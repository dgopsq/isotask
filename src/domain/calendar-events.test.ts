import { describe, expect, it } from "vitest";

import type { CalendarEvent, CalendarEventsOptions } from "@/domain/calendar-events";
import { eventsForTask } from "@/domain/calendar-events";
import type { CalendarEventsSource } from "@/domain/calendar-view-options";
import type { TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import type { Minutes, RRuleString, Task, TaskPath } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

function rule(body: string): RRuleString {
	return body as RRuleString;
}

function task(overrides: Partial<Task> & { readonly title: string }): Task {
	return {
		path: `${overrides.title}.md` as TaskPath,
		status: "todo" as Task["status"],
		priority: "normal",
		tags: [],
		...overrides,
	};
}

function eventsFor(t: Task, source: CalendarEventsSource): readonly CalendarEvent[] {
	const options: CalendarEventsOptions = { source };
	return eventsForTask(t, options);
}

describe("eventsForTask", () => {
	it("returns no events for a task with neither due nor scheduled", () => {
		expect(eventsFor(task({ title: "Bare" }), "both")).toEqual([]);
	});

	describe("events option filters which dates are emitted", () => {
		const t = task({ title: "Both dates", due: date("2026-09-10"), scheduled: date("2026-09-05") });

		it("both -> up to two events", () => {
			const events = eventsFor(t, "both");
			expect(events).toHaveLength(2);
			expect(events.map((e) => e.source).sort()).toEqual(["due", "scheduled"]);
		});

		it("due -> only the due event, even when scheduled is set", () => {
			const events = eventsFor(t, "due");
			expect(events).toHaveLength(1);
			expect(events[0]?.source).toBe("due");
		});

		it("scheduled -> only the scheduled event, even when due is set", () => {
			const events = eventsFor(t, "scheduled");
			expect(events).toHaveLength(1);
			expect(events[0]?.source).toBe("scheduled");
		});

		it("due -> no event when due is unset", () => {
			expect(eventsFor(task({ title: "No due", scheduled: date("2026-09-05") }), "due")).toEqual([]);
		});

		it("scheduled -> no event when scheduled is unset", () => {
			expect(eventsFor(task({ title: "No scheduled", due: date("2026-09-05") }), "scheduled")).toEqual([]);
		});
	});

	describe("scheduled event", () => {
		it("date-only scheduled -> all-day, no end", () => {
			const [event] = eventsFor(task({ title: "T", scheduled: date("2026-09-05") }), "scheduled");
			expect(event).toMatchObject({ allDay: true, start: "2026-09-05", source: "scheduled" });
			expect(event?.end).toBeUndefined();
		});

		it("timed scheduled with duration -> timed block, end = start + duration", () => {
			const [event] = eventsFor(
				task({ title: "T", scheduled: date("2026-09-05T09:00"), duration: 30 as Minutes }),
				"scheduled",
			);
			expect(event).toMatchObject({ allDay: false, start: "2026-09-05T09:00", end: "2026-09-05T09:30" });
		});

		it("timed scheduled without duration -> timed point-in-time marker, no end", () => {
			const [event] = eventsFor(task({ title: "T", scheduled: date("2026-09-05T09:00") }), "scheduled");
			expect(event).toMatchObject({ allDay: false, start: "2026-09-05T09:00" });
			expect(event?.end).toBeUndefined();
		});

		it("date-only scheduled with duration set -> still all-day, duration ignored", () => {
			const [event] = eventsFor(task({ title: "T", scheduled: date("2026-09-05"), duration: 30 as Minutes }), "scheduled");
			expect(event).toMatchObject({ allDay: true });
			expect(event?.end).toBeUndefined();
		});
	});

	describe("due event", () => {
		it("date-only due -> all-day, no end", () => {
			const [event] = eventsFor(task({ title: "T", due: date("2026-09-10") }), "due");
			expect(event).toMatchObject({ allDay: true, start: "2026-09-10", source: "due" });
			expect(event?.end).toBeUndefined();
		});

		it("timed due -> timed point-in-time marker, no end (duration never applies to due)", () => {
			const [event] = eventsFor(task({ title: "T", due: date("2026-09-10T17:00") }), "due");
			expect(event).toMatchObject({ allDay: false, start: "2026-09-10T17:00" });
			expect(event?.end).toBeUndefined();
		});
	});

	it("carries title, taskPath and priority through onto each event", () => {
		const t = task({ title: "Ship it", due: date("2026-09-10"), priority: "urgent" });
		const [event] = eventsFor(t, "due");
		expect(event).toMatchObject({ title: "Ship it", taskPath: t.path, priority: "urgent" });
	});

	describe("id", () => {
		it("is stable and deterministic for the same task+source", () => {
			const t = task({ title: "Stable", due: date("2026-09-10") });
			expect(eventsFor(t, "due")[0]?.id).toBe(eventsFor(t, "due")[0]?.id);
		});

		it("is unique across the due and scheduled events of the same task", () => {
			const t = task({ title: "Both", due: date("2026-09-10"), scheduled: date("2026-09-05") });
			const [a, b] = eventsFor(t, "both");
			expect(a?.id).not.toBe(b?.id);
		});

		it("is unique across two different tasks with the same source", () => {
			const a = eventsFor(task({ title: "A", due: date("2026-09-10") }), "due")[0];
			const b = eventsFor(task({ title: "B", due: date("2026-09-10") }), "due")[0];
			expect(a?.id).not.toBe(b?.id);
		});
	});

	it("ignores repeat entirely — no expansion into future occurrences", () => {
		const t = task({
			title: "Recurs",
			due: date("2026-09-10"),
			repeat: rule("FREQ=WEEKLY;BYDAY=MO"),
		});
		expect(eventsFor(t, "due")).toHaveLength(1);
	});
});
