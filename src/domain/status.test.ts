import { describe, expect, it } from "vitest";

import { DEFAULT_STATUSES, findStatus, firstDoneStatus, firstOpenStatus, isTerminal, toggleStatus } from "@/domain/status";
import { isNone, isSome } from "@/domain/result";
import type { StatusId } from "@/domain/task";

function id(value: string): StatusId {
	return value as StatusId;
}

describe("isTerminal", () => {
	it.each([
		["open", false],
		["done", true],
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

describe("firstDoneStatus", () => {
	it("returns the first status with kind done", () => {
		const result = firstDoneStatus(DEFAULT_STATUSES);
		expect(isSome(result)).toBe(true);
		if (result.some) {
			expect(result.value.id).toBe("done");
		}
	});

	it("returns none when no status has kind done", () => {
		const noDone = DEFAULT_STATUSES.filter((s) => s.kind !== "done");
		expect(isNone(firstDoneStatus(noDone))).toBe(true);
	});
});

describe("toggleStatus", () => {
	it("open -> done", () => {
		const result = toggleStatus(DEFAULT_STATUSES, id("todo"));
		expect(result.some && result.value.id).toBe("done");
	});

	it("done -> open (first open status)", () => {
		const result = toggleStatus(DEFAULT_STATUSES, id("done"));
		expect(result.some && result.value.id).toBe("todo");
	});

	it("unknown id -> done (treated as non-terminal)", () => {
		const result = toggleStatus(DEFAULT_STATUSES, id("nope"));
		expect(result.some && result.value.id).toBe("done");
	});

	it("returns none when no done status is configured", () => {
		const noDone = DEFAULT_STATUSES.filter((s) => s.kind !== "done");
		expect(isNone(toggleStatus(noDone, id("todo")))).toBe(true);
	});

	it("returns none when no open status is configured (toggling from terminal)", () => {
		const noOpen = DEFAULT_STATUSES.filter((s) => s.kind !== "open");
		expect(isNone(toggleStatus(noOpen, id("done")))).toBe(true);
	});
});
