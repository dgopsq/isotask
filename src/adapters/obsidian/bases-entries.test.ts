import { describe, expect, it } from "vitest";
import type { App, BasesEntry, CachedMetadata } from "obsidian";

import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import type { Task } from "@/domain/task";

const keys = DEFAULT_PROPERTY_KEYS;
const statuses: readonly StatusConfig[] = [
	{ id: "todo" as Task["status"], label: "To do", kind: "open" },
	{ id: "done" as Task["status"], label: "Done", kind: "done" },
];

/** Fakes only the two surfaces `tasksFromBasesEntries` touches: `getFileCache` and `entry.file.{path,basename}`. */
function fakeApp(caches: Readonly<Record<string, CachedMetadata | null>>): App {
	return {
		metadataCache: {
			getFileCache: (file: { path: string }): CachedMetadata | null => caches[file.path] ?? null,
		},
	} as unknown as App;
}

function fakeEntry(path: string, basename: string): BasesEntry {
	return { file: { path, basename } } as unknown as BasesEntry;
}

describe("tasksFromBasesEntries", () => {
	it("parses a task whose cache is present with valid frontmatter", () => {
		const entry = fakeEntry("Tasks/Buy milk.md", "Buy milk");
		const app = fakeApp({ "Tasks/Buy milk.md": { frontmatter: { type: "task", status: "todo" } } });

		const result = tasksFromBasesEntries(app, [entry], keys, statuses);

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0]?.task.title).toBe("Buy milk");
		expect(result.invalid).toEqual([]);
		expect(result.uncached).toEqual([]);
	});

	it("reports uncached when the cache entry doesn't exist yet", () => {
		const entry = fakeEntry("Tasks/New.md", "New");
		const app = fakeApp({}); // getFileCache returns null: not indexed yet

		const result = tasksFromBasesEntries(app, [entry], keys, statuses);

		expect(result.tasks).toEqual([]);
		expect(result.invalid).toEqual([]);
		expect(result.uncached).toEqual(["Tasks/New.md"]);
	});

	it("reports uncached when the cache exists but frontmatter hasn't landed yet (iOS write race)", () => {
		const entry = fakeEntry("Tasks/Fresh.md", "Fresh");
		const app = fakeApp({ "Tasks/Fresh.md": {} }); // cache present, no `frontmatter` key

		const result = tasksFromBasesEntries(app, [entry], keys, statuses);

		expect(result.uncached).toEqual(["Tasks/Fresh.md"]);
	});

	it("silently skips a note whose cached frontmatter is a genuine marker mismatch", () => {
		const entry = fakeEntry("Notes/Plain.md", "Plain");
		const app = fakeApp({ "Notes/Plain.md": { frontmatter: { type: "note" } } });

		const result = tasksFromBasesEntries(app, [entry], keys, statuses);

		expect(result.tasks).toEqual([]);
		expect(result.invalid).toEqual([]);
		expect(result.uncached).toEqual([]);
	});

	it("reports invalid for a task-marked note that fails to parse", () => {
		const entry = fakeEntry("Tasks/Bad.md", "Bad");
		const app = fakeApp({ "Tasks/Bad.md": { frontmatter: { type: "task", status: "todo", priority: "urgentish" } } });

		const result = tasksFromBasesEntries(app, [entry], keys, statuses);

		expect(result.tasks).toEqual([]);
		expect(result.uncached).toEqual([]);
		expect(result.invalid).toHaveLength(1);
		expect(result.invalid[0]?.errors[0]?.kind).toBe("invalid-priority");
	});
});
