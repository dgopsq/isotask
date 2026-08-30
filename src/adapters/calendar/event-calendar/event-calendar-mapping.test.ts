import { describe, expect, it } from "vitest";

import {
	fromEventCalendarDrop,
	isObtaskEventExtendedProps,
	toEventCalendarEvent,
	toEventCalendarFirstDay,
	toEventCalendarView,
} from "@/adapters/calendar/event-calendar/event-calendar-mapping";
import type { CalendarEvent } from "@/domain/calendar-events";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import type { TaskDate, Weekday } from "@/domain/dates";
import { parseTaskDate, toJsDate } from "@/domain/dates";
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

	it("keeps the title unprefixed and sets obtaskTime for a timed all-day point event", () => {
		const input = event({ start: date("2026-09-10T09:00"), allDay: true, title: "Budget report" });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.title).toBe("Budget report");
		expect(mapped.extendedProps).toEqual({ obtaskTime: "09:00" });
	});

	it("does not set obtaskTime for a date-only all-day event", () => {
		const input = event({ start: date("2026-09-10"), allDay: true, title: "Budget report" });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.title).toBe("Budget report");
		expect(mapped.extendedProps).toEqual({});
	});

	it("does not set obtaskTime for a timed block (not all-day)", () => {
		const input = event({ start: date("2026-09-10T09:00"), end: date("2026-09-10T09:30"), allDay: false, title: "Team sync" });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.title).toBe("Team sync");
		expect(mapped.extendedProps).toEqual({});
	});

	it("marks an all-day chip's duration as not editable (no end-date property to resize into)", () => {
		const input = event({ start: date("2026-09-10"), allDay: true });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.durationEditable).toBe(false);
	});

	it("keeps a timed block's duration editable (resize handle changes `duration` minutes)", () => {
		const input = event({ start: date("2026-09-10T09:00"), end: date("2026-09-10T09:30"), allDay: false });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.durationEditable).toBe(true);
	});
});

describe("fromEventCalendarDrop", () => {
	it("converts a timed block moved within the time grid (start and end both convert)", () => {
		const input = event({ start: date("2026-09-10T09:00"), end: date("2026-09-10T09:30"), allDay: false });
		const result = fromEventCalendarDrop(input, {
			start: toJsDate(date("2026-09-11T10:00")),
			end: toJsDate(date("2026-09-11T10:30")),
			allDay: false,
		});
		expect(result.start).toBe("2026-09-11T10:00");
		expect(result.end).toBe("2026-09-11T10:30");
	});

	it("converts a timed block resized to a later end", () => {
		const input = event({ start: date("2026-09-10T09:00"), end: date("2026-09-10T09:30"), allDay: false });
		const result = fromEventCalendarDrop(input, {
			start: toJsDate(date("2026-09-10T09:00")),
			end: toJsDate(date("2026-09-10T10:00")),
			allDay: false,
		});
		expect(result.start).toBe("2026-09-10T09:00");
		expect(result.end).toBe("2026-09-10T10:00");
	});

	it("drops a zero-length move as end: undefined (not a fabricated duration)", () => {
		const input = event({ start: date("2026-09-10T09:00"), allDay: false });
		const result = fromEventCalendarDrop(input, {
			start: toJsDate(date("2026-09-11T09:00")),
			end: toJsDate(date("2026-09-11T09:00")),
			allDay: false,
		});
		expect(result.start).toBe("2026-09-11T09:00");
		expect(result.end).toBeUndefined();
	});

	it("drags a date-only chip into the all-day row and keeps it date-only", () => {
		const input = event({ start: date("2026-09-10"), allDay: true });
		const result = fromEventCalendarDrop(input, {
			start: toJsDate(date("2026-09-15")),
			end: toJsDate(date("2026-09-15")),
			allDay: true,
		});
		expect(result.start).toBe("2026-09-15");
		expect(result.end).toBeUndefined();
	});

	it("drags an ADR-0011 timed all-day chip to another day and keeps its time-of-day", () => {
		const input = event({ start: date("2026-09-10T14:30"), allDay: true });
		const result = fromEventCalendarDrop(input, {
			start: toJsDate(date("2026-09-15")),
			end: toJsDate(date("2026-09-15")),
			allDay: true,
		});
		expect(result.start).toBe("2026-09-15T14:30");
		expect(result.end).toBeUndefined();
	});

	it("changes kind to date-only when a date-only chip is what got dropped as all-day (no time to keep)", () => {
		const input = event({ start: date("2026-09-10"), allDay: true });
		const result = fromEventCalendarDrop(input, {
			start: toJsDate(date("2026-09-16")),
			end: toJsDate(date("2026-09-16")),
			allDay: true,
		});
		expect(result.start).toBe("2026-09-16");
	});

	it("converts a timed block dragged up into the all-day row, dropping its time-grid end", () => {
		const input = event({ start: date("2026-09-10T09:00"), end: date("2026-09-10T09:30"), allDay: false });
		const result = fromEventCalendarDrop(input, {
			start: toJsDate(date("2026-09-12")),
			end: toJsDate(date("2026-09-12")),
			allDay: true,
		});
		expect(result.start).toBe("2026-09-12T09:00");
		expect(result.end).toBeUndefined();
	});
});

describe("isObtaskEventExtendedProps", () => {
	it("accepts an object with no obtaskTime key", () => {
		expect(isObtaskEventExtendedProps({})).toBe(true);
	});

	it("accepts an object with a string obtaskTime", () => {
		expect(isObtaskEventExtendedProps({ obtaskTime: "09:00" })).toBe(true);
	});

	it("rejects an object with a non-string obtaskTime", () => {
		expect(isObtaskEventExtendedProps({ obtaskTime: 900 })).toBe(false);
	});

	it("rejects non-object values", () => {
		expect(isObtaskEventExtendedProps(null)).toBe(false);
		expect(isObtaskEventExtendedProps("09:00")).toBe(false);
		expect(isObtaskEventExtendedProps(undefined)).toBe(false);
	});
});
