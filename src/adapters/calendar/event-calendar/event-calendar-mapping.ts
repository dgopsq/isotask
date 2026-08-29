import type { Calendar } from "@event-calendar/core";

import type { CalendarEvent } from "@/domain/calendar-events";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import type { Weekday } from "@/domain/dates";
import { toJsDate, toSundayFirstWeekday } from "@/domain/dates";
import { priorityChipClass } from "@/domain/task";
import { cssClass } from "@/plugin-id";

/**
 * Pure mapping helpers backing `event-calendar-renderer.ts`. Kept free of
 * `createCalendar`/`destroyCalendar` calls (which need a real DOM `Element`,
 * unavailable under vitest's `node` environment) so they can be unit-tested
 * directly — mirrors `adapters/obsidian/task-store-helpers.ts`.
 */

/** Renderer-agnostic `CalendarViewKind` -> Event Calendar's own view name. */
export function toEventCalendarView(kind: CalendarViewKind): string {
	switch (kind) {
		case "day":
			return "timeGridDay";
		case "week":
			return "timeGridWeek";
		case "month":
			return "dayGridMonth";
		case "list":
			return "listWeek";
		default: {
			const exhaustive: never = kind;
			return exhaustive;
		}
	}
}

/**
 * Domain `Weekday` (0=Mon..6=Sun) -> Event Calendar's `firstDay`
 * (0=Sun..6=Sat). Same conversion `domain/dates.ts` already does for
 * `date-fns`'s `weekStartsOn` — reused rather than duplicated.
 */
export function toEventCalendarFirstDay(firstDay: Weekday): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
	return toSundayFirstWeekday(firstDay);
}

/**
 * Domain `CalendarEvent` -> Event Calendar's `EventInput`. `end` is
 * mandatory on `EventInput` even though the domain type's `end` is
 * optional (a point-in-time `due`/`scheduled` marker with no duration) —
 * falls back to `start`, rendering as a zero-duration event.
 */
export function toEventCalendarEvent(event: CalendarEvent): Calendar.EventInput {
	const start = toJsDate(event.start);
	const end = event.end === undefined ? start : toJsDate(event.end);
	return {
		id: event.id,
		title: event.title,
		start,
		end,
		allDay: event.allDay,
		classNames: [cssClass("event"), cssClass(`event--${event.source}`), cssClass(priorityChipClass(event.priority))],
	};
}
