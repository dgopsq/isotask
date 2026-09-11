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
	/**
	 * Whether the pane is too narrow for a full 7-column week/month grid at
	 * mount time. This is a LAYOUT fact — the calendar pane's own width
	 * (`views/bases/calendar/calendar-view.ts` measures `clientWidth` against
	 * `domain/calendar-view-options.ts`'s `COMPACT_CALENDAR_WIDTH`) — it is
	 * NOT "is this a mobile client": a narrow split pane on desktop is
	 * compact, a full-width pane on a phone in landscape isn't. Defaults to
	 * `false`. See `CalendarHandle.setCompact` for how this is kept current
	 * after mount.
	 */
	readonly compact?: boolean;
	readonly callbacks: CalendarCallbacks;
}

export interface CalendarHandle {
	readonly setEvents: (events: readonly CalendarEvent[]) => void;
	readonly setView: (view: CalendarViewKind) => void;
	/**
	 * The view Event Calendar is CURRENTLY showing — not necessarily the one
	 * this handle last called `setView` with: the widget's own header buttons
	 * let the user switch views directly, entirely outside this port, so a
	 * caller that needs to know "is month actually on screen right now" (the
	 * calendar view's compact `onSlotClick`, deciding whether a tap should
	 * navigate into Day view or open the create-task modal) must ask the
	 * widget itself rather than trust whatever it last pushed. Total over
	 * every value the adapter's underlying widget can report — see the
	 * Event Calendar adapter's own mapping for its documented fallback.
	 */
	readonly getView: () => CalendarViewKind;
	/**
	 * Added in M3 Wave 3: the `isotask-calendar` view resolves `firstDay:
	 * "default"` to `getWeekStart()` and re-applies it on every
	 * `onDataUpdated` (a `firstDay` config change re-renders like any other
	 * option), without remounting — remounting would lose the user's
	 * navigated date. Not part of the original Wave 1 port sketch, which had
	 * no live-update path to drive it from yet.
	 */
	readonly setFirstDay: (firstDay: Weekday) => void;
	/**
	 * Switches the "compact" (narrow-pane) chrome on or off — see
	 * `CalendarOptions.compact` for what "compact" means (a pane-width fact,
	 * never "is mobile"). In the Event Calendar adapter this means: dropping
	 * `dayGridMonth` from the view switcher, giving `timeGridWeek` a rolling
	 * `duration: { days: 3 }` (relabelled "3 days"), or restoring the normal
	 * 7-day week + month button when switched back off.
	 *
	 * A live probe against the vendored @event-calendar/core@5.12.0 found
	 * that none of `headerToolbar`, `buttonText`, or a per-view `duration`
	 * override survive a plain `calendar.setOption(...)` once the user next
	 * switches views — Event Calendar re-applies its CONSTRUCTION-TIME
	 * per-view options snapshot on every view switch, silently overwriting
	 * whatever was set live. The adapter therefore destroys and remounts its
	 * widget here, preserving the currently displayed date (`getOption("date")`
	 * before destroying, fed back in as the new mount's `date`) so the user
	 * doesn't lose their navigated position.
	 */
	readonly setCompact: (compact: boolean) => void;
	readonly goTo: (date: IsoDate) => void;
	readonly next: () => void;
	readonly prev: () => void;
	readonly today: () => void;
	readonly destroy: () => void;
}

export interface CalendarRenderer {
	readonly mount: (container: HTMLElement, options: CalendarOptions) => CalendarHandle;
}
