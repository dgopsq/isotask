import { describe, expect, it } from "vitest";

import { formatDurationMinutes } from "@/domain/task-display";
import type { Minutes } from "@/domain/task";

function minutes(value: number): Minutes {
	return value as Minutes;
}

describe("formatDurationMinutes", () => {
	it("renders minutes only under an hour", () => {
		expect(formatDurationMinutes(minutes(0))).toBe("0m");
		expect(formatDurationMinutes(minutes(45))).toBe("45m");
	});

	it("renders whole hours with no remainder", () => {
		expect(formatDurationMinutes(minutes(60))).toBe("1h");
		expect(formatDurationMinutes(minutes(120))).toBe("2h");
	});

	it("renders hours and minutes together", () => {
		expect(formatDurationMinutes(minutes(90))).toBe("1h 30m");
		expect(formatDurationMinutes(minutes(135))).toBe("2h 15m");
	});

	it("rounds a fractional minute count", () => {
		expect(formatDurationMinutes(minutes(90.6))).toBe("1h 31m");
	});

	it("clamps a negative value to zero", () => {
		expect(formatDurationMinutes(minutes(-15))).toBe("0m");
	});
});
