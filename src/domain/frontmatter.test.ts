import { describe, expect, it } from "vitest";

import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { isTaskNote, parseTask, projectFromWikilink, taskToPatch, toWikilink } from "@/domain/frontmatter";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { TaskDate } from "@/domain/dates";
import type { Task, TaskPath } from "@/domain/task";

const path = "Tasks/Buy milk.md" as TaskPath;
const keys = DEFAULT_PROPERTY_KEYS;
const statuses = DEFAULT_STATUSES;

describe("isTaskNote", () => {
	it("is true when the marker key/value match", () => {
		expect(isTaskNote({ type: "task" }, keys)).toBe(true);
	});

	it("is false otherwise", () => {
		expect(isTaskNote({ type: "note" }, keys)).toBe(false);
		expect(isTaskNote({}, keys)).toBe(false);
	});
});

describe("parseTask", () => {
	it("parses a minimal valid task, defaulting priority to normal and tags to empty", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({
				path,
				title: "Buy milk",
				status: "todo",
				priority: "normal",
				tags: [],
			});
		}
	});

	it("parses a fully populated task", () => {
		const raw = {
			type: "task",
			status: "in-progress",
			priority: "high",
			due: "2026-09-05",
			scheduled: "2026-09-03T09:00",
			duration: 30,
			repeat: "FREQ=WEEKLY;BYDAY=MO",
			project: "[[Groceries]]",
			tags: ["errand", "home"],
			created: "2026-09-01T08:00",
			completed: "2026-09-04T10:00",
		};
		const result = parseTask(path, "Buy milk", raw, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.priority).toBe("high");
			expect(result.value.due).toBe("2026-09-05");
			expect(result.value.scheduled).toBe("2026-09-03T09:00");
			expect(result.value.duration).toBe(30);
			expect(result.value.repeat).toBe("FREQ=WEEKLY;BYDAY=MO");
			expect(result.value.project).toBe("Groceries");
			expect(result.value.tags).toEqual(["errand", "home"]);
			expect(result.value.created).toBe("2026-09-01T08:00");
			expect(result.value.completed).toBe("2026-09-04T10:00");
		}
	});

	it("fails with not-a-task when the marker doesn't match", () => {
		const result = parseTask(path, "Not a task", { type: "note" }, keys, statuses);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual([{ kind: "not-a-task" }]);
		}
	});

	it("fails with unknown-status for a status id not in the configured list", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "someday" }, keys, statuses);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContainEqual({ kind: "unknown-status", value: "someday" });
		}
	});

	it("fails with invalid-priority for an unrecognized priority", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", priority: "asap" }, keys, statuses);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContainEqual({ kind: "invalid-priority", value: "asap" });
		}
	});

	it("fails with invalid-date for an unparseable due date", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", due: "next tuesday" }, keys, statuses);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContainEqual({ kind: "invalid-date", property: "due", value: "next tuesday" });
		}
	});

	it("accepts a single string for tags", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", tags: "errand" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.tags).toEqual(["errand"]);
		}
	});

	it("fails with invalid-tags when tags is neither a string nor an array of strings", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", tags: 5 }, keys, statuses);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContainEqual({ kind: "invalid-tags", value: "5" });
		}
	});

	it("collects multiple errors at once", () => {
		const result = parseTask(
			path,
			"Buy milk",
			{ type: "task", status: "someday", priority: "asap" },
			keys,
			statuses,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toHaveLength(2);
		}
	});
});

describe("projectFromWikilink / toWikilink", () => {
	it("extracts the target from a plain wikilink", () => {
		expect(projectFromWikilink("[[Groceries]]")).toBe("Groceries");
	});

	it("extracts the target from an aliased wikilink, ignoring the alias", () => {
		expect(projectFromWikilink("[[Groceries|🛒]]")).toBe("Groceries");
	});

	it("passes through a plain string unchanged", () => {
		expect(projectFromWikilink("Groceries")).toBe("Groceries");
	});

	it("toWikilink wraps a project name", () => {
		expect(toWikilink("Groceries")).toBe("[[Groceries]]");
	});
});

describe("taskToPatch", () => {
	it("round-trips a task's fields into frontmatter keys", () => {
		const task: Task = {
			path,
			title: "Buy milk",
			status: "todo" as Task["status"],
			priority: "normal",
			tags: ["errand"],
			due: "2026-09-05" as TaskDate,
			project: "Groceries",
		};
		expect(taskToPatch(task, keys)).toEqual({
			type: "task",
			status: "todo",
			priority: "normal",
			tags: ["errand"],
			due: "2026-09-05",
			project: "[[Groceries]]",
		});
	});

	it("omits keys for fields that are absent", () => {
		const task: Task = {
			path,
			title: "Buy milk",
			status: "todo" as Task["status"],
			priority: "normal",
			tags: [],
		};
		const patch = taskToPatch(task, keys);
		expect(Object.keys(patch).sort()).toEqual(["priority", "status", "tags", "type"]);
	});
});
