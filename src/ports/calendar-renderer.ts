import type { IsoDate, TaskDate, Weekday } from "@/domain/dates";
import type { Priority, TaskPath } from "@/domain/task";

/**
 * Abstracts the calendar widget library (ADR 0006). Only
 * `src/adapters/calendar/**` may implement this port; the concrete adapter
 * is selected once, in `main.ts`. Not implemented yet — see
 * `src/adapters/calendar/README.md` (M3).
 */
export type CalendarViewKind = "day" | "week" | "month" | "list";

export interface CalendarEvent {
	readonly id: string;
	readonly taskPath: TaskPath;
	readonly title: string;
	readonly start: TaskDate;
	readonly end?: TaskDate;
	readonly allDay: boolean;
	readonly source: "due" | "scheduled";
	readonly priority: Priority;
	readonly editable: boolean;
}

export interface CalendarCallbacks {
	readonly onEventClick: (event: CalendarEvent) => void;
	readonly onEventMoved: (event: CalendarEvent, start: TaskDate, end: TaskDate | undefined) => Promise<void>;
	readonly onSlotClick: (date: TaskDate) => void;
}

export interface CalendarOptions {
	readonly initialView: CalendarViewKind;
	readonly firstDay: Weekday;
	readonly editable: boolean;
	readonly callbacks: CalendarCallbacks;
}

export interface CalendarHandle {
	readonly setEvents: (events: readonly CalendarEvent[]) => void;
	readonly setView: (view: CalendarViewKind) => void;
	readonly goTo: (date: IsoDate) => void;
	readonly next: () => void;
	readonly prev: () => void;
	readonly today: () => void;
	readonly destroy: () => void;
}

export interface CalendarRenderer {
	readonly mount: (container: HTMLElement, options: CalendarOptions) => CalendarHandle;
}
