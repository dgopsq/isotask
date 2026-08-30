import * as v from "valibot";

import type { Weekday } from "@/domain/dates";

/**
 * Renderer-agnostic calendar view kind. The Event Calendar adapter maps
 * these onto its own view names (`month` -> `dayGridMonth`, etc.) — see
 * `src/adapters/calendar/event-calendar/README.md` (M3 Wave 2).
 */
export type CalendarViewKind = "day" | "week" | "month";

/** Which of a task's dates contribute calendar events — see `domain/calendar-events.ts`. */
export type CalendarEventsSource = "due" | "scheduled" | "both";

export interface CalendarViewOptions {
	readonly initialView: CalendarViewKind;
	readonly events: CalendarEventsSource;
	/**
	 * `"default"` means "use the plugin's week-start setting" — resolved by
	 * the view at render time (`getWeekStart()`), not here. Parsing never
	 * needs the setting, so this stays a pure function of the Bases config.
	 */
	readonly firstDay: Weekday | "default";
}

export const DEFAULT_CALENDAR_VIEW_OPTIONS: CalendarViewOptions = {
	initialView: "month",
	events: "both",
	firstDay: "default",
};

/**
 * Below this pane width (px), a 7-column week/month grid has no room left
 * for a legible event chip — at a 390px phone viewport a month cell is
 * ~53px wide, just enough for a priority dot and no readable title. This is
 * a LAYOUT threshold on the calendar pane's own `clientWidth`
 * (`views/bases/calendar/calendar-view.ts`), never on `is-mobile`: a narrow
 * split pane on desktop crosses it too, and a full-width pane on a phone in
 * landscape doesn't. `styles/calendar.css`'s `obtask-calendar--compact`
 * class is toggled off the same computed value so the CSS breakpoint and
 * the JS one can't drift apart.
 */
export const COMPACT_CALENDAR_WIDTH = 640;

/**
 * Maps the Bases-configured view onto what actually gets drawn once the
 * pane is too narrow for a 7-column grid (`COMPACT_CALENDAR_WIDTH`). Only
 * `month` changes — the renderer draws it as a rolling 3-day view
 * (`event-calendar-renderer.ts` gives `timeGridWeek` a `duration: { days: 3
 * }` override when compact) — `week` and `day` already fit narrow panes and
 * pass through unchanged. Identity when `compact` is `false`.
 *
 * Known wart: Bases' own view-option dropdown still lists "Month" (Bases
 * view options can't vary at runtime by pane width), so choosing "Month" on
 * a narrow pane renders 3 days instead — see `docs/DOMAIN-MODEL.md`.
 */
export function effectiveCalendarView(kind: CalendarViewKind, compact: boolean): CalendarViewKind {
	if (!compact) {
		return kind;
	}
	return kind === "month" ? "week" : kind;
}

/**
 * Duck-typed accessor for Bases' per-view config — not `BasesViewConfig`
 * itself, so this file stays free of an `obsidian` import (ESLint
 * layer-boundary rule for `src/domain`). Mirrors `feed-view-options.ts`.
 */
export interface CalendarViewConfigSource {
	get(key: string): unknown;
}

const CalendarViewKindSchema = v.fallback(
	v.picklist(["day", "week", "month"]),
	DEFAULT_CALENDAR_VIEW_OPTIONS.initialView,
);

const CalendarEventsSourceSchema = v.fallback(
	v.picklist(["due", "scheduled", "both"]),
	DEFAULT_CALENDAR_VIEW_OPTIONS.events,
);

/**
 * Bases' `BasesDropdownOption` only supports string option keys/`default`
 * (`options: Record<string, string>`, `default?: string` in obsidian.d.ts —
 * verified against the type, there is no numeric-keyed dropdown variant), so
 * the `firstDay` dropdown registered in `views/bases/register.ts` uses the
 * digit strings "0".."6" as its option keys, and `config.get("firstDay")`
 * comes back as one of those strings rather than a number. This schema
 * accepts both: the digit strings (from a real Bases dropdown) and raw
 * numbers 0-6 (from a directly-constructed config, e.g. in tests).
 */
const NumericFirstDaySchema = v.pipe(
	v.picklist(["0", "1", "2", "3", "4", "5", "6"]),
	v.transform((value): Weekday => Number(value) as Weekday),
);

const FirstDaySchema = v.fallback(
	v.union([v.literal("default"), v.picklist([0, 1, 2, 3, 4, 5, 6]), NumericFirstDaySchema]),
	DEFAULT_CALENDAR_VIEW_OPTIONS.firstDay,
);

/**
 * Parses Bases' per-view config into `CalendarViewOptions`. Each field falls
 * back to its default independently when missing or malformed, so a
 * corrupt or hand-edited `.base` file never breaks the view.
 */
export function parseCalendarViewOptions(config: CalendarViewConfigSource): CalendarViewOptions {
	return {
		initialView: v.parse(CalendarViewKindSchema, config.get("initialView")),
		events: v.parse(CalendarEventsSourceSchema, config.get("events")),
		firstDay: v.parse(FirstDaySchema, config.get("firstDay")),
	};
}
