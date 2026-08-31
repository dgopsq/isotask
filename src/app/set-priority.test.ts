import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeSetPriority } from "@/app/set-priority";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
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
	return { deps: { store, clock, notifier, history: new FakeRescheduleHistory(), settings: () => DEFAULT_SETTINGS }, store };
}

describe("makeSetPriority", () => {
	it("sets the priority", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", priority: "normal" });

		const result = await makeSetPriority(deps)(path("Tasks/Buy milk.md"), "urgent");

		expect(result.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["priority"]).toBe("urgent");
	});

	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeSetPriority(deps)(path("Tasks/Missing.md"), "high");
		expect(result.ok).toBe(false);
	});
});
