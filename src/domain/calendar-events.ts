import type { CalendarEventsSource } from "@/domain/calendar-view-options";
import { addMinutes, isDateTime } from "@/domain/dates";
import type { TaskDate } from "@/domain/dates";
import type { DotColor } from "@/domain/project-color";
import type { Priority, Task, TaskPath } from "@/domain/task";

/**
 * A single event derived from one of a task's dates. Lives in `domain`
 * (not `ports`) because it's derived data, not part of the calendar-widget
 * abstraction surface — `ports/calendar-renderer.ts` imports it from here.
 * Keeps the `source` field name (not `kind`) for continuity with the
 * original port sketch.
 */
export interface CalendarEvent {
	readonly id: string;
	readonly taskPath: TaskPath;
	readonly title: string;
	readonly start: TaskDate;
	readonly end?: TaskDate;
	readonly allDay: boolean;
	readonly source: "due" | "scheduled";
	readonly priority: Priority;
	/**
	 * The color the task's project resolves to (or `neutral` with no
	 * project) — resolved by the shell (`views/bases/calendar/calendar-view.ts`,
	 * via `adapters/obsidian/project-color-lookup.ts#projectRawColor` +
	 * `domain/project-color.ts#resolveDotColor`) and handed in as a plain
	 * value, since this module never touches the metadata cache. Consumed
	 * by `event-calendar-mapping.ts#toEventCalendarEvent`
	 * (`domain/project-color.ts#dotColorClasses`) to pick the CSS class
	 * that sets `--obtask-dot-color` on the rendered event.
	 */
	readonly dotColor: DotColor;
}

export interface CalendarEventsOptions {
	readonly source: CalendarEventsSource;
}

function scheduledEvent(task: Task, dotColor: DotColor): CalendarEvent | undefined {
	if (task.scheduled === undefined) {
		return undefined;
	}
	const timed = isDateTime(task.scheduled);
	// Timed + a duration -> a real block in the time grid (`end` set,
	// `allDay: false`). Timed with no duration, and date-only, both become
	// `allDay: true` chips — a zero-duration event has no length to occupy
	// on the grid, and drawing it as a 24px rectangle collided with real
	// timed blocks (ADR 0011); `start` keeps its time component even when
	// `allDay`, so all-day chips still sort/prefix by time
	// (`event-calendar-mapping.ts`).
	if (timed && task.duration !== undefined) {
		return {
			id: `${task.path}#scheduled`,
			taskPath: task.path,
			title: task.title,
			start: task.scheduled,
			end: addMinutes(task.scheduled, task.duration),
			allDay: false,
			source: "scheduled",
			priority: task.priority,
			dotColor,
		};
	}
	return {
		id: `${task.path}#scheduled`,
		taskPath: task.path,
		title: task.title,
		start: task.scheduled,
		allDay: true,
		source: "scheduled",
		priority: task.priority,
		dotColor,
	};
}

function dueEvent(task: Task, dotColor: DotColor): CalendarEvent | undefined {
	if (task.due === undefined) {
		return undefined;
	}
	// `due` carries no duration field, so it's always a chip, never a
	// time-grid block: date-only is genuinely all-day, and a timed due
	// becomes an all-day chip prefixed with its time (ADR 0011) rather than
	// a zero-duration time-grid marker — `start` keeps the full datetime
	// either way.
	return {
		id: `${task.path}#due`,
		taskPath: task.path,
		title: task.title,
		start: task.due,
		allDay: true,
		source: "due",
		priority: task.priority,
		dotColor,
	};
}

/**
 * Derives up to two calendar events from a task's own `due`/`scheduled`
 * values, per `docs/DOMAIN-MODEL.md#calendar-event-derivation`. Pure and
 * ignores `repeat` entirely — one note is one occurrence (ADR 0005); there
 * is no RRULE expansion into future occurrences.
 *
 * `dotColor` is resolved by the caller (the task's project's color, or
 * `neutral` — `adapters/obsidian/project-color-lookup.ts` +
 * `domain/project-color.ts#resolveDotColor`) rather than looked up here:
 * this module stays free of the metadata cache. One task has one project,
 * so the same `dotColor` is stamped onto both the `due` and `scheduled`
 * event it may produce.
 */
export function eventsForTask(task: Task, options: CalendarEventsOptions, dotColor: DotColor): readonly CalendarEvent[] {
	const events: CalendarEvent[] = [];

	if (options.source === "scheduled" || options.source === "both") {
		const event = scheduledEvent(task, dotColor);
		if (event !== undefined) {
			events.push(event);
		}
	}

	if (options.source === "due" || options.source === "both") {
		const event = dueEvent(task, dotColor);
		if (event !== undefined) {
			events.push(event);
		}
	}

	return events;
}

/**
 * Stable sort by `start` (ISO string compare — a date-only `TaskDate` like
 * `"2026-09-04"` is a strict string-prefix of, and so sorts before, any
 * timed value on the same day, e.g. `"2026-09-04T09:00"`; among timed
 * values it sorts by time of day), then `title`, then `id` for full
 * determinism. Exists because Event Calendar normalises all-day events'
 * `start` to midnight before its own (stable) sort, so same-day chips that
 * carry different times of day would otherwise tie and keep whatever order
 * they were handed in — this pre-sort is what actually decides their
 * on-screen order. Called by `views/bases/calendar/calendar-view.ts` on the
 * assembled event list before handing it to `CalendarHandle#setEvents`.
 */
export function sortCalendarEvents(events: readonly CalendarEvent[]): readonly CalendarEvent[] {
	return [...events].sort((a, b) => {
		if (a.start < b.start) {
			return -1;
		}
		if (a.start > b.start) {
			return 1;
		}
		if (a.title < b.title) {
			return -1;
		}
		if (a.title > b.title) {
			return 1;
		}
		if (a.id < b.id) {
			return -1;
		}
		if (a.id > b.id) {
			return 1;
		}
		return 0;
	});
}
