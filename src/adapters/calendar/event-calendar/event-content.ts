import type { Calendar } from "@event-calendar/core";

import { isObtaskEventExtendedProps } from "@/adapters/calendar/event-calendar/event-calendar-mapping";
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
 * ? fallback() : fallback)`, where `fallback` is
 * `createDefaultEventContent`. So this only needs to override rendering
 * for a *timed* all-day chip (one whose `extendedProps.obtaskTime` was set
 * by `event-calendar-mapping.ts#toEventCalendarEvent`); every other event
 * (real timed blocks, and date-only all-day chips) returns `undefined` and
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
	const { obtaskTime } = extendedProps;
	if (obtaskTime === undefined) {
		return undefined;
	}

	// No existing parent element to call `.createSpan`/`.createEl` on (these
	// two become `domNodes` siblings Event Calendar inserts itself, not
	// children of anything this function owns) — Obsidian's free-standing
	// `createSpan`/`createEl` globals build detached nodes the same way
	// `document.createElement` would, with `cls`/`text` set in one call.
	const timeEl = createSpan({ cls: cssClass("event-time"), text: obtaskTime });

	// Keeps Event Calendar's own `ec-event-title` class (not just an
	// `obtask-` one) so the ellipsis/dot rules `calendar.css` already
	// scopes to `.ec-event-title` keep applying unchanged.
	const titleEl = createEl("h4", { cls: "ec-event-title", text: typeof info.event.title === "string" ? info.event.title : "" });

	return { domNodes: [timeEl, titleEl] };
}
