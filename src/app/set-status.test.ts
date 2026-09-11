import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeSetStatus } from "@/app/set-status";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import type { IsotaskSettings } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { StatusId, TaskPath } from "@/domain/task";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function statusId(value: string): StatusId {
	return value as StatusId;
}

function makeDeps(overrides: Partial<IsotaskSettings> = {}): {
	readonly deps: AppDeps;
	readonly store: FakeTaskStore;
	readonly notifier: FakeNotifier;
	readonly clock: FakeClock;
} {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const notifier = new FakeNotifier();
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const settings: IsotaskSettings = { ...DEFAULT_SETTINGS, ...overrides };
	return { deps: { store, clock, notifier, history: new FakeRescheduleHistory(), settings: () => settings }, store, notifier, clock };
}

describe("makeSetStatus", () => {
	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const setStatus = makeSetStatus(deps);
		const result = await setStatus(path("Tasks/Missing.md"), statusId("done"));
		expect(result.ok).toBe(false);
	});

	it("fails on an unknown target status", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });
		const setStatus = makeSetStatus(deps);
		const result = await setStatus(path("Tasks/Buy milk.md"), statusId("nope"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({ kind: "unknown-status", statusId: "nope" });
		}
	});

	it("updates status without spawning when the task has no repeat", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });
		const setStatus = makeSetStatus(deps);
		const result = await setStatus(path("Tasks/Buy milk.md"), statusId("done"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.spawned.some).toBe(false);
		}
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["status"]).toBe("done");
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["completed"]).toBe("2026-09-02T10:00");
	});

	it("spawns the next occurrence for a recurring task and notifies", async () => {
		const { deps, store, notifier } = makeDeps();
		store.seed(
			path("Tasks/Buy milk 2026-09-02.md"),
			{ type: "task", status: "todo", due: "2026-09-02", repeat: "FREQ=WEEKLY" },
			"body text",
		);
		const setStatus = makeSetStatus(deps);
		const result = await setStatus(path("Tasks/Buy milk 2026-09-02.md"), statusId("done"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.spawned.some).toBe(true);
			expect(result.value.spawned.some && result.value.spawned.value).toBe("Tasks/Buy milk 2026-09-09.md");
		}
		const spawned = store.notes.get(path("Tasks/Buy milk 2026-09-09.md"));
		expect(spawned).toBeDefined();
		expect(spawned?.frontmatter["due"]).toBe("2026-09-09");
		expect(spawned?.frontmatter["status"]).toBe("todo");
		expect(spawned?.body).toBe("body text");
		expect(notifier.infoMessages).toEqual(["Created next occurrence: Tasks/Buy milk 2026-09-09.md"]);
	});

	it("does not duplicate a spawn when the target path already exists (idempotent)", async () => {
		const { deps, store, notifier } = makeDeps();
		store.seed(path("Tasks/Buy milk 2026-09-02.md"), {
			type: "task",
			status: "todo",
			due: "2026-09-02",
			repeat: "FREQ=WEEKLY",
		});
		store.seed(path("Tasks/Buy milk 2026-09-09.md"), { type: "task", status: "todo", due: "2026-09-09" });

		const setStatus = makeSetStatus(deps);
		const result = await setStatus(path("Tasks/Buy milk 2026-09-02.md"), statusId("done"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.spawned.some).toBe(false);
		}
		expect(notifier.infoMessages).toEqual(["Next occurrence already exists: Tasks/Buy milk 2026-09-09.md"]);
	});

	it("reopening a done task never spawns, even with a repeat set", async () => {
		const { deps, store, notifier } = makeDeps();
		store.seed(path("Tasks/Buy milk 2026-09-02.md"), {
			type: "task",
			status: "done",
			due: "2026-09-02",
			repeat: "FREQ=WEEKLY",
			completed: "2026-08-26T10:00",
		});
		const setStatus = makeSetStatus(deps);
		const result = await setStatus(path("Tasks/Buy milk 2026-09-02.md"), statusId("todo"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.spawned.some).toBe(false);
		}
		expect(notifier.infoMessages).toEqual([]);
	});
});
