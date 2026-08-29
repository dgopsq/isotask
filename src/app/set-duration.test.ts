import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeSetDuration } from "@/app/set-duration";
import { FakeClock, FakeNotifier, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { none, some } from "@/domain/result";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { Minutes, TaskPath } from "@/domain/task";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function makeDeps(): { readonly deps: AppDeps; readonly store: FakeTaskStore } {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const notifier = new FakeNotifier();
	return { deps: { store, clock, notifier, settings: () => DEFAULT_SETTINGS }, store };
}

describe("makeSetDuration", () => {
	it("sets the duration", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo", scheduled: "2026-09-02T08:00" });

		const result = await makeSetDuration(deps)(path("Tasks/Water plants.md"), some(15 as Minutes));

		expect(result.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Water plants.md"))?.frontmatter["duration"]).toBe(15);
	});

	it("removes the duration when passed none", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo", duration: 15 });

		await makeSetDuration(deps)(path("Tasks/Water plants.md"), none());

		expect("duration" in (store.notes.get(path("Tasks/Water plants.md"))?.frontmatter ?? {})).toBe(false);
	});

	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeSetDuration(deps)(path("Tasks/Missing.md"), none());
		expect(result.ok).toBe(false);
	});
});
