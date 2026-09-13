import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeReconcileCompletion } from "@/app/reconcile-completion";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import type { IsotaskSettings } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function makeDeps(overrides: Partial<IsotaskSettings> = {}): {
	readonly deps: AppDeps;
	readonly store: FakeTaskStore;
	readonly notifier: FakeNotifier;
} {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const notifier = new FakeNotifier();
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const settings: IsotaskSettings = { ...DEFAULT_SETTINGS, ...overrides };
	return { deps: { store, clock, notifier, history: new FakeRescheduleHistory(), settings: () => settings }, store, notifier };
}

describe("makeReconcileCompletion", () => {
	it("done status with no completed: writes completed (external mark-as-done)", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "done" });
		const reconcile = makeReconcileCompletion(deps);

		const result = await reconcile(path("Tasks/Buy milk.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ kind: "completed", spawned: { some: false } });
		}
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["completed"]).toBe("2026-09-02T10:00");
	});

	it("done status with no completed, recurring: spawns the next occurrence", async () => {
		const { deps, store, notifier } = makeDeps();
		store.seed(path("Tasks/Buy milk 2026-09-02.md"), {
			type: "task",
			status: "done",
			due: "2026-09-02",
			repeat: "FREQ=WEEKLY",
		});
		const reconcile = makeReconcileCompletion(deps);

		const result = await reconcile(path("Tasks/Buy milk 2026-09-02.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.kind).toBe("completed");
			expect(result.value.kind === "completed" && result.value.spawned.some).toBe(true);
		}
		expect(store.notes.has(path("Tasks/Buy milk 2026-09-09.md"))).toBe(true);
		expect(notifier.infoMessages).toEqual(["Created next occurrence: Tasks/Buy milk 2026-09-09.md"]);
	});

	it("done status with no completed, recurring, spawn path already exists: does not duplicate", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk 2026-09-02.md"), {
			type: "task",
			status: "done",
			due: "2026-09-02",
			repeat: "FREQ=WEEKLY",
		});
		store.seed(path("Tasks/Buy milk 2026-09-09.md"), { type: "task", status: "todo", due: "2026-09-09" });
		const reconcile = makeReconcileCompletion(deps);

		const result = await reconcile(path("Tasks/Buy milk 2026-09-02.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ kind: "completed", spawned: { some: false } });
		}
	});

	it("open status with completed present: clears completed (external reopen)", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", completed: "2026-08-01T09:00" });
		const reconcile = makeReconcileCompletion(deps);

		const result = await reconcile(path("Tasks/Buy milk.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ kind: "reopened" });
		}
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["completed"]).toBeUndefined();
	});

	it("consistent open task: no-op", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });
		const reconcile = makeReconcileCompletion(deps);

		const result = await reconcile(path("Tasks/Buy milk.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ kind: "none" });
		}
	});

	it("consistent done task: no-op", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "done", completed: "2026-08-01T09:00" });
		const reconcile = makeReconcileCompletion(deps);

		const result = await reconcile(path("Tasks/Buy milk.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ kind: "none" });
		}
	});

	it("a note that fails to parse as a task: ok none, not surfaced as an error", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Bad.md"), { type: "task", status: "not-a-real-status" });
		const reconcile = makeReconcileCompletion(deps);

		const result = await reconcile(path("Tasks/Bad.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ kind: "none" });
		}
	});

	it("a missing note: surfaces the store error", async () => {
		const { deps } = makeDeps();
		const reconcile = makeReconcileCompletion(deps);

		const result = await reconcile(path("Tasks/Missing.md"));

		expect(result.ok).toBe(false);
	});
});
