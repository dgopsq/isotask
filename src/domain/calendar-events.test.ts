import { describe, expect, it } from "vitest";

import type { CalendarEvent, CalendarEventsOptions } from "@/domain/calendar-events";
import { eventsForTask, sortCalendarEvents } from "@/domain/calendar-events";
import type { CalendarEventsSource } from "@/domain/calendar-view-options";
import type { TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import type { DotColor } from "@/domain/project-color";
import type { Minutes, RRuleString, Task, TaskPath } from "@/domain/task";

const NEUTRAL: DotColor = { kind: "neutral" };

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

function eventsFor(t: Task, source: CalendarEventsSource, dotColor: DotColor = NEUTRAL): readonly CalendarEvent[] {
	const options: CalendarEventsOptions = { source };
	return eventsForTask(t, options, dotColor);
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

		it("timed scheduled without duration -> all-day chip, start keeps its time, no end", () => {
			const [event] = eventsFor(task({ title: "T", scheduled: date("2026-09-05T09:00") }), "scheduled");
			expect(event).toMatchObject({ allDay: true, start: "2026-09-05T09:00" });
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

		it("timed due -> all-day chip, start keeps its time, no end (duration never applies to due)", () => {
			const [event] = eventsFor(task({ title: "T", due: date("2026-09-10T17:00") }), "due");
			expect(event).toMatchObject({ allDay: true, start: "2026-09-10T17:00" });
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

	describe("dotColor", () => {
		it("stamps the caller-supplied dotColor onto every event a task produces", () => {
			const dotColor: DotColor = { kind: "palette", name: "green" };
			const t = task({ title: "Both", due: date("2026-09-10"), scheduled: date("2026-09-05") });
			const events = eventsFor(t, "both", dotColor);
			expect(events).toHaveLength(2);
			for (const event of events) {
				expect(event.dotColor).toEqual(dotColor);
			}
		});

		it("defaults to neutral in this test file's eventsFor helper", () => {
			const [event] = eventsFor(task({ title: "T", due: date("2026-09-10") }), "due");
			expect(event?.dotColor).toEqual(NEUTRAL);
		});
	});
});

function calendarEvent(overrides: Partial<CalendarEvent> & { readonly id: string; readonly start: TaskDate }): CalendarEvent {
	return {
		taskPath: `${overrides.id}.md` as TaskPath,
		title: overrides.id,
		allDay: true,
		source: "due",
		priority: "normal",
		dotColor: NEUTRAL,
		...overrides,
	};
}

describe("sortCalendarEvents", () => {
	it("puts a date-only chip before a timed chip on the same day", () => {
		const timed = calendarEvent({ id: "timed", start: date("2026-09-04T09:00") });
		const dateOnly = calendarEvent({ id: "date-only", start: date("2026-09-04") });
		expect(sortCalendarEvents([timed, dateOnly]).map((e) => e.id)).toEqual(["date-only", "timed"]);
	});

	it("orders same-day timed chips by time of day", () => {
		const late = calendarEvent({ id: "late", start: date("2026-09-04T14:30") });
		const early = calendarEvent({ id: "early", start: date("2026-09-04T09:15") });
		const mid = calendarEvent({ id: "mid", start: date("2026-09-04T11:45") });
		expect(sortCalendarEvents([late, early, mid]).map((e) => e.id)).toEqual(["early", "mid", "late"]);
	});

	it("orders events on different days by date first, regardless of time of day", () => {
		const laterDayEarlyTime = calendarEvent({ id: "later-day", start: date("2026-09-05T00:01") });
		const earlierDayLateTime = calendarEvent({ id: "earlier-day", start: date("2026-09-04T23:59") });
		expect(sortCalendarEvents([laterDayEarlyTime, earlierDayLateTime]).map((e) => e.id)).toEqual([
			"earlier-day",
			"later-day",
		]);
	});

	it("breaks a same-start tie by title", () => {
		const b = calendarEvent({ id: "b-id", start: date("2026-09-04T09:00"), title: "Bravo" });
		const a = calendarEvent({ id: "a-id", start: date("2026-09-04T09:00"), title: "Alpha" });
		expect(sortCalendarEvents([b, a]).map((e) => e.title)).toEqual(["Alpha", "Bravo"]);
	});

	it("breaks a same-start-and-title tie by id, deterministically", () => {
		const two = calendarEvent({ id: "b", start: date("2026-09-04"), title: "Same" });
		const one = calendarEvent({ id: "a", start: date("2026-09-04"), title: "Same" });
		expect(sortCalendarEvents([two, one]).map((e) => e.id)).toEqual(["a", "b"]);
	});

	it("is stable for fully identical sort keys", () => {
		const first = calendarEvent({ id: "x", start: date("2026-09-04"), title: "Same" });
		const second = { ...first, source: "scheduled" } as CalendarEvent;
		expect(sortCalendarEvents([first, second])).toEqual([first, second]);
	});

	it("does not mutate the input array and returns a new one", () => {
		const events = [calendarEvent({ id: "b", start: date("2026-09-05") }), calendarEvent({ id: "a", start: date("2026-09-04") })];
		const original = [...events];
		const sorted = sortCalendarEvents(events);
		expect(events).toEqual(original);
		expect(sorted).not.toBe(events);
	});

	it("returns an empty array unchanged", () => {
		expect(sortCalendarEvents([])).toEqual([]);
	});
});
