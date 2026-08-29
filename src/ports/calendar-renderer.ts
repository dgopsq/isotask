import type { CalendarEvent } from "@/domain/calendar-events";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import type { IsoDate, TaskDate, Weekday } from "@/domain/dates";

/**
 * Abstracts the calendar widget library (ADR 0006). Only
 * `src/adapters/calendar/**` may implement this port; the concrete adapter
 * is selected once, in `main.ts`. Implemented in M3 Wave 2 — see
 * `src/adapters/calendar/README.md`.
 */
export type { CalendarEvent, CalendarViewKind };

/**
 * All optional: M3 mounts with `callbacks: {}` (nothing wired). This is the
 * M4 extension point — click-to-open, drag/resize reschedule and
 * click-empty-slot create fill these in with no port shape change.
 */
export interface CalendarCallbacks {
	readonly onEventClick?: (event: CalendarEvent) => void;
	readonly onEventMoved?: (event: CalendarEvent, start: TaskDate, end: TaskDate | undefined) => Promise<void>;
	readonly onSlotClick?: (date: TaskDate) => void;
}

export interface CalendarOptions {
	readonly initialView: CalendarViewKind;
	readonly firstDay: Weekday;
	/** Whether events can be dragged/resized. Defaults to `false`; unused until M4 wires the Interaction plugin. */
	readonly editable?: boolean;
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
