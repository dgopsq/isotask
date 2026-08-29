import { describe, expect, it } from "vitest";

import {
	DEFAULT_CALENDAR_VIEW_OPTIONS,
	parseCalendarViewOptions,
	type CalendarViewConfigSource,
} from "@/domain/calendar-view-options";

function configFrom(values: Readonly<Record<string, unknown>>): CalendarViewConfigSource {
	return {
		get: (key: string) => values[key],
	};
}

describe("parseCalendarViewOptions", () => {
	it("returns all defaults for a config that returns undefined for every key", () => {
		expect(parseCalendarViewOptions(configFrom({}))).toEqual(DEFAULT_CALENDAR_VIEW_OPTIONS);
	});

	it("reads valid values for every field", () => {
		const options = parseCalendarViewOptions(configFrom({ initialView: "week", events: "due", firstDay: 3 }));
		expect(options).toEqual({ initialView: "week", events: "due", firstDay: 3 });
	});

	describe("initialView", () => {
		it.each(["day", "week", "month", "list"] as const)("accepts %s", (value) => {
			expect(parseCalendarViewOptions(configFrom({ initialView: value })).initialView).toBe(value);
		});

		it.each([undefined, null, "", "nope", 42, {}, ["day"]])("falls back to the default for %p", (value) => {
			expect(parseCalendarViewOptions(configFrom({ initialView: value })).initialView).toBe(
				DEFAULT_CALENDAR_VIEW_OPTIONS.initialView,
			);
		});
	});

	describe("events", () => {
		it.each(["due", "scheduled", "both"] as const)("accepts %s", (value) => {
			expect(parseCalendarViewOptions(configFrom({ events: value })).events).toBe(value);
		});

		it.each([undefined, null, "", "nope", 42, {}, ["due"]])("falls back to the default for %p", (value) => {
			expect(parseCalendarViewOptions(configFrom({ events: value })).events).toBe(DEFAULT_CALENDAR_VIEW_OPTIONS.events);
		});
	});

	describe("firstDay", () => {
		it.each([0, 1, 2, 3, 4, 5, 6, "default"] as const)("accepts %p", (value) => {
			expect(parseCalendarViewOptions(configFrom({ firstDay: value })).firstDay).toBe(value);
		});

		it.each([undefined, null, "", "monday", 7, -1, 1.5, {}, []])("falls back to the default for %p", (value) => {
			expect(parseCalendarViewOptions(configFrom({ firstDay: value })).firstDay).toBe(DEFAULT_CALENDAR_VIEW_OPTIONS.firstDay);
		});
	});

	it("each field's fallback is independent — one bad key doesn't affect the others", () => {
		const options = parseCalendarViewOptions(configFrom({ initialView: "garbage", events: "due", firstDay: "nope" }));
		expect(options).toEqual({
			initialView: DEFAULT_CALENDAR_VIEW_OPTIONS.initialView,
			events: "due",
			firstDay: DEFAULT_CALENDAR_VIEW_OPTIONS.firstDay,
		});
	});
});
