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
 * Extended props this adapter attaches to every Event Calendar event, read
 * back by `event-content.ts`'s `eventContent` function. Kept to a single
 * optional field (rather than reusing `CalendarEvent` wholesale) since
 * that's all the custom rendering needs — the domain event itself isn't
 * otherwise available inside `eventContent` (`Calendar.EventContentInfo`
 * only carries Event Calendar's own `Event` shape).
 */
export interface ObtaskEventExtendedProps {
	readonly obtaskTime?: string;
}

/** Type guard for reading `Calendar.Event["extendedProps"]` (`Record<string, unknown>`) back out as `ObtaskEventExtendedProps`. */
export function isObtaskEventExtendedProps(value: unknown): value is ObtaskEventExtendedProps {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const obtaskTime: unknown = (value as Record<string, unknown>)["obtaskTime"];
	return obtaskTime === undefined || typeof obtaskTime === "string";
}

/**
 * Domain `CalendarEvent` -> Event Calendar's `EventInput`. `end` is
 * mandatory on `EventInput` even though the domain type's `end` is
 * optional (a zero-duration `due`/`scheduled` point event, rendered as an
 * all-day chip rather than a time-grid block — ADR 0011) — falls back to
 * `start`, rendering as a zero-duration event.
 *
 * A zero-duration point event's `start` keeps its time-of-day even though
 * it's `allDay` (`calendar-events.ts`), so the all-day row can't show it on
 * the grid — its time is passed through `extendedProps.obtaskTime` instead,
 * rendered as a separate muted label in front of the title by
 * `event-content.ts`'s `eventContent`. A genuinely date-only all-day event
 * (a plain `IsoDate` `start`) carries no `obtaskTime`.
 */
export function toEventCalendarEvent(event: CalendarEvent): Calendar.EventInput {
	const start = toJsDate(event.start);
	const end = event.end === undefined ? start : toJsDate(event.end);
	const timedAllDay = event.allDay && isDateTime(event.start);
	// Typed as `Record<string, unknown>` (rather than `ObtaskEventExtendedProps`)
	// to match `Calendar.EventInput["extendedProps"]`'s own type exactly —
	// `ObtaskEventExtendedProps` is for the read side (`isObtaskEventExtendedProps`
	// below), which narrows the untyped `unknown` Event Calendar hands back.
	const extendedProps: Record<string, unknown> = timedAllDay ? { obtaskTime: formatTime(event.start) } : {};
	return {
		id: event.id,
		title: event.title,
		start,
		end,
		allDay: event.allDay,
		extendedProps,
		classNames: [cssClass("event"), cssClass(`event--${event.source}`), cssClass(priorityChipClass(event.priority))],
	};
}
