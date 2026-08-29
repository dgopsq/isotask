import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeSetTags } from "@/app/set-tags";
import { FakeClock, FakeNotifier, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function makeDeps(): { readonly deps: AppDeps; readonly store: FakeTaskStore } {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const notifier = new FakeNotifier();
	return { deps: { store, clock, notifier, settings: () => DEFAULT_SETTINGS }, store };
}

describe("makeSetTags", () => {
	it("sets the tags", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });

		const result = await makeSetTags(deps)(path("Tasks/Buy milk.md"), ["work", "urgent"]);

		expect(result.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["tags"]).toEqual(["work", "urgent"]);
	});

	it("clears the tags key when passed an empty list", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", tags: ["work"] });

		await makeSetTags(deps)(path("Tasks/Buy milk.md"), []);

		expect("tags" in (store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter ?? {})).toBe(false);
	});

	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeSetTags(deps)(path("Tasks/Missing.md"), []);
		expect(result.ok).toBe(false);
	});
});
