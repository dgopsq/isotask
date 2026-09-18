import { describe, expect, it } from "vitest";

import { djb2a } from "@/domain/hash";

describe("djb2a", () => {
	// Locks in the exact numeric output — frozen algorithm, see the doc comment.
	it.each([
		["Work", 2089283844],
		["", 5381],
	] as const)("hashes %p to %i", (input, expected) => {
		expect(djb2a(input)).toBe(expected);
	});

	it("is deterministic", () => {
		expect(djb2a("Consistency")).toBe(djb2a("Consistency"));
	});
});
