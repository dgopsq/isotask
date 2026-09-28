import { describe, expect, it } from "vitest";

import { countNeedingAttention } from "@/domain/attention";
import type { IsoDate, TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { Task, TaskPath } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

const TODAY = date("2026-09-02") as IsoDate;

function task(overrides: Partial<Task> = {}): Task {
	return {
		path: "t.md" as TaskPath,
		title: "t",
		status: "todo" as Task["status"],
		priority: "normal",
		tags: [],
		...overrides,
	};
}

describe("countNeedingAttention", () => {
	it("counts overdue tasks", () => {
		expect(countNeedingAttention([task({ due: date("2026-09-01") })], DEFAULT_STATUSES, TODAY)).toBe(1);
	});

	it("counts tasks due today", () => {
		expect(countNeedingAttention([task({ due: date("2026-09-02") })], DEFAULT_STATUSES, TODAY)).toBe(1);
	});

	it("counts a datetime due later today", () => {
		expect(countNeedingAttention([task({ due: date("2026-09-02T23:30") })], DEFAULT_STATUSES, TODAY)).toBe(1);
	});

	it("skips future tasks", () => {
		expect(countNeedingAttention([task({ due: date("2026-09-03") })], DEFAULT_STATUSES, TODAY)).toBe(0);
	});

	it("skips tasks without a due date", () => {
		expect(countNeedingAttention([task()], DEFAULT_STATUSES, TODAY)).toBe(0);
	});

	it("skips tasks with only a scheduled date", () => {
		expect(countNeedingAttention([task({ scheduled: date("2026-09-01") })], DEFAULT_STATUSES, TODAY)).toBe(0);
	});

	it("skips terminal-status tasks", () => {
		expect(countNeedingAttention([task({ status: "done" as Task["status"], due: date("2026-09-01") })], DEFAULT_STATUSES, TODAY)).toBe(0);
	});

	it("counts a task with an unknown status as open", () => {
		expect(countNeedingAttention([task({ status: "mystery" as Task["status"], due: date("2026-09-01") })], DEFAULT_STATUSES, TODAY)).toBe(1);
	});

	it("sums across a mixed list", () => {
		const tasks = [
			task({ title: "a", due: date("2026-08-01") }),
			task({ title: "b", due: date("2026-09-02T08:00") }),
			task({ title: "c", due: date("2026-09-10") }),
			task({ title: "d", status: "done" as Task["status"], due: date("2026-08-01") }),
		];
		expect(countNeedingAttention(tasks, DEFAULT_STATUSES, TODAY)).toBe(2);
	});
});
