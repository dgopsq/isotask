import { createCalendar, DayGrid, destroyCalendar, Interaction, TimeGrid } from "@event-calendar/core";
import type { Calendar } from "@event-calendar/core";

import { fromEventCalendarDrop, toEventCalendarEvent, toEventCalendarFirstDay, toEventCalendarView } from "@/adapters/calendar/event-calendar/event-calendar-mapping";
import { eventContent } from "@/adapters/calendar/event-calendar/event-content";
import type { CalendarEvent } from "@/domain/calendar-events";
import type { Weekday } from "@/domain/dates";
import { fromJsDate, fromJsDateTime } from "@/domain/dates";
import type { CalendarHandle, CalendarOptions, CalendarRenderer, CalendarViewKind } from "@/ports/calendar-renderer";

/**
 * The sole `@event-calendar/*` import site in the codebase (ESLint-enforced,
 * `eslint.config.js`). Wraps `@event-calendar/core` behind the
 * `CalendarRenderer` port (ADR 0006) so the rest of the plugin never sees
 * the library's own option/event shapes.
 *
 * `mount()` needs a real DOM `Element` (`createCalendar`'s target), so this
 * class is exercised by the Bases view at runtime rather than by vitest
 * (whose `environment: "node"` has no DOM) — the pure option/event mapping
 * it delegates to lives in `event-calendar-mapping.ts` and is unit-tested
 * there instead.
 */
export class EventCalendarRenderer implements CalendarRenderer {
	mount(container: HTMLElement, options: CalendarOptions): CalendarHandle {
		// Keyed by event id so the click/drop/resize callbacks (which are
		// handed an Event Calendar event, not a domain one) can give the
		// port's callback back the original domain `CalendarEvent` supplied
		// via `setEvents` — that's what carries `taskPath` and `source`.
		let eventsById = new Map<string, CalendarEvent>();

		const onEventClick = options.callbacks.onEventClick;

		// `exactOptionalPropertyTypes` forbids setting `eventClick:
		// undefined` (the option's type has no `| undefined`) — the key must
		// be entirely absent when no callback is wired, hence the spread.
		const eventClickOption: Pick<Calendar.Options, "eventClick"> =
			onEventClick === undefined
				? {}
				: {
						eventClick: (info: Calendar.EventClickInfo) => {
							const event = eventsById.get(String(info.event.id));
							if (event !== undefined) {
								onEventClick(event);
							}
						},
					};

		const onEventMoved = options.callbacks.onEventMoved;
		const onSlotClick = options.callbacks.onSlotClick;

		// eventDrop and eventResize differ only in which handle the user grabbed;
		// both report the event's new position the same way, so they share one handler.
		const applyMove = (info: Calendar.EventDropInfo | Calendar.EventResizeInfo): void => {
			if (onEventMoved === undefined) {
				return;
			}
			const moved = eventsById.get(String(info.event.id));
			if (moved === undefined) {
				// Event Calendar applies a move to its own model *before*
				// calling back, so by now the chip already sits on the new
				// slot. If a `setEvents` landed mid-gesture and replaced the
				// map, we can't tell which task this was and nothing will be
				// written — so put it back rather than leaving it parked
				// somewhere its note doesn't agree with.
				info.revert();
				return;
			}
			const { start, end } = fromEventCalendarDrop(moved, info.event);
			// `onEventMoved` returns a `Promise` but Event Calendar's own
			// eventDrop/eventResize callbacks aren't awaited, so the await is
			// wrapped in a fire-and-forget async IIFE. `revert()` undoes the
			// optimistic visual move when the write failed, which matters because a
			// failed write changes nothing in the vault and therefore produces no
			// re-render to correct the event's position.
			void (async () => {
				if (!(await onEventMoved(moved, start, end))) {
					info.revert();
				}
			})();
		};

		const eventDropOption: Pick<Calendar.Options, "eventDrop"> = onEventMoved === undefined ? {} : { eventDrop: applyMove };
		const eventResizeOption: Pick<Calendar.Options, "eventResize"> = onEventMoved === undefined ? {} : { eventResize: applyMove };

		const dateClickOption: Pick<Calendar.Options, "dateClick"> =
			onSlotClick === undefined
				? {}
				: {
						dateClick: (info: Calendar.DateClickInfo) => {
							onSlotClick(info.allDay ? fromJsDate(info.date) : fromJsDateTime(info.date));
						},
					};

		// Mutable state a compactness toggle needs to rebuild the whole
		// calendar from (see `buildOptions`/`setCompact` below): the view and
		// firstDay last requested via the handle, kept up to date by
		// `setView`/`setFirstDay` so a later remount doesn't silently snap
		// back to whatever `options` happened to say at the ORIGINAL mount.
		let currentView: CalendarViewKind = options.initialView;
		let currentFirstDay: Weekday = options.firstDay;
		let compact = options.compact ?? false;

		/**
		 * Builds the full `createCalendar` options object for a given
		 * compactness. Compactness changes three of Event Calendar's own
		 * options -- `headerToolbar` (drops `dayGridMonth` from the view
		 * switcher), `buttonText.timeGridWeek` ("3 days" instead of "Week"),
		 * and `views.timeGridWeek.duration` (a rolling 3-day window instead
		 * of the default 7) -- and a live probe against the vendored
		 * @event-calendar/core@5.12.0 found that NONE of the three survive a
		 * bare `calendar.setOption(...)` once the user next switches views:
		 * Event Calendar bakes a per-view options snapshot at
		 * `createCalendar` construction time and silently re-applies THAT
		 * snapshot (via its internal `switchView` effect) over whatever was
		 * `setOption`'d live, every time `view` changes. `setOption("views",
		 * ...)` itself is an even more direct no-op post-construction -- the
		 * `views` key is deleted from the library's live options object
		 * during construction and never consulted again. So the only
		 * reliable way to change any of these three post-mount is to
		 * destroy and recreate the calendar (`setCompact` below) -- see
		 * `docs/ARCHITECTURE.md`'s calendar section for the probe that
		 * confirmed this.
		 */
		function buildOptions(isCompact: boolean, date?: Calendar.Options["date"]): Calendar.Options {
			return {
				view: toEventCalendarView(currentView),
				firstDay: toEventCalendarFirstDay(currentFirstDay),
				editable: options.editable ?? false,
				// Always "auto", compact included: a bounded height would give Event
				// Calendar an internal scroller, and that scroller is exactly what
				// PINS the day-header row and all-day row in place while the rest of
				// the grid scrolls underneath them — the opposite of what's wanted
				// here. The whole grid (header, all-day row, hourly slots) should
				// scroll away together with the pane's own scroll, same as wide
				// panes. This also costs little: per ADR 0011 every zero-duration
				// event (all timed `due`s, and any `scheduled` without a `duration`)
				// renders as an all-day chip, so most of a day's content already sits
				// in the all-day row at the very top, visible with no scrolling at
				// all — only real `scheduled`+`duration` blocks live in the time grid
				// below.
				height: "auto",
				// Compact hourly grid: the vendored default (48px/half-hour slot,
				// ~1150px for a full day) reads as an oversized empty grid for a
				// task list that's mostly short blocks. One slot per hour at 32px
				// (~770px/day) still gives a 1-hour block (Event Calendar renders
				// one slot per timed block, however long) enough height for a
				// dot+title line, and the tighter `.ec-event` padding in
				// `calendar.css` keeps a 30-minute block's title readable too —
				// see `docs/ARCHITECTURE.md`'s calendar section.
				slotDuration: "01:00:00",
				slotHeight: 32,
				// Zero-duration due/scheduled markers no longer live in the time
				// grid (ADR 0011) — it now holds only real scheduled+duration
				// blocks, which can still legitimately overlap each other (two
				// meetings at once). `false` lays overlapping blocks side by side
				// instead of stacking them, which read as one collided rectangle.
				slotEventOverlap: false,
				// Overrides rendering only for a timed all-day chip (one carrying
				// `extendedProps.obtaskTime`, see `event-calendar-mapping.ts`); for
				// every other event `eventContent` returns `undefined`, which Event
				// Calendar treats as "use the default rendering" — see
				// `event-content.ts`'s doc comment for how that fallback was
				// confirmed against the vendored source.
				eventContent,
				headerToolbar: {
					start: "title",
					center: "",
					end: isCompact ? "today prev,next timeGridWeek,timeGridDay" : "today prev,next dayGridMonth,timeGridWeek,timeGridDay",
				},
				// Event Calendar REPLACES its default `buttonText` map with the one
				// given here (plugins only `assign()` their labels into the
				// defaults), so every button in `headerToolbar` must be listed or it
				// renders blank.
				buttonText: {
					today: "Today",
					prev: "Previous",
					next: "Next",
					dayGridMonth: "Month",
					timeGridWeek: isCompact ? "3 days" : "Week",
					timeGridDay: "Day",
				},
				// Rolling (not firstDay-snapped) 3-day window -- confirmed by the
				// same probe referenced above: Event Calendar's `currentRange`
				// derives from `options.date`/`options.duration` directly and
				// only snaps to `firstDay` for whole-week/month durations, never
				// a plain `{ days: 3 }` one.
				views: isCompact ? { timeGridWeek: { duration: { days: 3 } } } : {},
				events: [...eventsById.values()].map(toEventCalendarEvent),
				// Roadmap M4 "long-press + drag (touch)": the library's default
				// (1000ms) feels unresponsive next to Obsidian's own long-press
				// affordances, so a touch has to be held for less time before it
				// starts a drag rather than scrolling the view.
				longPressDelay: 500,
				// Keeps the grid auto-scrolling while dragging near its edge, so a
				// drag can reach a slot that is off-screen on a phone.
				dragScroll: true,
				...(date === undefined ? {} : { date }),
				...eventClickOption,
				...eventDropOption,
				...eventResizeOption,
				...dateClickOption,
			};
		}

		// `Interaction` is what provides `dateClick`, and `editable`/drag and
		// resize (`eventDrop`, `eventResize`) — `eventClick` needs no plugin,
		// which is why M3 got away without it. The import is static (not
		// dynamic/conditional on which callbacks `options.callbacks` wires) —
		// this file is the composition point for the calendar library, not a
		// place worth adding lazy-loading complexity for a plugin this small.
		let calendar = createCalendar(container, [DayGrid, TimeGrid, Interaction], buildOptions(compact));

		// Serializes `setCompact`'s destroy/recreate cycles. `onResize` can
		// fire many times in a row for a single drag gesture (confirmed live:
		// ~9 calls for one sidebar collapse animation), so a pane dragged back
		// and forth across `COMPACT_CALENDAR_WIDTH` could otherwise call
		// `setCompact` again while the previous cycle's `destroyCalendar` was
		// still in flight — `calendar` wouldn't have been reassigned to the
		// new instance yet, so the second call would destroy the SAME
		// already-being-destroyed instance a second time (Svelte 5's unmount
		// rejects a second `unmount()` on the same instance) instead of the
		// new one. Chaining every cycle onto this promise makes them run one
		// at a time; each cycle reads `compact` fresh when it actually runs
		// (not when it was scheduled), so a rapid double-toggle still
		// converges on the true final state rather than an intermediate one.
		let compactTransition: Promise<void> = Promise.resolve();

		// `destroy()` can land while a `setCompact` cycle is still in flight
		// (collapsing a sidebar resizes the pane, then the user closes the
		// tab). Without these two flags that cycle would either unmount an
		// instance the handle had already unmounted, or — worse — finish by
		// mounting a brand-new calendar into a container the view is in the
		// middle of tearing down, leaking a live Svelte component into
		// detached DOM. `calendarLive` tracks whether the CURRENT instance
		// still needs unmounting; `destroyed` is the one-way latch that stops
		// any queued cycle from recreating anything.
		let calendarLive = true;
		let destroyed = false;

		// Read through a function, never directly: `destroyed` is set from
		// `destroy()` while `setCompact`'s cycle is suspended at an `await`,
		// which TypeScript's control-flow analysis cannot see — reading the
		// bare `let` makes it narrow the post-await re-check to "always
		// false" and lint it away, deleting the guard that matters most.
		function isDestroyed(): boolean {
			return destroyed;
		}

		async function unmountCurrent(): Promise<void> {
			if (!calendarLive) {
				return;
			}
			calendarLive = false;
			await destroyCalendar(calendar);
		}

		return {
			setEvents: (events) => {
				eventsById = new Map(events.map((event) => [event.id, event]));
				calendar.setOption("events", events.map(toEventCalendarEvent));
			},
			setView: (view) => {
				currentView = view;
				calendar.setOption("view", toEventCalendarView(view));
			},
			setFirstDay: (firstDay) => {
				currentFirstDay = firstDay;
				calendar.setOption("firstDay", toEventCalendarFirstDay(firstDay));
			},
			setCompact: (next) => {
				if (next === compact || isDestroyed()) {
					return;
				}
				compact = next;
				compactTransition = compactTransition.then(async () => {
					if (isDestroyed()) {
						return;
					}
					const target = compact;
					// Captured right before destroying: `createCalendar` otherwise
					// defaults the new instance's `date` back to today, discarding
					// wherever the user had navigated to.
					const preservedDate = calendar.getOption("date");
					await unmountCurrent();
					// `destroy()` may have landed during that await — recreating
					// now would mount into a container that is being torn down.
					if (isDestroyed()) {
						return;
					}
					calendar = createCalendar(container, [DayGrid, TimeGrid, Interaction], buildOptions(target, preservedDate));
					calendarLive = true;
				});
			},
			goTo: (date) => {
				calendar.setOption("date", date);
			},
			next: () => {
				calendar.next();
			},
			prev: () => {
				calendar.prev();
			},
			today: () => {
				calendar.gotoDate(new Date());
			},
			destroy: () => {
				// `destroyCalendar` is async (Svelte 5 unmount); the port's
				// `destroy(): void` stays sync — fire-and-forget is fine, the
				// container itself is about to be torn down by the caller.
				// Queued onto `compactTransition` rather than run immediately so
				// it unmounts whichever instance a pending remount leaves behind,
				// instead of racing it.
				destroyed = true;
				compactTransition = compactTransition.then(unmountCurrent);
			},
		};
	}
}
