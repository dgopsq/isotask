import type { CalendarEventsSource } from "@/domain/calendar-view-options";
import { addMinutes, isDateTime } from "@/domain/dates";
import type { TaskDate } from "@/domain/dates";
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
}

export interface CalendarEventsOptions {
	readonly source: CalendarEventsSource;
}

function scheduledEvent(task: Task): CalendarEvent | undefined {
	if (task.scheduled === undefined) {
		return undefined;
	}
	const timed = isDateTime(task.scheduled);
	const base: CalendarEvent = {
		id: `${task.path}#scheduled`,
		taskPath: task.path,
		title: task.title,
		start: task.scheduled,
		allDay: !timed,
		source: "scheduled",
		priority: task.priority,
	};
	// Timed + a duration -> a block of that length. Timed with no duration
	// -> a point-in-time marker (no `end`), per the M3 plan's design
	// decision. Date-only -> all-day, `end` unused.
	if (timed && task.duration !== undefined) {
		return { ...base, end: addMinutes(task.scheduled, task.duration) };
	}
	return base;
}

function dueEvent(task: Task): CalendarEvent | undefined {
	if (task.due === undefined) {
		return undefined;
	}
	const timed = isDateTime(task.due);
	// A timed due date is a zero-duration marker (no `end`) — `due` carries
	// no duration field, unlike `scheduled`.
	return {
		id: `${task.path}#due`,
		taskPath: task.path,
		title: task.title,
		start: task.due,
		allDay: !timed,
		source: "due",
		priority: task.priority,
	};
}

/**
 * Derives up to two calendar events from a task's own `due`/`scheduled`
 * values, per `docs/DOMAIN-MODEL.md#calendar-event-derivation`. Pure and
 * ignores `repeat` entirely — one note is one occurrence (ADR 0005); there
 * is no RRULE expansion into future occurrences.
 */
export function eventsForTask(task: Task, options: CalendarEventsOptions): readonly CalendarEvent[] {
	const events: CalendarEvent[] = [];

	if (options.source === "scheduled" || options.source === "both") {
		const event = scheduledEvent(task);
		if (event !== undefined) {
			events.push(event);
		}
	}

	if (options.source === "due" || options.source === "both") {
		const event = dueEvent(task);
		if (event !== undefined) {
			events.push(event);
		}
	}

	return events;
}
