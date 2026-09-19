import { describe, expect, it } from "vitest";

import type { DateSource } from "@/domain/buckets";
import type { TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { defaultFeedOrderYaml, feedRowAnchor, feedRowColumns, feedRowDefaultDateField } from "@/domain/feed-row";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import type { PropertyKeys } from "@/domain/property-keys";
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

/** Prefixes bare YAML property names as Bases would when loading a `.base` file's `order:` block, e.g. `"status"` -> `"note.status"`. `"file.name"` is left untouched. */
function toPropertyIds(yamlOrder: readonly string[]): readonly string[] {
	return yamlOrder.map((id) => (id === "file.name" ? id : `note.${id}`));
}

describe("feedRowColumns", () => {
	it("default order -> date, priority, project, tags", () => {
		const order = toPropertyIds(defaultFeedOrderYaml(DEFAULT_PROPERTY_KEYS));
		expect(feedRowColumns(order, DEFAULT_PROPERTY_KEYS)).toEqual([{ kind: "date" }, { kind: "priority" }, { kind: "project" }, { kind: "tags" }]);
	});

	it.each<[readonly string[]]>([[[]], [["file.name"]]])("order %j -> no columns", (order) => {
		expect(feedRowColumns(order, DEFAULT_PROPERTY_KEYS)).toEqual([]);
	});

	it("note.status contributes nothing (status is always rendered)", () => {
		expect(feedRowColumns(["file.name", "note.status"], DEFAULT_PROPERTY_KEYS)).toEqual([]);
	});

	it("note.<markerKey> contributes nothing", () => {
		expect(feedRowColumns(["file.name", "note.type"], DEFAULT_PROPERTY_KEYS)).toEqual([]);
	});

	it("due after scheduled in order -> one date column, at scheduled's position", () => {
		const order = ["file.name", "note.tags", "note.scheduled", "note.due"];
		expect(feedRowColumns(order, DEFAULT_PROPERTY_KEYS)).toEqual([{ kind: "tags" }, { kind: "date" }]);
	});

	it("scheduled after due in order -> one date column, at due's position", () => {
		const order = ["file.name", "note.due", "note.tags", "note.scheduled"];
		expect(feedRowColumns(order, DEFAULT_PROPERTY_KEYS)).toEqual([{ kind: "date" }, { kind: "tags" }]);
	});

	it("file.tags maps to the tags column", () => {
		expect(feedRowColumns(["file.name", "file.tags"], DEFAULT_PROPERTY_KEYS)).toEqual([{ kind: "tags" }]);
	});

	it("note.tags before file.tags -> tags column at note.tags's position, file.tags ignored", () => {
		const order = ["file.name", "note.priority", "note.tags", "file.tags"];
		expect(feedRowColumns(order, DEFAULT_PROPERTY_KEYS)).toEqual([{ kind: "priority" }, { kind: "tags" }]);
	});

	it("custom (non-default) property keys are respected", () => {
		const keys: PropertyKeys = {
			...DEFAULT_PROPERTY_KEYS,
			status: "state",
			due: "deadline",
			priority: "prio",
			project: "proj",
			tags: "labels",
		};
		const order = ["file.name", "note.state", "note.deadline", "note.prio", "note.proj", "note.labels"];
		expect(feedRowColumns(order, keys)).toEqual([{ kind: "date" }, { kind: "priority" }, { kind: "project" }, { kind: "tags" }]);
	});

	it("note.remind maps to the remind column", () => {
		expect(feedRowColumns(["file.name", "note.priority", "note.remind"], DEFAULT_PROPERTY_KEYS)).toEqual([{ kind: "priority" }, { kind: "remind" }]);
	});

	it("note.remind twice in order -> one remind column, at the first position", () => {
		const order = ["file.name", "note.remind", "note.priority", "note.remind"];
		expect(feedRowColumns(order, DEFAULT_PROPERTY_KEYS)).toEqual([{ kind: "remind" }, { kind: "priority" }]);
	});

	it("keeps unknown properties as generic columns, in position", () => {
		const order = ["file.name", "note.priority", "formula.effort", "note.tags", "note.customField"];
		expect(feedRowColumns(order, DEFAULT_PROPERTY_KEYS)).toEqual([
			{ kind: "priority" },
			{ kind: "generic", propertyId: "formula.effort" },
			{ kind: "tags" },
			{ kind: "generic", propertyId: "note.customField" },
		]);
	});
});

describe("defaultFeedOrderYaml", () => {
	it("default keys -> file.name, status, due, scheduled, priority, project, tags", () => {
		expect(defaultFeedOrderYaml(DEFAULT_PROPERTY_KEYS)).toEqual(["file.name", "status", "due", "scheduled", "priority", "project", "tags"]);
	});

	it("uses configured property keys", () => {
		const keys: PropertyKeys = { ...DEFAULT_PROPERTY_KEYS, status: "state", due: "deadline" };
		expect(defaultFeedOrderYaml(keys)).toEqual(["file.name", "state", "deadline", "scheduled", "priority", "project", "tags"]);
	});
});
