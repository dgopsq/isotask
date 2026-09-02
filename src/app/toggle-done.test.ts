import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
import { makeToggleDone } from "@/app/toggle-done";
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

describe("makeToggleDone", () => {
	it("propagates a store read error when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeToggleDone(deps)(path("Tasks/Missing.md"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("store");
		}
	});

	// DEFAULT_STATUSES: todo (open), done (done).
	it("open -> done: writes the done status and sets completed via setStatus", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });
		const toggleDone = makeToggleDone(deps);

		const result = await toggleDone(path("Tasks/Buy milk.md"));
		expect(result.ok).toBe(true);
		const note = store.notes.get(path("Tasks/Buy milk.md"));
		expect(note?.frontmatter["status"]).toBe("done");
		expect(note?.frontmatter["completed"]).toBe("2026-09-02T10:00");
	});

	it("done -> reopen: writes the first configured open status", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "done", completed: "2026-09-01T10:00" });
		const toggleDone = makeToggleDone(deps);

		const result = await toggleDone(path("Tasks/Buy milk.md"));
		expect(result.ok).toBe(true);
		const note = store.notes.get(path("Tasks/Buy milk.md"));
		expect(note?.frontmatter["status"]).toBe("todo");
	});

	it("fails when no done status is configured", async () => {
		const openOnly = DEFAULT_STATUSES.filter((s) => s.kind !== "done");
		const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: openOnly });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });
		const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
		const deps: AppDeps = {
			store,
			clock,
			notifier: new FakeNotifier(),
			history: new FakeRescheduleHistory(),
			settings: () => ({ ...DEFAULT_SETTINGS, statuses: openOnly }),
		};

		const result = await makeToggleDone(deps)(path("Tasks/Buy milk.md"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({ kind: "no-status-configured" });
		}
	});
});
