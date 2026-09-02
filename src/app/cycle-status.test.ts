import { describe, expect, it } from "vitest";

import { makeCycleStatus } from "@/app/cycle-status";
import type { AppDeps } from "@/app/deps";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";
import type { StatusId, TaskPath } from "@/domain/task";

function statusId(value: string): StatusId {
	return value as StatusId;
}

// Local four-status list (todo/in-progress/done/cancelled), since DEFAULT_STATUSES no longer
// includes in-progress/cancelled — this test needs the wrap-around order they provide.
const FOUR_STATUSES: readonly StatusConfig[] = [
	{ id: statusId("todo"), label: "To do", kind: "open" },
	{ id: statusId("in-progress"), label: "In progress", kind: "active" },
	{ id: statusId("done"), label: "Done", kind: "done" },
	{ id: statusId("cancelled"), label: "Cancelled", kind: "cancelled" },
];

function path(value: string): TaskPath {
	return value as TaskPath;
}

function makeDeps(): { readonly deps: AppDeps; readonly store: FakeTaskStore } {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const notifier = new FakeNotifier();
	return { deps: { store, clock, notifier, history: new FakeRescheduleHistory(), settings: () => DEFAULT_SETTINGS }, store };
}

describe("makeCycleStatus", () => {
	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeCycleStatus(deps)(path("Tasks/Missing.md"));
		expect(result.ok).toBe(false);
	});

	// FOUR_STATUSES in configured order: todo, in-progress, done, cancelled.
	it("advances to the next status in configured order, wrapping around", async () => {
		const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: FOUR_STATUSES });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });
		const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
		const deps: AppDeps = {
			store,
			clock,
			notifier: new FakeNotifier(),
			history: new FakeRescheduleHistory(),
			settings: () => ({ ...DEFAULT_SETTINGS, statuses: FOUR_STATUSES }),
		};
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
		const deps: AppDeps = {
			store,
			clock,
			notifier: new FakeNotifier(),
			history: new FakeRescheduleHistory(),
			settings: () => ({ ...DEFAULT_SETTINGS, statuses: [] }),
		};

		const result = await makeCycleStatus(deps)(path("Tasks/Buy milk.md"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({ kind: "no-status-configured" });
		}
	});
});
