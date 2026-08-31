import type { Calendar } from "@event-calendar/core";

import { isObtaskEventExtendedProps } from "@/adapters/calendar/event-calendar/event-calendar-mapping";
import { priorityChipClass, priorityMarks } from "@/domain/task";
import { cssClass } from "@/plugin-id";

/**
 * Event Calendar's `eventContent` option (5.12): backing
 * `event-calendar-renderer.ts`'s `createCalendar` call. Kept in its own
 * module (rather than inline in the renderer) because it's a pure function
 * of its `info` argument, unlike the renderer around it, which needs a real
 * DOM `Element` to mount into — mirrors why the mapping helpers live in
 * `event-calendar-mapping.ts` instead of the renderer itself.
 *
 * Returning `undefined` for an event falls back to Event Calendar's own
 * default rendering — confirmed against the vendored
 * `@event-calendar/core/dist/index.js`'s `createContent` helper:
 * `(isFunction(option) ? option(arg()) : option) ?? (isFunction(fallback)
 * ? fallback() : fallback)`, where `fallback` is `createDefaultEventContent`.
 * This only needs to override rendering when there's actually something
 * extra to add: a *timed* all-day chip's time label
 * (`extendedProps.obtaskTime`, set by `event-calendar-mapping.ts#toEventCalendarEvent`)
 * or a non-`normal`-priority event's trailing `!`/`!!` marks
 * (`extendedProps.priority`, `domain/task.ts#priorityMarks`). Neither
 * applies (`normal` priority, no `obtaskTime`) returns `undefined` and
 * keeps the library's own default `.ec-event-time`/`.ec-event-title` DOM
 * that the rest of `calendar.css` targets.
 */
export function eventContent(info: Calendar.EventContentInfo): Calendar.Content | undefined {
	// Widened to `unknown` before the type guard so it narrows the binding
	// to exactly `ObtaskEventExtendedProps` — starting from the declared
	// `Record<string, unknown>` (Event Calendar's own `extendedProps` type)
	// would instead narrow to an intersection of the two, which keeps
	// `obtaskTime`'s type as the index signature's `unknown`.
	const extendedProps: unknown = info.event.extendedProps;
	if (!isObtaskEventExtendedProps(extendedProps)) {
		return undefined;
	}
	const { obtaskTime, priority } = extendedProps;
	const marks = priority === undefined ? "" : priorityMarks(priority);

	if (obtaskTime === undefined && marks.length === 0) {
		return undefined;
	}

	// `display: "background"` renders no content at all in the library's
	// own default (`createDefaultEventContent`'s `domNodes = []` branch) —
	// this plugin never sets `display` itself (always the implicit
	// `"auto"`), but staying consistent with the library default here means
	// a future `display` use doesn't silently start growing marks/time text
	// where none should appear.
	if (info.event.display === "background") {
		return undefined;
	}

	// No existing parent element to call `.createSpan`/`.createEl` on (these
	// become `domNodes` siblings Event Calendar inserts itself, not children
	// of anything this function owns) — Obsidian's free-standing
	// `createSpan`/`createEl` globals build detached nodes the same way
	// `document.createElement` would, with `cls`/`text` set in one call.
	const domNodes: Node[] = [];

	if (obtaskTime !== undefined) {
		domNodes.push(createSpan({ cls: cssClass("event-time"), text: obtaskTime }));
	} else if (!info.event.allDay) {
		// Mirrors the library default's own non-all-day time element
		// (`createTimeElement`) so a plain timed block or date-only all-day
		// chip that only needs marks added doesn't lose its time label.
		domNodes.push(createEl("time", { cls: "ec-event-time", text: info.timeText }));
	}

	// Keeps Event Calendar's own `ec-event-title` class (not just an
	// `obtask-` one) so the ellipsis/dot rules `calendar.css` already
	// scopes to `.ec-event-title` keep applying unchanged.
	domNodes.push(createEl("h4", { cls: "ec-event-title", text: typeof info.event.title === "string" ? info.event.title : "" }));

	if (priority !== undefined && marks.length > 0) {
		domNodes.push(createSpan({ cls: [cssClass("event-marks"), cssClass(priorityChipClass(priority))], text: marks }));
	}

	return { domNodes };
}
