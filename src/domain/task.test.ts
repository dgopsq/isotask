import { describe, expect, it } from "vitest";

import { PRIORITIES, priorityRank } from "@/domain/task";

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
