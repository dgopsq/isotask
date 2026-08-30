import { describe, expect, it } from "vitest";

import { emptyHistory, pushRedone, pushUndone, record, takeRedo, takeUndo } from "@/domain/history";
import { isNone, isSome } from "@/domain/result";

describe("emptyHistory", () => {
	it("starts with empty past and future", () => {
		const history = emptyHistory<number>();
		expect(history.past).toEqual([]);
		expect(history.future).toEqual([]);
	});
});

describe("record", () => {
	it("appends to past", () => {
		const history = record(record(emptyHistory<number>(), 1, 10), 2, 10);
		expect(history.past).toEqual([1, 2]);
	});

	it("evicts the oldest entries once past would exceed the limit", () => {
		let history = emptyHistory<number>();
		for (const entry of [1, 2, 3, 4]) {
			history = record(history, entry, 3);
		}
		expect(history.past).toEqual([2, 3, 4]);
	});

	it("clears future — a new action invalidates the redo branch", () => {
		const withRedo = { past: [1], future: [2, 3] };
		const history = record(withRedo, 4, 10);
		expect(history.past).toEqual([1, 4]);
		expect(history.future).toEqual([]);
	});
});

describe("takeUndo", () => {
	it("returns none on an empty past", () => {
		expect(isNone(takeUndo(emptyHistory<number>()))).toBe(true);
	});

	it("removes and returns the most recent past entry, leaving future untouched", () => {
		const history = { past: [1, 2, 3], future: [9] };
		const result = takeUndo(history);
		expect(isSome(result)).toBe(true);
		if (result.some) {
			expect(result.value.entry).toBe(3);
			expect(result.value.next).toEqual({ past: [1, 2], future: [9] });
		}
	});
});

describe("takeRedo", () => {
	it("returns none on an empty future", () => {
		expect(isNone(takeRedo(emptyHistory<number>()))).toBe(true);
	});

	it("removes and returns the most recent future entry, leaving past untouched", () => {
		const history = { past: [9], future: [1, 2, 3] };
		const result = takeRedo(history);
		expect(isSome(result)).toBe(true);
		if (result.some) {
			expect(result.value.entry).toBe(3);
			expect(result.value.next).toEqual({ past: [9], future: [1, 2] });
		}
	});
});

describe("pushUndone / pushRedone", () => {
	it("pushUndone appends to future without touching past", () => {
		const history = pushUndone({ past: [1], future: [2] }, 3);
		expect(history).toEqual({ past: [1], future: [2, 3] });
	});

	it("pushRedone appends to past without touching future", () => {
		const history = pushRedone({ past: [1], future: [2] }, 3);
		expect(history).toEqual({ past: [1, 3], future: [2] });
	});
});

describe("undo -> redo -> undo round trip", () => {
	it("moves entries between past and future without losing or duplicating them", () => {
		let history = emptyHistory<string>();
		history = record(history, "a", 10);
		history = record(history, "b", 10);
		history = record(history, "c", 10);

		// undo "c"
		const undo1 = takeUndo(history);
		expect(isSome(undo1)).toBe(true);
		if (!undo1.some) return;
		expect(undo1.value.entry).toBe("c");
		history = pushUndone(undo1.value.next, undo1.value.entry);
		expect(history).toEqual({ past: ["a", "b"], future: ["c"] });

		// redo "c"
		const redo1 = takeRedo(history);
		expect(isSome(redo1)).toBe(true);
		if (!redo1.some) return;
		expect(redo1.value.entry).toBe("c");
		history = pushRedone(redo1.value.next, redo1.value.entry);
		expect(history).toEqual({ past: ["a", "b", "c"], future: [] });

		// undo again
		const undo2 = takeUndo(history);
		expect(isSome(undo2)).toBe(true);
		if (!undo2.some) return;
		expect(undo2.value.entry).toBe("c");
		history = pushUndone(undo2.value.next, undo2.value.entry);
		expect(history).toEqual({ past: ["a", "b"], future: ["c"] });
	});
});

describe("undo then record", () => {
	it("discards the redo branch instead of leaving it stale", () => {
		let history = emptyHistory<string>();
		history = record(history, "a", 10);
		history = record(history, "b", 10);

		const undone = takeUndo(history);
		expect(isSome(undone)).toBe(true);
		if (!undone.some) return;
		history = pushUndone(undone.value.next, undone.value.entry);
		expect(history).toEqual({ past: ["a"], future: ["b"] });

		history = record(history, "c", 10);
		expect(history).toEqual({ past: ["a", "c"], future: [] });
	});
});
