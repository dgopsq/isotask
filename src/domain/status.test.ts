import { describe, expect, it } from "vitest";

import { DEFAULT_STATUSES, findStatus, firstOpenStatus, isTerminal, nextStatusInCycle } from "@/domain/status";
import { isNone, isSome } from "@/domain/result";
import type { StatusId } from "@/domain/task";

function id(value: string): StatusId {
	return value as StatusId;
}

describe("isTerminal", () => {
	it.each([
		["open", false],
		["active", false],
		["done", true],
		["cancelled", true],
	] as const)("%s -> %s", (kind, expected) => {
		expect(isTerminal(kind)).toBe(expected);
	});
});

describe("findStatus", () => {
	it("finds a configured status by id", () => {
		const result = findStatus(DEFAULT_STATUSES, id("done"));
		expect(isSome(result)).toBe(true);
		if (result.some) {
			expect(result.value.kind).toBe("done");
		}
	});

	it("returns none for an unknown id", () => {
		expect(isNone(findStatus(DEFAULT_STATUSES, id("nope")))).toBe(true);
	});
});

describe("firstOpenStatus", () => {
	it("returns the first status with kind open", () => {
		const result = firstOpenStatus(DEFAULT_STATUSES);
		expect(isSome(result)).toBe(true);
		if (result.some) {
			expect(result.value.id).toBe("todo");
		}
	});

	it("returns none when no status has kind open", () => {
		const noOpen = DEFAULT_STATUSES.filter((s) => s.kind !== "open");
		expect(isNone(firstOpenStatus(noOpen))).toBe(true);
	});
});

describe("nextStatusInCycle", () => {
	it("walks the status list in id order", () => {
		// id order: cancelled, done, in-progress, todo
		const first = nextStatusInCycle(DEFAULT_STATUSES, id("cancelled"));
		expect(first.some && first.value.id).toBe("done");

		const second = nextStatusInCycle(DEFAULT_STATUSES, id("done"));
		expect(second.some && second.value.id).toBe("in-progress");
	});

	it("wraps around after the last status in id order", () => {
		const wrapped = nextStatusInCycle(DEFAULT_STATUSES, id("todo"));
		expect(wrapped.some && wrapped.value.id).toBe("cancelled");
	});

	it("falls back to the first status in id order when currentId is unknown", () => {
		const result = nextStatusInCycle(DEFAULT_STATUSES, id("nope"));
		expect(result.some && result.value.id).toBe("cancelled");
	});

	it("returns none for an empty status list", () => {
		expect(isNone(nextStatusInCycle([], id("todo")))).toBe(true);
	});
});
