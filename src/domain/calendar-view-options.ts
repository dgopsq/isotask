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
