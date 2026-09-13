import type { CalendarViewKind } from "@/domain/calendar-view-options";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { differenceInMinutes } from "@/domain/dates";

/** Calendar view state across task-note trips, session-only. */
export interface CalendarNavigationState {
	readonly view: CalendarViewKind;
	readonly date: IsoDate;
	readonly scrollTop: number | undefined;
	readonly savedAt: IsoDateTime;
}

/** Past this age, remembered navigation is more likely stale than useful — a reopen hours later should start fresh. */
export const NAVIGATION_MEMORY_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const NAVIGATION_MEMORY_MAX_AGE_MINUTES = NAVIGATION_MEMORY_MAX_AGE_MS / 60_000;

/** False for a `savedAt` older than the max age or in the future (a clock change) — either way, don't trust it. */
export function shouldRestoreNavigation(state: CalendarNavigationState, now: IsoDateTime): boolean {
	const ageMinutes = differenceInMinutes(state.savedAt, now);
	return ageMinutes >= 0 && ageMinutes <= NAVIGATION_MEMORY_MAX_AGE_MINUTES;
}

/** A `.base` file can register more than one calendar view under distinct names — the name disambiguates which one this state belongs to. */
export function navigationMemoryKey(viewType: string, viewName: string): string {
	return `${viewType}:${viewName}`;
}
