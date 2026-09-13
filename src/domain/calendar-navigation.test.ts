import { describe, expect, it } from "vitest";

import { NAVIGATION_MEMORY_MAX_AGE_MS, navigationMemoryKey, shouldRestoreNavigation } from "@/domain/calendar-navigation";
import type { CalendarNavigationState } from "@/domain/calendar-navigation";
import type { IsoDate, IsoDateTime } from "@/domain/dates";

function state(savedAt: string): CalendarNavigationState {
	return { view: "day", date: "2026-09-13" as IsoDate, scrollTop: undefined, savedAt: savedAt as IsoDateTime };
}

describe("shouldRestoreNavigation", () => {
	it("is true right at savedAt", () => {
		expect(shouldRestoreNavigation(state("2026-09-13T09:00"), "2026-09-13T09:00" as IsoDateTime)).toBe(true);
	});

	it("is true exactly at the max age boundary", () => {
		expect(shouldRestoreNavigation(state("2026-09-13T09:00"), "2026-09-13T21:00" as IsoDateTime)).toBe(true);
		expect(NAVIGATION_MEMORY_MAX_AGE_MS).toBe(12 * 60 * 60 * 1000);
	});

	it("is false one minute past the max age", () => {
		expect(shouldRestoreNavigation(state("2026-09-13T09:00"), "2026-09-13T21:01" as IsoDateTime)).toBe(false);
	});

	it("is false when savedAt is in the future", () => {
		expect(shouldRestoreNavigation(state("2026-09-13T09:00"), "2026-09-13T08:59" as IsoDateTime)).toBe(false);
	});
});

describe("navigationMemoryKey", () => {
	it("joins type and name with a colon", () => {
		expect(navigationMemoryKey("isotask-calendar", "Calendar")).toBe("isotask-calendar:Calendar");
	});

	it("keeps an empty name as its own key", () => {
		expect(navigationMemoryKey("isotask-calendar", "")).toBe("isotask-calendar:");
	});
});
