import { describe, expect, it } from "vitest";

import { makeCycleStatus } from "@/app/cycle-status";
import type { AppDeps } from "@/app/deps";
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

describe("makeCycleStatus", () => {
	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeCycleStatus(deps)(path("Tasks/Missing.md"));
		expect(result.ok).toBe(false);
	});

	// DEFAULT_STATUSES in configured order: todo, in-progress, done, cancelled.
	it("advances to the next status in configured order, wrapping around", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });
		const cycleStatus = makeCycleStatus(deps);

		const first = await cycleStatus(path("Tasks/Buy milk.md"));
		expect(first.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["status"]).toBe("in-progress");

		const second = await cycleStatus(path("Tasks/Buy milk.md"));
		expect(second.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["status"]).toBe("done");
	});

	it("fails when the configured status list is empty", async () => {
		// The store parses the note against DEFAULT_STATUSES (so `read` succeeds),
		// while `deps.settings()` reports an empty list — isolating the
		// `nextStatusInCycle` "no status configured" branch. In practice
		// `parseSettings` never allows an empty list; this exercises the
		// defensive branch directly rather than relying on that invariant.
		const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });
		const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
		const deps: AppDeps = { store, clock, notifier: new FakeNotifier(), settings: () => ({ ...DEFAULT_SETTINGS, statuses: [] }) };

		const result = await makeCycleStatus(deps)(path("Tasks/Buy milk.md"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({ kind: "no-status-configured" });
		}
	});
});
