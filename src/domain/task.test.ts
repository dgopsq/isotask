import { describe, expect, it } from "vitest";

import { describeTaskParseError, PRIORITIES, priorityChipClass, priorityLabel, priorityRank } from "@/domain/task";
import type { TaskParseError } from "@/domain/task";

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

describe("describeTaskParseError", () => {
	it("includes the allowed values for an unknown status", () => {
		const error: TaskParseError = { kind: "unknown-status", value: "banana", allowed: ["todo", "done"] };
		expect(describeTaskParseError(error)).toBe('Unknown status "banana" (allowed: todo, done)');
	});

	it("includes the allowed values for an invalid priority", () => {
		const error: TaskParseError = { kind: "invalid-priority", value: "hgih", allowed: PRIORITIES };
		expect(describeTaskParseError(error)).toBe('Invalid priority "hgih" (allowed: low, normal, high, urgent)');
	});

	it("names the offending property for an invalid date", () => {
		const error: TaskParseError = { kind: "invalid-date", property: "due", value: "not-a-date" };
		expect(describeTaskParseError(error)).toBe('Invalid due "not-a-date"');
	});

	it.each<[TaskParseError, string]>([
		[{ kind: "not-a-task" }, "Not a task note"],
		[{ kind: "missing-status" }, "Missing status"],
		[{ kind: "invalid-duration", value: "abc" }, 'Invalid duration "abc"'],
		[{ kind: "invalid-tags", value: "5" }, 'Invalid tags "5"'],
		[{ kind: "invalid-project", value: "5" }, 'Invalid project "5"'],
		[{ kind: "recurrence-without-anchor" }, "Recurring task has no due or scheduled date to anchor from"],
	])("describes %o as %s", (error, expected) => {
		expect(describeTaskParseError(error)).toBe(expected);
	});
});
