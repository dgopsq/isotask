import { describe, expect, it } from "vitest";

import {
	addMinutes,
	compareTaskDate,
	endOfWeek,
	fromFloatingDate,
	fromJsDate,
	fromJsDateTime,
	isDateTime,
	parseTaskDate,
	shiftBy,
	startOfWeek,
	toDateOnly,
	toFloatingDate,
	toJsDate,
	toSundayFirstWeekday,
	type TaskDate,
} from "@/domain/dates";
import { isErr, isOk } from "@/domain/result";

function mustParse(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`expected ${value} to parse, got ${JSON.stringify(result.error)}`);
	}
	return result.value;
}

describe("parseTaskDate", () => {
	const valid = [
		"2026-01-01",
		"2026-12-31",
		"2026-09-02T09:30",
		"2026-09-02T09:30:15",
		"2028-02-29", // leap day
	];

	it.each(valid)("accepts %s", (value) => {
		expect(isOk(parseTaskDate(value))).toBe(true);
	});

	const invalid = [
		"",
		"not-a-date",
		"2026-9-2",
		"2026-02-30",
		"2026-13-01",
		"2026-04-31",
		"2026-02-29", // 2026 is not a leap year
		"2026-00-10",
		"2026-01-00",
		"2026-09-02T25:00",
		"2026-09-02T09:60",
		"2026-09-02Z",
		"2026-09-02T09:30Z",
		"2026-09-02T09:30+01:00",
		"2026-09-02T09:30:00Z-07",
	];

	it.each(invalid)("rejects %s", (value) => {
		expect(isErr(parseTaskDate(value))).toBe(true);
	});
});

describe("isDateTime / toDateOnly", () => {
	it("distinguishes date-only from datetime values", () => {
		expect(isDateTime(mustParse("2026-09-02"))).toBe(false);
		expect(isDateTime(mustParse("2026-09-02T09:30"))).toBe(true);
	});

	it("strips the time component", () => {
		expect(toDateOnly(mustParse("2026-09-02T09:30"))).toBe("2026-09-02");
		expect(toDateOnly(mustParse("2026-09-02"))).toBe("2026-09-02");
	});
});

describe("toJsDate / fromJsDate / fromJsDateTime", () => {
	it("round-trips a date-only value through a local Date", () => {
		const date = mustParse("2026-09-02");
		const js = toJsDate(date);
		expect(js.getFullYear()).toBe(2026);
		expect(js.getMonth()).toBe(8);
		expect(js.getDate()).toBe(2);
		expect(fromJsDate(js)).toBe("2026-09-02");
	});

	it("round-trips a datetime value through a local Date", () => {
		const date = mustParse("2026-09-02T14:45");
		const js = toJsDate(date);
		expect(js.getHours()).toBe(14);
		expect(js.getMinutes()).toBe(45);
		expect(fromJsDateTime(js)).toBe("2026-09-02T14:45");
	});
});

describe("addMinutes", () => {
	const table: readonly { readonly input: string; readonly minutes: number; readonly expected: string }[] = [
		{ input: "2026-09-02T09:00", minutes: 30, expected: "2026-09-02T09:30" },
		{ input: "2026-09-02T23:45", minutes: 30, expected: "2026-09-03T00:15" },
		// Europe/Rome spring-forward day (2026-03-29): naive wall-clock arithmetic,
		// no real DST gap applied.
		{ input: "2026-03-29T01:30", minutes: 90, expected: "2026-03-29T03:00" },
		// Europe/Rome fall-back day (2026-10-25): same, no real DST fold applied.
		{ input: "2026-10-25T01:30", minutes: 90, expected: "2026-10-25T03:00" },
		{ input: "2026-09-02", minutes: 60 * 24, expected: "2026-09-03" },
	];

	it.each(table)("$input + $minutes min -> $expected", ({ input, minutes, expected }) => {
		expect(addMinutes(mustParse(input), minutes)).toBe(expected);
	});
});

describe("shiftBy", () => {
	const DAY_MS = 24 * 60 * 60 * 1000;

	const table: readonly { readonly input: string; readonly deltaMs: number; readonly expected: string }[] = [
		{ input: "2026-09-02T09:00", deltaMs: 7 * DAY_MS, expected: "2026-09-09T09:00" },
		// Crosses the Europe/Rome spring-forward Sunday (2026-03-29): wall-clock
		// time-of-day is preserved exactly, unaffected by any real DST shift.
		{ input: "2026-03-25T09:00", deltaMs: 7 * DAY_MS, expected: "2026-04-01T09:00" },
		// Crosses the Europe/Rome fall-back Sunday (2026-10-25).
		{ input: "2026-10-21T09:00", deltaMs: 7 * DAY_MS, expected: "2026-10-28T09:00" },
		{ input: "2026-09-02", deltaMs: -DAY_MS, expected: "2026-09-01" },
	];

	it.each(table)("$input shifted by $deltaMs ms -> $expected", ({ input, deltaMs, expected }) => {
		expect(shiftBy(mustParse(input), deltaMs)).toBe(expected);
	});
});

describe("compareTaskDate", () => {
	it("orders dates ascending", () => {
		expect(compareTaskDate(mustParse("2026-09-01"), mustParse("2026-09-02"))).toBeLessThan(0);
		expect(compareTaskDate(mustParse("2026-09-02"), mustParse("2026-09-01"))).toBeGreaterThan(0);
		expect(compareTaskDate(mustParse("2026-09-02"), mustParse("2026-09-02"))).toBe(0);
	});

	it("treats a date-only value as midnight when compared to a datetime on the same day", () => {
		expect(compareTaskDate(mustParse("2026-09-02"), mustParse("2026-09-02T00:01"))).toBeLessThan(0);
	});
});

describe("toFloatingDate / fromFloatingDate", () => {
	it("round-trips through UTC fields regardless of the system timezone", () => {
		const date = mustParse("2026-09-02T09:30");
		const floating = toFloatingDate(date);
		expect(floating.getUTCFullYear()).toBe(2026);
		expect(floating.getUTCMonth()).toBe(8);
		expect(floating.getUTCDate()).toBe(2);
		expect(floating.getUTCHours()).toBe(9);
		expect(floating.getUTCMinutes()).toBe(30);
		expect(fromFloatingDate(floating, true)).toBe("2026-09-02T09:30");
	});

	it("formats as date-only when hasTime is false", () => {
		const floating = toFloatingDate(mustParse("2026-09-02"));
		expect(fromFloatingDate(floating, false)).toBe("2026-09-02");
	});
});

describe("startOfWeek / endOfWeek", () => {
	// Worked example from docs/DOMAIN-MODEL.md: now = Wed 2026-09-02, Monday start.
	it("Monday-first: Wed 2026-09-02 -> Mon 2026-08-31 .. Sun 2026-09-06", () => {
		const date = mustParse("2026-09-02");
		expect(startOfWeek(date, 0)).toBe("2026-08-31");
		expect(endOfWeek(date, 0)).toBe("2026-09-06");
	});

	it("Sunday-first: Wed 2026-09-02 -> Sun 2026-08-30 .. Sat 2026-09-05", () => {
		const date = mustParse("2026-09-02");
		expect(startOfWeek(date, 6)).toBe("2026-08-30");
		expect(endOfWeek(date, 6)).toBe("2026-09-05");
	});

	it("Monday-first: a Sunday belongs to the week that started the previous Monday", () => {
		const sunday = mustParse("2026-09-06");
		expect(startOfWeek(sunday, 0)).toBe("2026-08-31");
		expect(endOfWeek(sunday, 0)).toBe("2026-09-06");
	});

	it("Monday-first: a Monday starts its own week", () => {
		const monday = mustParse("2026-09-07");
		expect(startOfWeek(monday, 0)).toBe("2026-09-07");
		expect(endOfWeek(monday, 0)).toBe("2026-09-13");
	});
});

describe("toSundayFirstWeekday", () => {
	// Monday-first Weekday (0=Mon..6=Sun) -> Sunday-first (0=Sun..6=Sat), the
	// convention date-fns' weekStartsOn and @event-calendar/core's firstDay
	// both use.
	it.each([
		[0, 1], // Monday -> 1
		[1, 2], // Tuesday -> 2
		[2, 3], // Wednesday -> 3
		[3, 4], // Thursday -> 4
		[4, 5], // Friday -> 5
		[5, 6], // Saturday -> 6
		[6, 0], // Sunday -> 0
	] as const)("maps Weekday %i to %i", (input, expected) => {
		expect(toSundayFirstWeekday(input)).toBe(expected);
	});
});
