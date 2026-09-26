import { describe, expect, it } from "vitest";

import { makeCompleteTask } from "@/app/complete-task";
import type { AppDeps } from "@/app/deps";
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

describe("makeCompleteTask", () => {
	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeCompleteTask(deps)(path("Tasks/Missing.md"));
		expect(result.ok).toBe(false);
	});

	// DEFAULT_STATUSES: todo (open), done (done).
	it("marks an open task done and stamps completed", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });

		const result = await makeCompleteTask(deps)(path("Tasks/Buy milk.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ title: "Buy milk", alreadyDone: false });
		}
		const note = store.notes.get(path("Tasks/Buy milk.md"));
		expect(note?.frontmatter["status"]).toBe("done");
		expect(note?.frontmatter["completed"]).toBe("2026-09-02T10:00");
	});

	it("is a no-op on an already-done task, and never reopens it", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "done", completed: "2026-09-01T10:00" });

		const result = await makeCompleteTask(deps)(path("Tasks/Buy milk.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ title: "Buy milk", alreadyDone: true });
		}
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["status"]).toBe("done");
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["completed"]).toBe("2026-09-01T10:00");
	});

	it("spawns the next occurrence for a recurring task, same as setStatus", async () => {
		const { deps, store } = makeDeps();
		store.seed(
			path("Tasks/Buy milk 2026-09-02.md"),
			{ type: "task", status: "todo", due: "2026-09-02", repeat: "FREQ=WEEKLY" },
			"body text",
		);

		const result = await makeCompleteTask(deps)(path("Tasks/Buy milk 2026-09-02.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ title: "Buy milk 2026-09-02", alreadyDone: false });
		}
		const spawned = store.notes.get(path("Tasks/Buy milk 2026-09-09.md"));
		expect(spawned).toBeDefined();
		expect(spawned?.frontmatter["due"]).toBe("2026-09-09");
		expect(spawned?.frontmatter["status"]).toBe("todo");
		expect(spawned?.body).toBe("body text");
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

		const result = await makeCompleteTask(deps)(path("Tasks/Buy milk.md"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({ kind: "no-status-configured" });
		}
	});
});
