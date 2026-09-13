import { describe, expect, it } from "vitest";

import { completionDrift } from "@/domain/completion-drift";
import type { TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { StatusId, Task, TaskPath } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

function task(overrides: Partial<Task> & { readonly status: StatusId }): Task {
	return {
		path: "Buy milk.md" as TaskPath,
		title: "Buy milk",
		priority: "normal",
		tags: [],
		...overrides,
	};
}

function statusId(value: string): StatusId {
	return value as StatusId;
}

describe("completionDrift", () => {
	it("done status, no completed -> complete (external mark-as-done)", () => {
		const t = task({ status: statusId("done") });
		expect(completionDrift(t, DEFAULT_STATUSES)).toBe("complete");
	});

	it("done status, completed present -> none (already consistent)", () => {
		const t = task({ status: statusId("done"), completed: date("2026-09-02T10:00") });
		expect(completionDrift(t, DEFAULT_STATUSES)).toBe("none");
	});

	it("open status, completed present -> reopen (external reopen)", () => {
		const t = task({ status: statusId("todo"), completed: date("2026-08-01T09:00") });
		expect(completionDrift(t, DEFAULT_STATUSES)).toBe("reopen");
	});

	it("open status, no completed -> none (already consistent)", () => {
		const t = task({ status: statusId("todo") });
		expect(completionDrift(t, DEFAULT_STATUSES)).toBe("none");
	});

	it("status that fails to resolve -> none (defensive, not treated as drift)", () => {
		const t = task({ status: statusId("nope"), completed: date("2026-08-01T09:00") });
		expect(completionDrift(t, DEFAULT_STATUSES)).toBe("none");
	});
});
