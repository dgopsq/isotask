import { createCalendar, DayGrid, destroyCalendar, Interaction, TimeGrid } from "@event-calendar/core";
import type { Calendar } from "@event-calendar/core";

import { fromEventCalendarDrop, toEventCalendarEvent, toEventCalendarFirstDay, toEventCalendarView } from "@/adapters/calendar/event-calendar/event-calendar-mapping";
import { eventContent } from "@/adapters/calendar/event-calendar/event-content";
import type { CalendarEvent } from "@/domain/calendar-events";
import { fromJsDate, fromJsDateTime } from "@/domain/dates";
import type { CalendarHandle, CalendarOptions, CalendarRenderer } from "@/ports/calendar-renderer";

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

		// `Interaction` is what provides `dateClick`, and `editable`/drag and
		// resize (`eventDrop`, `eventResize`) — `eventClick` needs no plugin,
		// which is why M3 got away without it. The import is static (not
		// dynamic/conditional on which callbacks `options.callbacks` wires) —
		// this file is the composition point for the calendar library, not a
		// place worth adding lazy-loading complexity for a plugin this small.
		const calendar = createCalendar(container, [DayGrid, TimeGrid, Interaction], {
			view: toEventCalendarView(options.initialView),
			firstDay: toEventCalendarFirstDay(options.firstDay),
			editable: options.editable ?? false,
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
				end: "today prev,next dayGridMonth,timeGridWeek,timeGridDay",
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
				timeGridWeek: "Week",
				timeGridDay: "Day",
			},
			events: [],
			// Roadmap M4 "long-press + drag (touch)": the library's default
			// (1000ms) feels unresponsive next to Obsidian's own long-press
			// affordances, so a touch has to be held for less time before it
			// starts a drag rather than scrolling the view.
			longPressDelay: 500,
			// Keeps the grid auto-scrolling while dragging near its edge, so a
			// drag can reach a slot that is off-screen on a phone.
			dragScroll: true,
			...eventClickOption,
			...eventDropOption,
			...eventResizeOption,
			...dateClickOption,
		});

		return {
			setEvents: (events) => {
				eventsById = new Map(events.map((event) => [event.id, event]));
				calendar.setOption("events", events.map(toEventCalendarEvent));
			},
			setView: (view) => {
				calendar.setOption("view", toEventCalendarView(view));
			},
			setFirstDay: (firstDay) => {
				calendar.setOption("firstDay", toEventCalendarFirstDay(firstDay));
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
				void destroyCalendar(calendar);
			},
		};
	}
}
