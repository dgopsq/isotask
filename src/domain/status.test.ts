import { describe, expect, it } from "vitest";

import { DEFAULT_STATUSES, findStatus, firstDoneStatus, firstOpenStatus, isTerminal, nextStatusInCycle, toggleStatus } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";
import { isNone, isSome } from "@/domain/result";
import type { StatusId } from "@/domain/task";

function id(value: string): StatusId {
	return value as StatusId;
}

/** A four-status list (open/active/done/cancelled) for tests that need coverage beyond the two-status defaults. */
const FOUR_STATUSES: readonly StatusConfig[] = [
	{ id: id("todo"), label: "To do", kind: "open" },
	{ id: id("in-progress"), label: "In progress", kind: "active" },
	{ id: id("done"), label: "Done", kind: "done" },
	{ id: id("cancelled"), label: "Cancelled", kind: "cancelled" },
];

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
	it("walks the status list in configured order", () => {
		// configured order: todo, in-progress, done, cancelled
		const first = nextStatusInCycle(FOUR_STATUSES, id("todo"));
		expect(first.some && first.value.id).toBe("in-progress");

		const second = nextStatusInCycle(FOUR_STATUSES, id("in-progress"));
		expect(second.some && second.value.id).toBe("done");
	});

	it("wraps around after the last status in configured order", () => {
		const wrapped = nextStatusInCycle(FOUR_STATUSES, id("cancelled"));
		expect(wrapped.some && wrapped.value.id).toBe("todo");
	});

	it("falls back to the first status in configured order when currentId is unknown", () => {
		const result = nextStatusInCycle(FOUR_STATUSES, id("nope"));
		expect(result.some && result.value.id).toBe("todo");
	});

	it("returns none for an empty status list", () => {
		expect(isNone(nextStatusInCycle([], id("todo")))).toBe(true);
	});
});

describe("firstDoneStatus", () => {
	it("returns the first status with kind done", () => {
		const result = firstDoneStatus(FOUR_STATUSES);
		expect(isSome(result)).toBe(true);
		if (result.some) {
			expect(result.value.id).toBe("done");
		}
	});

	it("returns none when no status has kind done", () => {
		const noDone = FOUR_STATUSES.filter((s) => s.kind !== "done");
		expect(isNone(firstDoneStatus(noDone))).toBe(true);
	});
});

describe("toggleStatus", () => {
	it("open -> done", () => {
		const result = toggleStatus(FOUR_STATUSES, id("todo"));
		expect(result.some && result.value.id).toBe("done");
	});

	it("active -> done", () => {
		const result = toggleStatus(FOUR_STATUSES, id("in-progress"));
		expect(result.some && result.value.id).toBe("done");
	});

	it("done -> open (first open status)", () => {
		const result = toggleStatus(FOUR_STATUSES, id("done"));
		expect(result.some && result.value.id).toBe("todo");
	});

	it("cancelled -> open (first open status)", () => {
		const result = toggleStatus(FOUR_STATUSES, id("cancelled"));
		expect(result.some && result.value.id).toBe("todo");
	});

	it("unknown id -> done (treated as non-terminal)", () => {
		const result = toggleStatus(FOUR_STATUSES, id("nope"));
		expect(result.some && result.value.id).toBe("done");
	});

	it("returns none when no done status is configured", () => {
		const noDone = FOUR_STATUSES.filter((s) => s.kind !== "done");
		expect(isNone(toggleStatus(noDone, id("todo")))).toBe(true);
	});

	it("returns none when no open status is configured (toggling from terminal)", () => {
		const noOpen = FOUR_STATUSES.filter((s) => s.kind !== "open");
		expect(isNone(toggleStatus(noOpen, id("done")))).toBe(true);
	});
});
