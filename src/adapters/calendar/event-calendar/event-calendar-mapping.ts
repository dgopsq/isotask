import type { Calendar } from "@event-calendar/core";

import type { CalendarEvent } from "@/domain/calendar-events";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import type { Weekday } from "@/domain/dates";
import { formatTime, isDateTime, toJsDate, toSundayFirstWeekday } from "@/domain/dates";
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
 * optional (a zero-duration `due`/`scheduled` point event, rendered as an
 * all-day chip rather than a time-grid block — ADR 0011) — falls back to
 * `start`, rendering as a zero-duration event.
 *
 * A zero-duration point event's `start` keeps its time-of-day even though
 * it's `allDay` (`calendar-events.ts`), so the all-day row can't show it —
 * it's prefixed onto the title instead (`"09:00 Budget report"`) so the
 * time isn't lost. A genuinely date-only all-day event (a plain `IsoDate`
 * `start`) gets no prefix.
 */
export function toEventCalendarEvent(event: CalendarEvent): Calendar.EventInput {
	const start = toJsDate(event.start);
	const end = event.end === undefined ? start : toJsDate(event.end);
	const title = event.allDay && isDateTime(event.start) ? `${formatTime(event.start)} ${event.title}` : event.title;
	return {
		id: event.id,
		title,
		start,
		end,
		allDay: event.allDay,
		classNames: [cssClass("event"), cssClass(`event--${event.source}`), cssClass(priorityChipClass(event.priority))],
	};
}
