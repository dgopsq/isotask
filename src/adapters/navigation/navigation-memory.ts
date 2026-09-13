import type { CalendarNavigationState } from "@/domain/calendar-navigation";
import type { NavigationMemory } from "@/ports/navigation-memory";

/** Session-only by design: a plain `Map`, never `loadData`, so a reload always starts the calendar fresh — mirrors `adapters/history/reschedule-history.ts`. */
export function makeNavigationMemory(): NavigationMemory {
	const memory = new Map<string, CalendarNavigationState>();
	return {
		get: (key) => memory.get(key),
		set: (key, state) => {
			memory.set(key, state);
		},
	};
}
