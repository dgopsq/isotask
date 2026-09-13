import type { Calendar } from "@event-calendar/core";

import type { CalendarEvent } from "@/domain/calendar-events";
import { DEFAULT_CALENDAR_VIEW_OPTIONS } from "@/domain/calendar-view-options";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import type { IsoDate, TaskDate, Weekday } from "@/domain/dates";
import { formatTime, fromJsDate, fromJsDateTime, isDateTime, toJsDate, toSundayFirstWeekday, withDatePart } from "@/domain/dates";
import { dotColorClasses } from "@/domain/project-color";
import type { Priority } from "@/domain/task";
import { PRIORITIES, priorityChipClass } from "@/domain/task";
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

/** Setter type is `Date | string | undefined` but live instance always holds a `Date`; fallback only satisfies the type checker. */
export function fromEventCalendarDate(value: Date | string | undefined): IsoDate {
	if (value instanceof Date) {
		return fromJsDate(value);
	}
	return fromJsDate(value === undefined ? new Date() : new Date(value));
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
 * back by `event-content.ts`'s `eventContent` function — the domain event
 * itself isn't otherwise available inside `eventContent`
 * (`Calendar.EventContentInfo` only carries Event Calendar's own `Event`
 * shape). `priority` backs the trailing `!`/`!!` marks span; `isotaskTime`
 * backs the timed-all-day-chip time label; `hexDotColor` backs
 * `event-calendar-renderer.ts`'s `eventDidMount` (see `toEventCalendarEvent`'s
 * doc comment for why a hex `DotColor` is relayed this way rather than as a
 * class).
 */
export interface IsotaskEventExtendedProps {
	readonly isotaskTime?: string;
	readonly priority?: Priority;
	readonly hexDotColor?: string;
}

/** Type guard for reading `Calendar.Event["extendedProps"]` (`Record<string, unknown>`) back out as `IsotaskEventExtendedProps`. */
export function isIsotaskEventExtendedProps(value: unknown): value is IsotaskEventExtendedProps {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const isotaskTime: unknown = (value as Record<string, unknown>)["isotaskTime"];
	const priority: unknown = (value as Record<string, unknown>)["priority"];
	const hexDotColor: unknown = (value as Record<string, unknown>)["hexDotColor"];
	return (
		(isotaskTime === undefined || typeof isotaskTime === "string") &&
		(priority === undefined || (typeof priority === "string" && (PRIORITIES as readonly string[]).includes(priority))) &&
		(hexDotColor === undefined || typeof hexDotColor === "string")
	);
}

/**
 * The `hex` half of `event.dotColor`, or `undefined` for `palette`/`neutral`
 * — factored out of `toEventCalendarEvent` so both it and
 * `event-calendar-renderer.ts`'s `setEvents` repaint step (which needs the
 * same "does THIS event carry a hex color" answer for an already-mounted
 * element) share one place that knows the `DotColor` shape. Pure, so it's
 * unit-tested directly rather than only indirectly through
 * `toEventCalendarEvent`'s `extendedProps`.
 */
export function hexDotColorOf(event: CalendarEvent): string | undefined {
	return event.dotColor.kind === "hex" ? event.dotColor.value : undefined;
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
 * the grid — its time is passed through `extendedProps.isotaskTime` instead,
 * rendered as a separate muted label in front of the title by
 * `event-content.ts`'s `eventContent`. A genuinely date-only all-day event
 * (a plain `IsoDate` `start`) carries no `isotaskTime`. `extendedProps.priority`
 * is always set (regardless of `allDay`/timed) — `eventContent` reads it to
 * decide whether to append a trailing `!`/`!!` marks span.
 *
 * `event.dotColor` maps to `classNames` for `palette`/`neutral`
 * (`domain/project-color.ts#dotColorClasses`, pure — no DOM access, which is
 * what keeps this whole function safe to unit-test under vitest's `node`
 * environment). A `hex` `DotColor` has no class of its own — Obsidian's
 * plugin guidelines forbid dynamically registering a stylesheet rule for an
 * arbitrary runtime value (`dotColorClasses`'s doc comment) — so it's
 * relayed instead through `extendedProps.hexDotColor` (`hexDotColorOf`), a
 * plain string `event-calendar-renderer.ts`'s `eventDidMount` reads back to
 * set `--isotask-dot-color` directly on the mounted `.ec-event` element via
 * `setCssProps`, and its `setEvents` repaints on every later data update
 * (see that file for how it keeps a mounted-element map for exactly this).
 */
export function toEventCalendarEvent(event: CalendarEvent): Calendar.EventInput {
	const start = toJsDate(event.start);
	const end = event.end === undefined ? start : toJsDate(event.end);
	const timedAllDay = event.allDay && isDateTime(event.start);
	const hexDotColor = hexDotColorOf(event);
	// Typed as `Record<string, unknown>` (rather than `IsotaskEventExtendedProps`)
	// to match `Calendar.EventInput["extendedProps"]`'s own type exactly —
	// `IsotaskEventExtendedProps` is for the read side (`isIsotaskEventExtendedProps`
	// below), which narrows the untyped `unknown` Event Calendar hands back.
	const extendedProps: Record<string, unknown> = {
		...(timedAllDay ? { isotaskTime: formatTime(event.start) } : {}),
		priority: event.priority,
		...(hexDotColor === undefined ? {} : { hexDotColor }),
	};
	return {
		id: event.id,
		title: event.title,
		start,
		end,
		allDay: event.allDay,
		extendedProps,
		classNames: [
			cssClass("event"),
			cssClass(`event--${event.source}`),
			cssClass(priorityChipClass(event.priority)),
			...dotColorClasses(event.dotColor),
		],
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
	// `extendedProps.isotaskTime`). Event Calendar normalises an all-day
	// event's `start` to midnight, so taking it verbatim would silently
	// destroy the user's `14:30`. `withDatePart` takes the new day from the
	// drop and the time-of-day from the original domain event; a genuinely
	// date-only event has no time to keep and stays date-only.
	const start = withDatePart(fromJsDate(drop.start), event.start);
	return { start, end: undefined };
}
