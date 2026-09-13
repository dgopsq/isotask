import type { CalendarNavigationState } from "@/domain/calendar-navigation";

/** Session-only storage, never persisted, mirrors `RescheduleHistory`. */
export interface NavigationMemory {
	readonly get: (key: string) => CalendarNavigationState | undefined;
	readonly set: (key: string, state: CalendarNavigationState) => void;
}
