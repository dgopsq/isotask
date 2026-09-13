import type { CalendarNavigationState } from "@/domain/calendar-navigation";

/**
 * Session-only storage for calendar navigation state, keyed by
 * `domain/calendar-navigation.ts#navigationMemoryKey`. Deliberately not
 * persisted (see `adapters/navigation/navigation-memory.ts`) — mirrors
 * `RescheduleHistory`.
 */
export interface NavigationMemory {
	readonly get: (key: string) => CalendarNavigationState | undefined;
	readonly set: (key: string, state: CalendarNavigationState) => void;
}
