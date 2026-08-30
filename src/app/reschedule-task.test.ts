import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeRescheduleTask } from "@/app/reschedule-task";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime, TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import type { PropertyKeys } from "@/domain/property-keys";
import { err, none, some } from "@/domain/result";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

function makeDeps(propertyKeys: PropertyKeys = DEFAULT_PROPERTY_KEYS): { readonly deps: AppDeps; readonly store: FakeTaskStore } {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const notifier = new FakeNotifier();
	return {
		deps: { store, clock, notifier, history: new FakeRescheduleHistory(), settings: () => ({ ...DEFAULT_SETTINGS, propertyKeys }) },
		store,
	};
}

describe("makeRescheduleTask", () => {
	it("moves due, ignoring end and leaving duration untouched", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-05", duration: 30 });

		const result = await makeRescheduleTask(deps)(path("Tasks/Buy milk.md"), "due", date("2026-09-06"), none());

		expect(result.ok).toBe(true);
		const frontmatter = store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter;
		expect(frontmatter?.["due"]).toBe("2026-09-06");
		expect(frontmatter?.["duration"]).toBe(30);
	});

	it("moves due with an end provided, still ignoring it and leaving duration untouched", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-05", duration: 30 });

		const result = await makeRescheduleTask(deps)(
			path("Tasks/Buy milk.md"),
			"due",
			date("2026-09-06"),
			some(date("2026-09-06T12:00")),
		);

		expect(result.ok).toBe(true);
		const frontmatter = store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter;
		expect(frontmatter?.["due"]).toBe("2026-09-06");
		expect(frontmatter?.["duration"]).toBe(30);
	});

	it("moves scheduled with end none, leaving an existing duration untouched", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo", scheduled: "2026-09-05T09:00", duration: 45 });

		const result = await makeRescheduleTask(deps)(path("Tasks/Water plants.md"), "scheduled", date("2026-09-06T09:00"), none());

		expect(result.ok).toBe(true);
		const frontmatter = store.notes.get(path("Tasks/Water plants.md"))?.frontmatter;
		expect(frontmatter?.["scheduled"]).toBe("2026-09-06T09:00");
		expect(frontmatter?.["duration"]).toBe(45);
	});

	it("resizes scheduled with end some, computing duration from the gap", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo", scheduled: "2026-09-05T09:00" });

		const result = await makeRescheduleTask(deps)(
			path("Tasks/Water plants.md"),
			"scheduled",
			date("2026-09-05T09:00"),
			some(date("2026-09-05T10:30")),
		);

		expect(result.ok).toBe(true);
		const frontmatter = store.notes.get(path("Tasks/Water plants.md"))?.frontmatter;
		expect(frontmatter?.["scheduled"]).toBe("2026-09-05T09:00");
		expect(frontmatter?.["duration"]).toBe(90);
	});

	it("clamps duration to 1 minute when start equals end", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo", scheduled: "2026-09-05T09:00" });

		await makeRescheduleTask(deps)(path("Tasks/Water plants.md"), "scheduled", date("2026-09-05T09:00"), some(date("2026-09-05T09:00")));

		expect(store.notes.get(path("Tasks/Water plants.md"))?.frontmatter["duration"]).toBe(1);
	});

	it("clamps duration to 1 minute when end precedes start", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo", scheduled: "2026-09-05T09:00" });

		await makeRescheduleTask(deps)(
			path("Tasks/Water plants.md"),
			"scheduled",
			date("2026-09-05T09:00"),
			some(date("2026-09-05T08:30")),
		);

		expect(store.notes.get(path("Tasks/Water plants.md"))?.frontmatter["duration"]).toBe(1);
	});

	it("honours custom property keys", async () => {
		const customKeys: PropertyKeys = { ...DEFAULT_PROPERTY_KEYS, scheduled: "my-scheduled", duration: "my-duration" };
		const { deps, store } = makeDeps(customKeys);
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo" });

		await makeRescheduleTask(deps)(
			path("Tasks/Water plants.md"),
			"scheduled",
			date("2026-09-05T09:00"),
			some(date("2026-09-05T10:00")),
		);

		const frontmatter = store.notes.get(path("Tasks/Water plants.md"))?.frontmatter;
		expect(frontmatter?.["my-scheduled"]).toBe("2026-09-05T09:00");
		expect(frontmatter?.["my-duration"]).toBe(60);
	});

	it("makes exactly one updateProperties call", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo" });
		let calls = 0;
		const originalUpdate = store.updateProperties.bind(store);
		store.updateProperties = async (p: TaskPath, patch) => {
			calls += 1;
			return originalUpdate(p, patch);
		};

		await makeRescheduleTask(deps)(
			path("Tasks/Water plants.md"),
			"scheduled",
			date("2026-09-05T09:00"),
			some(date("2026-09-05T10:00")),
		);

		expect(calls).toBe(1);
	});

	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeRescheduleTask(deps)(path("Tasks/Missing.md"), "due", date("2026-09-05"), none());
		expect(result.ok).toBe(false);
	});

	it("inverts a key that existed before to its previously stored value", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo", scheduled: "2026-09-05T09:00", duration: 45 });

		const result = await makeRescheduleTask(deps)(path("Tasks/Water plants.md"), "scheduled", date("2026-09-06T09:00"), none());

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.path).toBe(path("Tasks/Water plants.md"));
			expect(result.value.undo["scheduled"]).toBe("2026-09-05T09:00");
			expect(result.value.redo["scheduled"]).toBe("2026-09-06T09:00");
		}
	});

	it("inverts a key that did not exist before to null", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo", scheduled: "2026-09-05T09:00" });

		const result = await makeRescheduleTask(deps)(
			path("Tasks/Water plants.md"),
			"scheduled",
			date("2026-09-05T09:00"),
			some(date("2026-09-05T10:30")),
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.undo["duration"]).toBeNull();
			expect(result.value.redo["duration"]).toBe(90);
		}
	});

	it("returns an error and performs no write when the rawFrontmatter read fails", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Water plants.md"), { type: "task", status: "todo", scheduled: "2026-09-05T09:00" });
		let updateCalls = 0;
		const originalUpdate = store.updateProperties.bind(store);
		store.updateProperties = async (p: TaskPath, patch) => {
			updateCalls += 1;
			return originalUpdate(p, patch);
		};
		store.rawFrontmatter = async () => err({ kind: "io-error", path: path("Tasks/Water plants.md"), message: "boom" });

		const result = await makeRescheduleTask(deps)(path("Tasks/Water plants.md"), "scheduled", date("2026-09-06T09:00"), none());

		expect(result.ok).toBe(false);
		expect(updateCalls).toBe(0);
		expect(store.notes.get(path("Tasks/Water plants.md"))?.frontmatter["scheduled"]).toBe("2026-09-05T09:00");
	});
});
