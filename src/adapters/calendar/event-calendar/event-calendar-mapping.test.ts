import { describe, expect, it } from "vitest";

import { toEventCalendarEvent, toEventCalendarFirstDay, toEventCalendarView } from "@/adapters/calendar/event-calendar/event-calendar-mapping";
import type { CalendarEvent } from "@/domain/calendar-events";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import type { TaskDate, Weekday } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import type { TaskPath } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

function event(overrides: Partial<CalendarEvent> & { readonly start: TaskDate }): CalendarEvent {
	return {
		id: "Task.md#due",
		taskPath: "Task.md" as TaskPath,
		title: "Task",
		allDay: true,
		source: "due",
		priority: "normal",
		...overrides,
	};
}

describe("toEventCalendarView", () => {
	it.each([
		["day", "timeGridDay"],
		["week", "timeGridWeek"],
		["month", "dayGridMonth"],
		["list", "listWeek"],
	] as const satisfies readonly (readonly [CalendarViewKind, string])[])("maps %s to %s", (kind, expected) => {
		expect(toEventCalendarView(kind)).toBe(expected);
	});
});

describe("toEventCalendarFirstDay", () => {
	// Domain Weekday is Monday-first (0=Mon..6=Sun); Event Calendar's
	// firstDay is Sunday-first (0=Sun..6=Sat) — same convention as
	// `domain/dates.ts#toSundayFirstWeekday`, which this reuses.
	it.each([
		[0, 1],
		[3, 4],
		[6, 0],
	] as const satisfies readonly (readonly [Weekday, number])[])("maps Weekday %i to firstDay %i", (firstDay, expected) => {
		expect(toEventCalendarFirstDay(firstDay)).toBe(expected);
	});
});

describe("toEventCalendarEvent", () => {
	it("maps a date-only all-day event with no end", () => {
		const input = event({ start: date("2026-09-10"), allDay: true });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.id).toBe(input.id);
		expect(mapped.title).toBe(input.title);
		expect(mapped.allDay).toBe(true);
		expect(mapped.start).toEqual(mapped.end);
	});

	it("falls back end to start when the domain event has no end (point-in-time marker)", () => {
		const input = event({ start: date("2026-09-10T17:00"), allDay: false });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.start).toBeInstanceOf(Date);
		expect(mapped.end).toEqual(mapped.start);
	});

	it("uses the domain event's own end when present (timed block with duration)", () => {
		const input = event({ start: date("2026-09-10T09:00"), end: date("2026-09-10T09:30"), allDay: false });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.start).not.toEqual(mapped.end);
	});

	it("builds classNames from source and priority", () => {
		const input = event({ start: date("2026-09-10"), source: "scheduled", priority: "urgent" });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.classNames).toEqual(["obtask-event", "obtask-event--scheduled", "obtask-priority-urgent"]);
	});

	it("prefixes the due source class distinctly from scheduled", () => {
		const input = event({ start: date("2026-09-10"), source: "due" });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.classNames).toContain("obtask-event--due");
	});
});
