import { describe, expect, it } from "vitest";

import type { DateSource } from "@/domain/buckets";
import type { TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { feedRowAnchor, feedRowDefaultDateField } from "@/domain/feed-row";
import type { Task, TaskPath } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

function task(overrides: Partial<Task> & { readonly title: string }): Task {
	return {
		path: `${overrides.title}.md` as TaskPath,
		status: "todo" as Task["status"],
		priority: "normal",
		tags: [],
		...overrides,
	};
}

describe("feedRowAnchor", () => {
	it("due source: due-only task -> field due", () => {
		const t = task({ title: "a", due: date("2026-09-05") });
		expect(feedRowAnchor(t, "due")).toEqual({ some: true, value: { field: "due", value: date("2026-09-05") } });
	});

	it("due source: no due -> none, even if scheduled is set", () => {
		const t = task({ title: "a", scheduled: date("2026-09-05") });
		expect(feedRowAnchor(t, "due")).toEqual({ some: false });
	});

	it("scheduled source: scheduled-only task -> field scheduled", () => {
		const t = task({ title: "a", scheduled: date("2026-09-05") });
		expect(feedRowAnchor(t, "scheduled")).toEqual({ some: true, value: { field: "scheduled", value: date("2026-09-05") } });
	});

	it("scheduled source: no scheduled -> none, even if due is set", () => {
		const t = task({ title: "a", due: date("2026-09-05") });
		expect(feedRowAnchor(t, "scheduled")).toEqual({ some: false });
	});

	it("earliest: due earlier than scheduled -> field due", () => {
		const t = task({ title: "a", due: date("2026-09-05"), scheduled: date("2026-09-10") });
		expect(feedRowAnchor(t, "earliest")).toEqual({ some: true, value: { field: "due", value: date("2026-09-05") } });
	});

	it("earliest: scheduled earlier than due -> field scheduled", () => {
		const t = task({ title: "a", due: date("2026-09-10"), scheduled: date("2026-09-05") });
		expect(feedRowAnchor(t, "earliest")).toEqual({ some: true, value: { field: "scheduled", value: date("2026-09-05") } });
	});

	it("earliest: tie -> field due", () => {
		const t = task({ title: "a", due: date("2026-09-05"), scheduled: date("2026-09-05") });
		expect(feedRowAnchor(t, "earliest")).toEqual({ some: true, value: { field: "due", value: date("2026-09-05") } });
	});

	it("earliest: due only -> field due", () => {
		const t = task({ title: "a", due: date("2026-09-05") });
		expect(feedRowAnchor(t, "earliest")).toEqual({ some: true, value: { field: "due", value: date("2026-09-05") } });
	});

	it("earliest: scheduled only -> field scheduled", () => {
		const t = task({ title: "a", scheduled: date("2026-09-05") });
		expect(feedRowAnchor(t, "earliest")).toEqual({ some: true, value: { field: "scheduled", value: date("2026-09-05") } });
	});

	it("neither due nor scheduled -> none, for every source", () => {
		const t = task({ title: "a" });
		const sources: readonly DateSource[] = ["due", "scheduled", "earliest"];
		for (const source of sources) {
			expect(feedRowAnchor(t, source)).toEqual({ some: false });
		}
	});
});

describe("feedRowDefaultDateField", () => {
	it.each<[DateSource, "due" | "scheduled"]>([
		["due", "due"],
		["scheduled", "scheduled"],
		["earliest", "due"],
	])("%s source -> field %s", (source, expected) => {
		expect(feedRowDefaultDateField(source)).toBe(expected);
	});
});
