import { describe, expect, it } from "vitest";
import type { BasesEntry } from "obsidian";

import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import type { Task, TaskPath } from "@/domain/task";

const keys = DEFAULT_PROPERTY_KEYS;
const statuses: readonly StatusConfig[] = [
	{ id: "todo" as Task["status"], label: "To do", kind: "open" },
	{ id: "done" as Task["status"], label: "Done", kind: "done" },
];

/** Fakes `peekFrontmatter` against a plain path -> frontmatter map, standing in for the metadata-cache-or-recent-write lookup `VaultTaskStore` provides. */
function fakePeekFrontmatter(
	frontmatterByPath: Readonly<Record<string, Record<string, unknown>>>,
): (path: TaskPath) => Readonly<Record<string, unknown>> | undefined {
	return (path) => frontmatterByPath[path];
}

function fakeEntry(path: string, basename: string): BasesEntry {
	return { file: { path, basename } } as unknown as BasesEntry;
}

describe("tasksFromBasesEntries", () => {
	it("parses a task whose frontmatter is present", () => {
		const entry = fakeEntry("Tasks/Buy milk.md", "Buy milk");
		const peekFrontmatter = fakePeekFrontmatter({ "Tasks/Buy milk.md": { type: "task", status: "todo" } });

		const result = tasksFromBasesEntries(peekFrontmatter, [entry], keys, statuses);

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0]?.task.title).toBe("Buy milk");
		expect(result.invalid).toEqual([]);
		expect(result.uncached).toEqual([]);
	});

	it("reports uncached when peekFrontmatter has nothing for the path yet", () => {
		const entry = fakeEntry("Tasks/New.md", "New");
		const peekFrontmatter = fakePeekFrontmatter({});

		const result = tasksFromBasesEntries(peekFrontmatter, [entry], keys, statuses);

		expect(result.tasks).toEqual([]);
		expect(result.invalid).toEqual([]);
		expect(result.uncached).toEqual(["Tasks/New.md"]);
	});

	it("silently skips a note whose frontmatter is a genuine marker mismatch", () => {
		const entry = fakeEntry("Notes/Plain.md", "Plain");
		const peekFrontmatter = fakePeekFrontmatter({ "Notes/Plain.md": { type: "note" } });

		const result = tasksFromBasesEntries(peekFrontmatter, [entry], keys, statuses);

		expect(result.tasks).toEqual([]);
		expect(result.invalid).toEqual([]);
		expect(result.uncached).toEqual([]);
	});

	it("reports invalid for a task-marked note that fails to parse", () => {
		const entry = fakeEntry("Tasks/Bad.md", "Bad");
		const peekFrontmatter = fakePeekFrontmatter({
			"Tasks/Bad.md": { type: "task", status: "todo", priority: "urgentish" },
		});

		const result = tasksFromBasesEntries(peekFrontmatter, [entry], keys, statuses);

		expect(result.tasks).toEqual([]);
		expect(result.uncached).toEqual([]);
		expect(result.invalid).toHaveLength(1);
		expect(result.invalid[0]?.errors[0]?.kind).toBe("invalid-priority");
	});
});
