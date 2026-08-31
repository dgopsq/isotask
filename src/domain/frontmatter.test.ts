import { describe, expect, it } from "vitest";

import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { isTaskNote, parseTask, projectFromWikilink, taskToPatch, toWikilink } from "@/domain/frontmatter";
import type { StatusConfig } from "@/domain/status";
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
			expect(result.error).toContainEqual({
				kind: "unknown-status",
				value: "someday",
				allowed: statuses.map((status) => status.id),
			});
		}
	});

	it("fails with invalid-priority for an unrecognized priority", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", priority: "asap" }, keys, statuses);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContainEqual({
				kind: "invalid-priority",
				value: "asap",
				allowed: ["normal", "high", "urgent"],
			});
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

describe("parseTask — missing status defaults to the first open status (ADR 0012)", () => {
	it("defaults a missing status to the first configured open status", () => {
		const result = parseTask(path, "Buy milk", { type: "task" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.status).toBe("todo");
		}
	});

	it("defaults an empty-string status to the first configured open status", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.status).toBe("todo");
		}
	});

	it("fails with no-open-status when no open status is configured at all", () => {
		const noOpenStatuses: readonly StatusConfig[] = statuses.map((status) => ({ ...status, kind: "done" as const }));
		const result = parseTask(path, "Buy milk", { type: "task" }, keys, noOpenStatuses);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContainEqual({ kind: "no-open-status" });
		}
	});

	it("round-trips the defaulted status through taskToPatch", () => {
		const result = parseTask(path, "Buy milk", { type: "task" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const patch = taskToPatch(result.value, keys);
			expect(patch[keys.status]).toBe("todo");
		}
	});
});

describe("parseTask — lenient parse, canonical write", () => {
	it("accepts a status with surrounding whitespace", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: " todo " }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.status).toBe("todo");
		}
	});

	it("accepts a differently-cased status id", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "Done" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.status).toBe("done");
		}
	});

	it("accepts a status label in place of its id", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "In progress" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.status).toBe("in-progress");
		}
	});

	it("still fails unknown-status for a value that resolves to neither an id nor a label", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "someday" }, keys, statuses);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContainEqual({
				kind: "unknown-status",
				value: "someday",
				allowed: statuses.map((status) => status.id),
			});
		}
	});

	it("parses the retired 'low' priority as normal, with no error (ADR 0010 alias)", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", priority: "low" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.priority).toBe("normal");
		}
	});

	it("parses 'low' case-insensitively as normal too", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", priority: "LOW" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.priority).toBe("normal");
		}
	});

	it("accepts a mixed-case priority", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", priority: "HIGH" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.priority).toBe("high");
		}
	});

	it("accepts a numeric-string duration", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", duration: "45" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.duration).toBe(45);
		}
	});

	it("still fails invalid-duration for a non-integer numeric string", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", duration: "45.5" }, keys, statuses);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContainEqual({ kind: "invalid-duration", value: "45.5" });
		}
	});

	it("accepts a space-separated datetime", () => {
		const result = parseTask(path, "Buy milk", { type: "task", status: "todo", due: "2026-09-01 09:00" }, keys, statuses);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.due).toBe("2026-09-01T09:00");
		}
	});

	it("accepts an ISO datetime with seconds, dropping them", () => {
		const result = parseTask(
			path,
			"Buy milk",
			{ type: "task", status: "todo", due: "2026-09-01T09:00:00" },
			keys,
			statuses,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.due).toBe("2026-09-01T09:00");
		}
	});

	it("still fails invalid-date for a timezone-suffixed value", () => {
		const result = parseTask(
			path,
			"Buy milk",
			{ type: "task", status: "todo", due: "2026-09-01T09:00:00Z" },
			keys,
			statuses,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContainEqual({ kind: "invalid-date", property: "due", value: "2026-09-01T09:00:00Z" });
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
