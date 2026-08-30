import type { CalendarEvent } from "@/domain/calendar-events";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import type { IsoDate, TaskDate, Weekday } from "@/domain/dates";

/**
 * Abstracts the calendar widget library (ADR 0006). Only
 * `src/adapters/calendar/**` may implement this port; the concrete adapter
 * is selected once, in `main.ts`. See `src/adapters/calendar/README.md`.
 */
export type { CalendarEvent, CalendarViewKind };

/**
 * All optional, so a caller can mount a read-only calendar by passing
 * `callbacks: {}` — an adapter decides from the presence of each callback
 * whether to enable the widget features that back it.
 */
export interface CalendarCallbacks {
	/** Wired by the calendar view to open the event's note. */
	readonly onEventClick?: (event: CalendarEvent) => void;
	/**
	 * A drag or a resize finished. `start` is the event's new start; `end`
	 * is set only when the event now has a real span (a timed block in the
	 * time grid) and `undefined` otherwise — an all-day chip has no end to
	 * report, and a task has no property to store one in.
	 *
	 * Resolves to whether the move was actually persisted. `false` means
	 * the adapter must undo the optimistic visual move: a failed write
	 * leaves the vault unchanged, so no re-render comes to correct the
	 * event, and it would otherwise sit at the dragged position while the
	 * file still says otherwise.
	 */
	readonly onEventMoved?: (event: CalendarEvent, start: TaskDate, end: TaskDate | undefined) => Promise<boolean>;
	/** An empty slot was clicked, carrying the clicked date — date-only for a month cell or the all-day row, timed for a time-grid slot. */
	readonly onSlotClick?: (date: TaskDate) => void;
}

export interface CalendarOptions {
	readonly initialView: CalendarViewKind;
	readonly firstDay: Weekday;
	/** Whether events can be dragged/resized. Defaults to `false`, which is also what a mount with no `onEventMoved` gets in practice. */
	readonly editable?: boolean;
	readonly callbacks: CalendarCallbacks;
}

export interface CalendarHandle {
	readonly setEvents: (events: readonly CalendarEvent[]) => void;
	readonly setView: (view: CalendarViewKind) => void;
	/**
	 * Added in M3 Wave 3: the `obtask-calendar` view resolves `firstDay:
	 * "default"` to `getWeekStart()` and re-applies it on every
	 * `onDataUpdated` (a `firstDay` config change re-renders like any other
	 * option), without remounting — remounting would lose the user's
	 * navigated date. Not part of the original Wave 1 port sketch, which had
	 * no live-update path to drive it from yet.
	 */
	readonly setFirstDay: (firstDay: Weekday) => void;
	readonly goTo: (date: IsoDate) => void;
	readonly next: () => void;
	readonly prev: () => void;
	readonly today: () => void;
	readonly destroy: () => void;
}

export interface CalendarRenderer {
	readonly mount: (container: HTMLElement, options: CalendarOptions) => CalendarHandle;
}
