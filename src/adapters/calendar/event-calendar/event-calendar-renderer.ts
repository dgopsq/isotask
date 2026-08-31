import { createCalendar, DayGrid, destroyCalendar, Interaction, TimeGrid } from "@event-calendar/core";
import type { Calendar } from "@event-calendar/core";

import {
	fromEventCalendarDrop,
	fromEventCalendarView,
	toEventCalendarEvent,
	toEventCalendarFirstDay,
	toEventCalendarView,
} from "@/adapters/calendar/event-calendar/event-calendar-mapping";
import { eventContent } from "@/adapters/calendar/event-calendar/event-content";
import type { CalendarEvent } from "@/domain/calendar-events";
import type { Weekday } from "@/domain/dates";
import { fromJsDate, fromJsDateTime } from "@/domain/dates";
import { cssClass } from "@/plugin-id";
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
		 * compactness. Two of Event Calendar's own per-view options change
		 * with it -- `buttonText.timeGridWeek` ("3 days" instead of "Week")
		 * and `views.timeGridWeek.duration` (a rolling 3-day window instead
		 * of the default 7) -- `headerToolbar` itself lists the same three
		 * views (month/week-or-3-days/day) either way, since month is no
		 * longer dropped on a narrow pane (`docs/DOMAIN-MODEL.md`'s
		 * narrow-pane compaction section). A live probe against the vendored
		 * @event-calendar/core@5.12.0 found that NEITHER of those two
		 * survives a bare `calendar.setOption(...)` once the user next
		 * switches views: Event Calendar bakes a per-view options snapshot at
		 * `createCalendar` construction time and silently re-applies THAT
		 * snapshot (via its internal `switchView` effect) over whatever was
		 * `setOption`'d live, every time `view` changes. `setOption("views",
		 * ...)` itself is an even more direct no-op post-construction -- the
		 * `views` key is deleted from the library's live options object
		 * during construction and never consulted again. So the only
		 * reliable way to change either of these two post-mount is to
		 * destroy and recreate the calendar (`setCompact` below) -- see
		 * `docs/ARCHITECTURE.md`'s calendar section for the probe that
		 * confirmed this. A handful of other options below (`slotLabelFormat`,
		 * `allDayContent`, `dayMaxEvents`) are also conditioned on `isCompact`
		 * for their own, simpler reasons documented at each -- they just ride
		 * along on the same destroy/recreate cycle rather than needing one of
		 * their own.
		 */
		function buildOptions(isCompact: boolean, date?: Calendar.Options["date"]): Calendar.Options {
			// Compact-only: drop the minutes from the hour-axis labels ("13"
			// instead of "13:00", 16px vs. 39px at this font — measured live).
			// `{ hour: "2-digit" }` ALONE would still be locale-dependent
			// (`hour12` defaults per-locale, and an en-US-style locale renders
			// "1 PM", which is WIDER, not narrower); `hour12: false` pins every
			// locale to a bare zero-padded 24-hour number ("00".."23",
			// confirmed against en-GB/en-US/it-IT and the no-locale default),
			// matching the zero-padded `HH:mm` convention `domain/dates.ts#
			// formatTime` already uses for the plugin's own chips. `exactOptionalPropertyTypes`
			// forbids `slotLabelFormat: undefined` (the option's type has no
			// `| undefined`), so wide panes get the key omitted entirely via
			// the spread below rather than set to `undefined` — Event
			// Calendar's own default (`{ hour: "numeric", minute: "2-digit" }`)
			// then applies unchanged.
			const slotLabelFormatOption: Pick<Calendar.Options, "slotLabelFormat"> = isCompact
				? { slotLabelFormat: { hour: "2-digit", hour12: false } }
				: {};

			// Compact-only: the vendored "all-day" corner label (the row header
			// sitting above the hour axis, sharing its column) is what actually
			// holds the gutter open — at 47px it's wider than any hour label,
			// so shortening the hour text alone (above) changes nothing; Event
			// Calendar sizes the whole sidebar column to the widest content any
			// row puts in it. The label can't be visually hidden with a plain
			// CSS rule targeting a class: a live DOM probe against the vendored
			// bundle (`createAllDayContent`/`contentFrom` in
			// `@event-calendar/core@5.12.0/dist/index.js`) showed the default
			// renders via `el.innerHTML = "all-day"` directly into `.ec-sidebar`
			// — a bare text node, nothing CSS can select on its own. Supplying
			// our own `domNodes` here (the same `Content` shape `eventContent`
			// already returns, see `event-content.ts`) wraps the text in a
			// `createSpan` carrying an `obtask-` class instead, which
			// `calendar.css` then visually-hides (absolutely positioned, 1x1,
			// clipped — NOT `display: none`/`visibility: hidden`, which would
			// drop it from the accessibility tree and leave the all-day row
			// unlabelled for screen reader users). An out-of-flow element
			// contributes no width to the shared sidebar column, which is what
			// actually shrinks the gutter. Same `undefined`-omission reasoning
			// as `slotLabelFormat` above applies to the key itself; wide panes
			// keep Event Calendar's own default "all-day" text at full size.
			// A FUNCTION, not a fixed `{ domNodes }` value: Event Calendar
			// resolves this inside a reactive `derived` (`createAllDayContent`)
			// and `createContent` calls it when it is callable, so returning a
			// freshly built span per call keeps every render with its own node.
			// A single shared node would be re-parented on each re-render — and
			// during a `setCompact` remount, when two calendars briefly exist,
			// one of them would silently lose the label to the other.
			const allDayContentOption: Pick<Calendar.Options, "allDayContent"> = isCompact
				? { allDayContent: () => ({ domNodes: [createSpan({ cls: cssClass("all-day-label"), text: "all-day" })] }) }
				: {};

			// Compact month only: caps how many events a day-grid cell stacks
			// before it starts hiding the rest, so a busy day's dots can't grow
			// the whole week-row taller (the default `false` lets a day's stack
			// grow without limit, which is fine for wide-pane chips but would
			// blow out a 390px-wide dot grid). Event Calendar's own hide()
			// (day-grid/Event.svelte) does the per-day "does this one still fit"
			// measurement itself — nothing here counts events per day. This
			// also switches the day-grid to fixed-height ("uniform") rows,
			// which `calendar.css` then caps at a small fixed px value (rather
			// than the library's own default `1fr`, which fills whatever
			// vertical room the pane happens to have and would let far more
			// than a handful of tiny dots fit) so the visible-dot cap stays a
			// small, predictable number regardless of pane height. The library
			// also renders a "+N more" link for whatever a day hides —
			// `calendar.css` hides that link entirely (`.ec-day-foot`):
			// compact month is read-and-navigate only (tap the cell to see
			// everything in Day view), not a place to reveal more chip text.
			const dayMaxEventsOption: Pick<Calendar.Options, "dayMaxEvents"> = isCompact ? { dayMaxEvents: true } : {};

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
				// Month is back on a narrow pane (rendered as a dot grid, see
				// `calendar.css`), so the switcher lists the same three views
				// compact or not -- only their LABEL differs (`buttonText`
				// below: `timeGridWeek` reads "3 days" when compact).
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
				...slotLabelFormatOption,
				...allDayContentOption,
				...dayMaxEventsOption,
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
			// Reads back Event Calendar's OWN live option rather than
			// `currentView`: the widget's header buttons can switch views
			// directly, entirely outside `setView`, and a caller (compact
			// month's `onSlotClick`) needs the view actually on screen, not
			// the last one this handle happened to push.
			getView: () => fromEventCalendarView(calendar.getOption("view")),
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
