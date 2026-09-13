import { describe, expect, it } from "vitest";

import {
	fromEventCalendarDate,
	fromEventCalendarDrop,
	fromEventCalendarView,
	hexDotColorOf,
	isIsotaskEventExtendedProps,
	toEventCalendarEvent,
	toEventCalendarFirstDay,
	toEventCalendarView,
} from "@/adapters/calendar/event-calendar/event-calendar-mapping";
import type { CalendarEvent } from "@/domain/calendar-events";
import { DEFAULT_CALENDAR_VIEW_OPTIONS } from "@/domain/calendar-view-options";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import type { TaskDate, Weekday } from "@/domain/dates";
import { parseTaskDate, toJsDate } from "@/domain/dates";
import type { DotColor } from "@/domain/project-color";
import type { TaskPath } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

const NEUTRAL: DotColor = { kind: "neutral" };

function event(overrides: Partial<CalendarEvent> & { readonly start: TaskDate }): CalendarEvent {
	return {
		id: "Task.md#due",
		taskPath: "Task.md" as TaskPath,
		title: "Task",
		allDay: true,
		source: "due",
		priority: "normal",
		dotColor: NEUTRAL,
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

describe("fromEventCalendarView", () => {
	it.each([
		["timeGridDay", "day"],
		["timeGridWeek", "week"],
		["dayGridMonth", "month"],
	] as const satisfies readonly (readonly [string, CalendarViewKind])[])("maps %s to %s", (view, expected) => {
		expect(fromEventCalendarView(view)).toBe(expected);
	});

	it.each([undefined, "", "bogus", "dayGridWeek"])("falls back to the default initial view for %p", (view) => {
		expect(fromEventCalendarView(view)).toBe(DEFAULT_CALENDAR_VIEW_OPTIONS.initialView);
	});

	it("round-trips every CalendarViewKind through toEventCalendarView", () => {
		const kinds: readonly CalendarViewKind[] = ["day", "week", "month"];
		for (const kind of kinds) {
			expect(fromEventCalendarView(toEventCalendarView(kind))).toBe(kind);
		}
	});
});

describe("fromEventCalendarDate", () => {
	it("reads year/month/day off a real Date", () => {
		expect(fromEventCalendarDate(new Date(2026, 8, 13))).toBe("2026-09-13");
	});

	it("falls back to today (not a throw) when given something other than a Date", () => {
		expect(fromEventCalendarDate(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
		expect(mapped.classNames).toEqual(["isotask-event", "isotask-event--scheduled", "isotask-priority-urgent"]);
	});

	it("prefixes the due source class distinctly from scheduled", () => {
		const input = event({ start: date("2026-09-10"), source: "due" });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.classNames).toContain("isotask-event--due");
	});

	describe("dotColor classNames", () => {
		it("appends no class for a neutral dotColor", () => {
			const input = event({ start: date("2026-09-10"), dotColor: { kind: "neutral" } });
			const mapped = toEventCalendarEvent(input);
			expect(mapped.classNames).toEqual(["isotask-event", "isotask-event--due", "isotask-priority-normal"]);
		});

		it("appends an isotask-color-<name> class for a palette dotColor", () => {
			const input = event({ start: date("2026-09-10"), dotColor: { kind: "palette", name: "green" } });
			const mapped = toEventCalendarEvent(input);
			expect(mapped.classNames).toContain("isotask-color-green");
		});

		it("appends no class for a hex dotColor — relayed via extendedProps.hexDotColor instead (see the doc comment)", () => {
			const input = event({ start: date("2026-09-10"), dotColor: { kind: "hex", value: "#a1b2c3" } });
			const mapped = toEventCalendarEvent(input);
			expect(mapped.classNames).toEqual(["isotask-event", "isotask-event--due", "isotask-priority-normal"]);
		});
	});

	describe("extendedProps.hexDotColor", () => {
		it("is set to the hex value for a hex dotColor", () => {
			const input = event({ start: date("2026-09-10"), dotColor: { kind: "hex", value: "#a1b2c3" } });
			const mapped = toEventCalendarEvent(input);
			expect(mapped.extendedProps).toMatchObject({ hexDotColor: "#a1b2c3" });
		});

		it("is absent for a palette dotColor", () => {
			const input = event({ start: date("2026-09-10"), dotColor: { kind: "palette", name: "green" } });
			const mapped = toEventCalendarEvent(input);
			expect(mapped.extendedProps).toEqual({ priority: "normal" });
		});

		it("is absent for a neutral dotColor", () => {
			const input = event({ start: date("2026-09-10"), dotColor: { kind: "neutral" } });
			const mapped = toEventCalendarEvent(input);
			expect(mapped.extendedProps).toEqual({ priority: "normal" });
		});
	});

	it("keeps the title unprefixed and sets isotaskTime for a timed all-day point event", () => {
		const input = event({ start: date("2026-09-10T09:00"), allDay: true, title: "Budget report" });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.title).toBe("Budget report");
		expect(mapped.extendedProps).toEqual({ isotaskTime: "09:00", priority: "normal" });
	});

	it("does not set isotaskTime for a date-only all-day event", () => {
		const input = event({ start: date("2026-09-10"), allDay: true, title: "Budget report" });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.title).toBe("Budget report");
		expect(mapped.extendedProps).toEqual({ priority: "normal" });
	});

	it("does not set isotaskTime for a timed block (not all-day)", () => {
		const input = event({ start: date("2026-09-10T09:00"), end: date("2026-09-10T09:30"), allDay: false, title: "Team sync" });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.title).toBe("Team sync");
		expect(mapped.extendedProps).toEqual({ priority: "normal" });
	});

	it("always sets extendedProps.priority, regardless of allDay/timed shape", () => {
		const input = event({ start: date("2026-09-10T09:00"), end: date("2026-09-10T09:30"), allDay: false, priority: "urgent" });
		const mapped = toEventCalendarEvent(input);
		expect(mapped.extendedProps).toEqual({ priority: "urgent" });
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

describe("hexDotColorOf", () => {
	// Backs `event-calendar-renderer.ts`'s stale-hex repaint fix: `setEvents`
	// looks this up per mounted element on every data update, so a project's
	// color changing hex -> hex, hex -> palette, or hex -> neutral all need
	// the right answer here for that element to repaint correctly.
	it("returns the hex value for a hex dotColor", () => {
		const input = event({ start: date("2026-09-10"), dotColor: { kind: "hex", value: "#a1b2c3" } });
		expect(hexDotColorOf(input)).toBe("#a1b2c3");
	});

	it("returns undefined for a palette dotColor", () => {
		const input = event({ start: date("2026-09-10"), dotColor: { kind: "palette", name: "green" } });
		expect(hexDotColorOf(input)).toBeUndefined();
	});

	it("returns undefined for a neutral dotColor", () => {
		const input = event({ start: date("2026-09-10"), dotColor: { kind: "neutral" } });
		expect(hexDotColorOf(input)).toBeUndefined();
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

	it("converts an all-day due chip dragged into the time grid, writing the dropped date and time (ADR 0011 — it re-renders as an all-day chip carrying the new time)", () => {
		const input = event({ start: date("2026-09-10"), allDay: true, source: "due" });
		const result = fromEventCalendarDrop(input, {
			start: toJsDate(date("2026-09-12T14:00")),
			end: toJsDate(date("2026-09-12T14:00")),
			allDay: false,
		});
		expect(result.start).toBe("2026-09-12T14:00");
		expect(result.end).toBeUndefined();
	});
});

describe("isIsotaskEventExtendedProps", () => {
	it("accepts an object with no isotaskTime key", () => {
		expect(isIsotaskEventExtendedProps({})).toBe(true);
	});

	it("accepts an object with a string isotaskTime", () => {
		expect(isIsotaskEventExtendedProps({ isotaskTime: "09:00" })).toBe(true);
	});

	it("rejects an object with a non-string isotaskTime", () => {
		expect(isIsotaskEventExtendedProps({ isotaskTime: 900 })).toBe(false);
	});

	it("accepts an object with a valid priority", () => {
		expect(isIsotaskEventExtendedProps({ priority: "urgent" })).toBe(true);
	});

	it("rejects an object with an unrecognized priority string", () => {
		expect(isIsotaskEventExtendedProps({ priority: "low" })).toBe(false);
	});

	it("rejects an object with a non-string priority", () => {
		expect(isIsotaskEventExtendedProps({ priority: 1 })).toBe(false);
	});

	it("rejects non-object values", () => {
		expect(isIsotaskEventExtendedProps(null)).toBe(false);
		expect(isIsotaskEventExtendedProps("09:00")).toBe(false);
		expect(isIsotaskEventExtendedProps(undefined)).toBe(false);
	});

	it("accepts an object with a string hexDotColor", () => {
		expect(isIsotaskEventExtendedProps({ hexDotColor: "#a1b2c3" })).toBe(true);
	});

	it("rejects an object with a non-string hexDotColor", () => {
		expect(isIsotaskEventExtendedProps({ hexDotColor: 123 })).toBe(false);
	});
});
