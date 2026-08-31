import type { Calendar } from "@event-calendar/core";

import type { CalendarEvent } from "@/domain/calendar-events";
import { DEFAULT_CALENDAR_VIEW_OPTIONS } from "@/domain/calendar-view-options";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import type { TaskDate, Weekday } from "@/domain/dates";
import { formatTime, fromJsDate, fromJsDateTime, isDateTime, toJsDate, toSundayFirstWeekday, withDatePart } from "@/domain/dates";
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
 * Event Calendar's own view name -> renderer-agnostic `CalendarViewKind` —
 * the reverse of `toEventCalendarView`, backing `CalendarHandle.getView`
 * (`event-calendar-renderer.ts` calls this on `calendar.getOption("view")`).
 * Total: `calendar.getOption("view")` is typed as a bare `string | undefined`
 * by the vendored library (nothing statically guarantees it's one of the
 * three names this adapter ever sets), so an unrecognised or missing value
 * falls back to `DEFAULT_CALENDAR_VIEW_OPTIONS.initialView` ("month") —
 * the same default `domain/calendar-view-options.ts#parseCalendarViewOptions`
 * uses for a malformed Bases config, so a value this function can't place
 * degrades exactly the way the rest of the plugin already treats "unknown".
 */
export function fromEventCalendarView(view: string | undefined): CalendarViewKind {
	switch (view) {
		case "timeGridDay":
			return "day";
		case "timeGridWeek":
			return "week";
		case "dayGridMonth":
			return "month";
		case undefined:
		default:
			return DEFAULT_CALENDAR_VIEW_OPTIONS.initialView;
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
		// Resizing an all-day chip would ask the user to give the task an end
		// *date*, and the data model has no property for one — `duration` is
		// minutes and only meaningful against a timed `scheduled`. All-day
		// chips stay draggable (they can move to another day), just not
		// resizable; a timed time-grid block keeps both handles.
		durationEditable: !event.allDay,
	};
}

/**
 * The shape `Calendar.Event` supplies to a drop/resize callback — structural
 * so this stays testable without the library's DOM-bearing types.
 */
export interface EventCalendarDrop {
	readonly start: Date;
	readonly end: Date;
	readonly allDay: boolean;
}

/**
 * Converts an Event Calendar drag/resize result back into domain dates.
 * Branches on `drop.allDay` — the event's NEW all-day-ness. Event Calendar
 * 5.12.0 clamps a drag to the region it started in, so today that can never
 * actually differ from `event.allDay` (see the reschedule semantics in
 * `docs/DOMAIN-MODEL.md`); the branch is kept, and unit-tested, so a
 * renderer that does allow the crossing maps correctly without a rewrite.
 */
export function fromEventCalendarDrop(event: CalendarEvent, drop: EventCalendarDrop): { readonly start: TaskDate; readonly end: TaskDate | undefined } {
	if (!drop.allDay) {
		// Absolute conversion, not delta arithmetic: shifting the domain date
		// by `drop.start - oldStart` breaks twice, across a DST boundary a
		// one-day drag is 23 or 25 real hours but the wall clock must not
		// move, and a delta can't express a change of kind (an all-day chip
		// becoming a timed block). Converting the new position
		// absolutely is DST-correct because a real local `Date` -> wall-clock
		// digits is exactly what `fromJsDateTime` does.
		const start = fromJsDateTime(drop.start);
		// `toEventCalendarEvent` sets `end = start` for a point event, so a
		// plain move of one hands back a zero-length span here; reporting
		// that as a real `end` would make the reschedule use-case clamp it to
		// a 1-minute duration the task never had.
		const end = drop.end.getTime() > drop.start.getTime() ? fromJsDateTime(drop.end) : undefined;
		return { start, end };
	}
	// Per ADR 0011 a `scheduled` datetime with no `duration` renders as an
	// all-day chip that still carries its time (surfaced via
	// `extendedProps.obtaskTime`). Event Calendar normalises an all-day
	// event's `start` to midnight, so taking it verbatim would silently
	// destroy the user's `14:30`. `withDatePart` takes the new day from the
	// drop and the time-of-day from the original domain event; a genuinely
	// date-only event has no time to keep and stays date-only.
	const start = withDatePart(fromJsDate(drop.start), event.start);
	return { start, end: undefined };
}
