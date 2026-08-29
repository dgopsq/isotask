import { describe, expect, it } from "vitest";

import { PRIORITIES, priorityChipClass, priorityLabel, priorityRank } from "@/domain/task";

describe("priorityRank", () => {
	it("orders priorities low to high", () => {
		const ranks = PRIORITIES.map(priorityRank);
		expect(ranks).toEqual([0, 1, 2, 3]);
	});

	it("is strictly increasing across the fixed priority set", () => {
		for (let i = 1; i < PRIORITIES.length; i += 1) {
			const previous = PRIORITIES[i - 1];
			const current = PRIORITIES[i];
			if (previous === undefined || current === undefined) {
				throw new Error("unreachable");
			}
			expect(priorityRank(current)).toBeGreaterThan(priorityRank(previous));
		}
	});
});

describe("priorityChipClass", () => {
	it.each(PRIORITIES)("maps %s to a distinct priority-<value> class suffix", (priority) => {
		expect(priorityChipClass(priority)).toBe(`priority-${priority}`);
	});

	it("produces a distinct class per priority", () => {
		const classes = new Set(PRIORITIES.map(priorityChipClass));
		expect(classes.size).toBe(PRIORITIES.length);
	});
});

describe("priorityLabel", () => {
	it("capitalises each priority", () => {
		expect(PRIORITIES.map(priorityLabel)).toEqual(["Low", "Normal", "High", "Urgent"]);
	});

	it("produces a distinct label per priority", () => {
		const labels = new Set(PRIORITIES.map(priorityLabel));
		expect(labels.size).toBe(PRIORITIES.length);
	});
});
