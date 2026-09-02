import { describe, expect, it, vi } from "vitest";

// See recurrence.test.ts for why this is pinned and why via `vi.stubEnv`.
vi.stubEnv("TZ", "Europe/Rome");

import type { IsoDateTime, TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import type { FrontmatterValue } from "@/domain/frontmatter";
import { taskToPatch } from "@/domain/frontmatter";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { parseRRule } from "@/domain/recurrence";
import { isNone, isSome } from "@/domain/result";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";
import { applyStatusChange, seriesTitle, spawnBasename } from "@/domain/transitions";
import type { StatusChangeInput } from "@/domain/transitions";
import type { RRuleString, StatusId, Task, TaskPath } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

function iso(value: string): IsoDateTime {
	return value as IsoDateTime;
}

function rule(body: string): RRuleString {
	const result = parseRRule(body);
	if (!result.ok) {
		throw new Error(`bad fixture rule ${body}`);
	}
	return result.value;
}

function statusOf(id: string): StatusConfig {
	const found = DEFAULT_STATUSES.find((s) => s.id === id);
	if (found === undefined) {
		throw new Error(`unreachable: missing status ${id}`);
	}
	return found;
}

const TODO = statusOf("todo");
const DONE = statusOf("done");
const NOW = iso("2026-09-02T10:00");

function task(overrides: Partial<Task> & { readonly title: string }): Task {
	return {
		path: `${overrides.title}.md` as TaskPath,
		status: "todo" as StatusId,
		priority: "normal",
		tags: [],
		...overrides,
	};
}

/** Builds the raw frontmatter record `applyStatusChange` would see for a given task, via the existing task -> patch serialiser. */
function rawFor(t: Task): Readonly<Record<string, FrontmatterValue>> {
	const patch = taskToPatch(t, DEFAULT_PROPERTY_KEYS);
	const entries = Object.entries(patch).filter((entry): entry is [string, FrontmatterValue] => entry[1] !== null);
	return Object.fromEntries(entries);
}

function inputFor(t: Task, to: StatusConfig, overrides: Partial<StatusChangeInput> = {}): StatusChangeInput {
	return {
		task: t,
		raw: rawFor(t),
		basename: t.title,
		to,
		statuses: DEFAULT_STATUSES,
		keys: DEFAULT_PROPERTY_KEYS,
		now: NOW,
		spawnTemplate: "{{title}} {{due}}",
		...overrides,
	};
}

describe("seriesTitle", () => {
	it.each([
		["Buy milk 2026-09-02", "Buy milk"],
		["Buy milk", "Buy milk"],
		// Only the trailing date is stripped, not an earlier one embedded in the title.
		["Report Q3 2026-09-02 2026-09-09", "Report Q3 2026-09-02"],
		["2026-09-02", "2026-09-02"], // no " " prefix before the date -> not stripped
	])("%s -> %s", (basename, expected) => {
		expect(seriesTitle(basename)).toBe(expected);
	});
});

describe("spawnBasename", () => {
	it("expands {{title}} and {{due}}, date part only", () => {
		expect(spawnBasename("{{title}} {{due}}", "Buy milk", date("2026-09-09T14:30"))).toBe("Buy milk 2026-09-09");
	});

	it("expands a date-only due unchanged", () => {
		expect(spawnBasename("{{title}} {{due}}", "Buy milk", date("2026-09-09"))).toBe("Buy milk 2026-09-09");
	});

	it("replaces every occurrence of a placeholder", () => {
		expect(spawnBasename("{{title}}/{{title}} ({{due}})", "Buy milk", date("2026-09-09"))).toBe(
			"Buy milk/Buy milk (2026-09-09)",
		);
	});

	it("leaves a template with no placeholders untouched", () => {
		expect(spawnBasename("fixed name", "Buy milk", date("2026-09-09"))).toBe("fixed name");
	});
});

describe("applyStatusChange — patch", () => {
	it("same-status transition: empty patch, no spawn", () => {
		const t = task({ title: "Buy milk", status: "todo" as StatusId });
		const result = applyStatusChange(inputFor(t, TODO));
		expect(result.patch).toEqual({});
		expect(isNone(result.spawn)).toBe(true);
	});

	it("open -> done: sets completed to now", () => {
		const t = task({ title: "Buy milk", status: "todo" as StatusId });
		const result = applyStatusChange(inputFor(t, DONE));
		expect(result.patch).toEqual({ status: "done", completed: NOW });
	});

	it("done -> open (reopen): clears completed", () => {
		const t = task({ title: "Buy milk", status: "done" as StatusId, completed: date("2026-08-01T09:00") });
		const result = applyStatusChange(inputFor(t, TODO));
		expect(result.patch).toEqual({ status: "todo", completed: null });
	});
});

describe("applyStatusChange — spawn", () => {
	it("no repeat: no spawn even when entering done", () => {
		const t = task({ title: "Buy milk", status: "todo" as StatusId, due: date("2026-09-02") });
		const result = applyStatusChange(inputFor(t, DONE));
		expect(isNone(result.spawn)).toBe(true);
	});

	it("repeat but no anchor (no due, no scheduled): no spawn", () => {
		const t = task({ title: "Buy milk", status: "todo" as StatusId, repeat: rule("FREQ=WEEKLY") });
		const result = applyStatusChange(inputFor(t, DONE));
		expect(isNone(result.spawn)).toBe(true);
	});

	it("series exhausted (COUNT=1): no spawn", () => {
		const t = task({
			title: "Buy milk",
			status: "todo" as StatusId,
			due: date("2026-09-02"),
			repeat: rule("FREQ=DAILY;COUNT=1"),
		});
		const result = applyStatusChange(inputFor(t, DONE));
		expect(isNone(result.spawn)).toBe(true);
	});

	it("no configured open status: no spawn", () => {
		const t = task({
			title: "Buy milk",
			status: "todo" as StatusId,
			due: date("2026-09-02"),
			repeat: rule("FREQ=WEEKLY"),
		});
		const noOpenStatuses = DEFAULT_STATUSES.filter((s) => s.kind !== "open");
		const result = applyStatusChange(inputFor(t, DONE, { statuses: noOpenStatuses }));
		expect(isNone(result.spawn)).toBe(true);
	});

	it("due-anchored weekly repeat spawns the next occurrence", () => {
		const t = task({
			title: "Buy milk 2026-09-02",
			status: "todo" as StatusId,
			due: date("2026-09-02"), // Wednesday
			repeat: rule("FREQ=WEEKLY"),
			priority: "high",
			tags: ["errand"],
		});
		const result = applyStatusChange(inputFor(t, DONE, { basename: "Buy milk 2026-09-02" }));

		expect(isSome(result.spawn)).toBe(true);
		if (!result.spawn.some) {
			throw new Error("unreachable");
		}
		const plan = result.spawn.value;
		expect(plan.basename).toBe("Buy milk 2026-09-09");
		expect(plan.nextDue.some && plan.nextDue.value).toBe("2026-09-09");
		expect(isNone(plan.nextScheduled)).toBe(true);
		expect(plan.frontmatter).toEqual({
			type: "task",
			status: "todo",
			priority: "high",
			tags: ["errand"],
			due: "2026-09-09",
			repeat: "FREQ=WEEKLY",
			created: NOW,
		});
	});

	it("scheduled-anchored repeat shifts scheduled (due absent)", () => {
		const t = task({
			title: "Water plants",
			status: "todo" as StatusId,
			scheduled: date("2026-09-02T08:00"),
			repeat: rule("FREQ=DAILY"),
		});
		const result = applyStatusChange(inputFor(t, DONE, { basename: "Water plants" }));

		expect(isSome(result.spawn)).toBe(true);
		if (!result.spawn.some) {
			throw new Error("unreachable");
		}
		const plan = result.spawn.value;
		expect(isNone(plan.nextDue)).toBe(true);
		expect(plan.nextScheduled.some && plan.nextScheduled.value).toBe("2026-09-03T08:00");
		// due is absent, so the anchor (scheduled) still drives the filename via spawnBasename's {{due}} slot.
		expect(plan.basename).toBe("Water plants 2026-09-03");
	});

	it("both due and scheduled present: both shift by the same delta", () => {
		const t = task({
			title: "Team sync 2026-09-02",
			status: "todo" as StatusId,
			due: date("2026-09-02"),
			scheduled: date("2026-09-02T09:00"),
			repeat: rule("FREQ=WEEKLY"),
		});
		const result = applyStatusChange(inputFor(t, DONE, { basename: "Team sync 2026-09-02" }));

		expect(isSome(result.spawn)).toBe(true);
		if (!result.spawn.some) {
			throw new Error("unreachable");
		}
		const plan = result.spawn.value;
		expect(plan.nextDue.some && plan.nextDue.value).toBe("2026-09-09");
		expect(plan.nextScheduled.some && plan.nextScheduled.value).toBe("2026-09-09T09:00");
	});

	it("spawn frontmatter: status reset to first open status, completed removed, created = now, other fields carried", () => {
		const t = task({
			title: "Buy milk 2026-09-02",
			status: "todo" as StatusId,
			due: date("2026-09-02"),
			repeat: rule("FREQ=WEEKLY"),
			project: "Groceries",
			created: date("2026-01-01T00:00"),
			completed: date("2026-08-01T09:00"),
		});
		const result = applyStatusChange(inputFor(t, DONE, { basename: "Buy milk 2026-09-02" }));

		expect(isSome(result.spawn)).toBe(true);
		if (!result.spawn.some) {
			throw new Error("unreachable");
		}
		const frontmatter = result.spawn.value.frontmatter;
		expect(frontmatter["status"]).toBe("todo");
		expect(frontmatter["created"]).toBe(NOW);
		expect("completed" in frontmatter).toBe(false);
		expect(frontmatter["project"]).toBe("[[Groceries]]");
	});

	it("idempotent: applying the same input twice yields identical results", () => {
		const t = task({
			title: "Buy milk 2026-09-02",
			status: "todo" as StatusId,
			due: date("2026-09-02"),
			repeat: rule("FREQ=WEEKLY"),
		});
		const input = inputFor(t, DONE, { basename: "Buy milk 2026-09-02" });
		const first = applyStatusChange(input);
		const second = applyStatusChange(input);
		expect(second).toEqual(first);
	});
});
