import { describe, expect, it, vi } from "vitest";

// Domain arithmetic must be immune to the real system timezone (rrule and
// dates.ts both use "floating"/naive-UTC representations, see
// docs/adr/0005-recurrence-rrule-spawn-new-note.md and dates.ts's
// toFloatingDate/fromFloatingDate). Pinning TZ to Europe/Rome makes the DST
// transition-day cases in this file an actual test of that, rather than an
// accident of whatever machine runs the suite. `vi.stubEnv` (rather than the
// bare `process` global) keeps this file within src/'s Node-free typecheck.
vi.stubEnv("TZ", "Europe/Rome");

import type { TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { describeRRule, nextOccurrence, parseRRule, RECURRENCE_PRESETS } from "@/domain/recurrence";
import { isErr, isNone, isOk, isSome } from "@/domain/result";
import type { RRuleString } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

function rule(body: string): RRuleString {
	const result = parseRRule(body);
	if (!result.ok) {
		throw new Error(`bad fixture rule ${body}: ${JSON.stringify(result.error)}`);
	}
	return result.value;
}

describe("parseRRule", () => {
	const valid: readonly { readonly input: string; readonly expected: string }[] = [
		{ input: "FREQ=WEEKLY;BYDAY=MO", expected: "FREQ=WEEKLY;BYDAY=MO" },
		{ input: "  freq=daily  ", expected: "FREQ=DAILY" }, // trims + uppercases
		{ input: "freq=weekly;byday=mo,we,fr", expected: "FREQ=WEEKLY;BYDAY=MO,WE,FR" }, // lowercase BYDAY normalises
		{ input: "FREQ=MONTHLY;BYMONTHDAY=31", expected: "FREQ=MONTHLY;BYMONTHDAY=31" },
		{ input: "FREQ=YEARLY;INTERVAL=2", expected: "FREQ=YEARLY;INTERVAL=2" },
	];

	it.each(valid)("accepts and normalises $input", ({ input, expected }) => {
		const result = parseRRule(input);
		expect(isOk(result)).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(expected);
		}
	});

	it("rejects an empty body", () => {
		const result = parseRRule("");
		expect(isErr(result)).toBe(true);
		if (!result.ok) {
			expect(result.error.kind).toBe("empty");
		}
	});

	it("rejects a whitespace-only body", () => {
		const result = parseRRule("   ");
		expect(isErr(result)).toBe(true);
		if (!result.ok) {
			expect(result.error.kind).toBe("empty");
		}
	});

	it.each(["DTSTART:20260101T000000Z\nFREQ=DAILY", "FREQ=DAILY;DTSTART=20260101", "dtstart=20260101"])(
		"rejects a body containing DTSTART: %s",
		(input) => {
			const result = parseRRule(input);
			expect(isErr(result)).toBe(true);
			if (!result.ok) {
				expect(result.error.kind).toBe("contains-dtstart");
			}
		},
	);

	it.each(["FOO=BAR", "FREQ=NONSENSE", "FREQ=WEEKLY;BYDAY=XX", "BYDAY=MO"])("rejects unparsable input: %s", (input) => {
		const result = parseRRule(input);
		expect(isErr(result)).toBe(true);
		if (!result.ok) {
			expect(result.error.kind).toBe("unparsable");
		}
	});
});

describe("nextOccurrence", () => {
	it("returns the first occurrence strictly after the anchor, not the anchor itself", () => {
		const result = nextOccurrence(rule("FREQ=DAILY"), date("2026-09-02"));
		expect(isSome(result)).toBe(true);
		if (result.some) {
			expect(result.value).toBe("2026-09-03");
		}
	});

	it("date-only anchor -> date-only result", () => {
		const result = nextOccurrence(rule("FREQ=DAILY"), date("2026-09-02"));
		expect(result.some && result.value).toBe("2026-09-03");
	});

	it("datetime anchor -> datetime result with the same time-of-day", () => {
		const result = nextOccurrence(rule("FREQ=DAILY"), date("2026-09-02T09:30"));
		expect(result.some && result.value).toBe("2026-09-03T09:30");
	});

	it("FREQ=WEEKLY without BYDAY follows the anchor's weekday (RFC 5545)", () => {
		// 2026-09-02 is a Wednesday.
		const result = nextOccurrence(rule("FREQ=WEEKLY"), date("2026-09-02"));
		expect(result.some && result.value).toBe("2026-09-09");
	});

	it("FREQ=MONTHLY without BYMONTHDAY follows the anchor's day-of-month, skipping short months", () => {
		// Jan 31 -> next occurrence is Mar 31 (Feb has no 31st).
		const result = nextOccurrence(rule("FREQ=MONTHLY"), date("2026-01-31"));
		expect(result.some && result.value).toBe("2026-03-31");
	});

	it("BYMONTHDAY=31 explicitly skips months without a 31st", () => {
		const result = nextOccurrence(rule("FREQ=MONTHLY;BYMONTHDAY=31"), date("2026-01-31"));
		expect(result.some && result.value).toBe("2026-03-31");
	});

	it("weekdays preset skips a weekend", () => {
		// 2026-09-04 is a Friday.
		const result = nextOccurrence(rule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"), date("2026-09-04T09:00"));
		expect(result.some && result.value).toBe("2026-09-07T09:00");
	});

	it("preserves wall-clock time across the Europe/Rome spring-forward day (2026-03-29)", () => {
		const result = nextOccurrence(rule("FREQ=DAILY"), date("2026-03-28T09:00"));
		expect(result.some && result.value).toBe("2026-03-29T09:00");
	});

	it("preserves wall-clock time across the Europe/Rome fall-back day (2026-10-25)", () => {
		const result = nextOccurrence(rule("FREQ=DAILY"), date("2026-10-24T09:00"));
		expect(result.some && result.value).toBe("2026-10-25T09:00");
	});

	it("handles a leap-day anchor (2028-02-29), landing on the next leap year", () => {
		const result = nextOccurrence(rule("FREQ=YEARLY"), date("2028-02-29"));
		expect(result.some && result.value).toBe("2032-02-29");
	});

	it("returns none when the series is exhausted", () => {
		const result = nextOccurrence(rule("FREQ=DAILY;COUNT=1"), date("2026-09-02"));
		expect(isNone(result)).toBe(true);
	});

	it("every-2-weeks preset steps by 14 days", () => {
		const result = nextOccurrence(rule("FREQ=WEEKLY;INTERVAL=2"), date("2026-09-02"));
		expect(result.some && result.value).toBe("2026-09-16");
	});
});

describe("describeRRule", () => {
	it.each([
		{ input: "FREQ=DAILY", expected: "every day" },
		{ input: "FREQ=WEEKLY", expected: "every week" },
		{ input: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", expected: "every weekday" },
	])("describes $input as $expected", ({ input, expected }) => {
		expect(describeRRule(rule(input))).toBe(expected);
	});

	it("falls back to the raw body when the rule can't be parsed", () => {
		const raw = "NOT-A-REAL-RULE" as RRuleString;
		expect(describeRRule(raw)).toBe(raw);
	});
});

describe("RECURRENCE_PRESETS", () => {
	it("has one entry per documented preset, each a valid RRULE body", () => {
		const ids = RECURRENCE_PRESETS.map((preset) => preset.id);
		expect(ids).toEqual(["daily", "weekdays", "weekly", "every-2-weeks", "monthly", "yearly"]);
		for (const preset of RECURRENCE_PRESETS) {
			expect(isOk(parseRRule(preset.rule))).toBe(true);
		}
	});

	it.each([
		{ id: "daily", anchor: "2026-09-02", expected: "2026-09-03" },
		{ id: "weekdays", anchor: "2026-09-04", expected: "2026-09-07" }, // Fri -> Mon
		{ id: "weekly", anchor: "2026-09-02", expected: "2026-09-09" }, // Wed -> next Wed
		{ id: "every-2-weeks", anchor: "2026-09-02", expected: "2026-09-16" },
		{ id: "monthly", anchor: "2026-01-31", expected: "2026-03-31" }, // day-of-month, skips Feb
		{ id: "yearly", anchor: "2028-02-29", expected: "2032-02-29" }, // leap day
	])("$id computes the expected next occurrence from its anchor", ({ id, anchor, expected }) => {
		const preset = RECURRENCE_PRESETS.find((p) => p.id === id);
		if (preset === undefined) {
			throw new Error(`unreachable: missing preset ${id}`);
		}
		const result = nextOccurrence(preset.rule, date(anchor));
		expect(result.some && result.value).toBe(expected);
	});
});
