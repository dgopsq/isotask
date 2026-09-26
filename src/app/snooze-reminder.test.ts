import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeSnoozeReminder } from "@/app/snooze-reminder";
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

describe("makeSnoozeReminder", () => {
	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeSnoozeReminder(deps)(path("Tasks/Missing.md"), 60);
		expect(result.ok).toBe(false);
	});

	it("fails on a non-task note, without writing anything", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Notes/Plain.md"), { title: "Not a task" });

		const result = await makeSnoozeReminder(deps)(path("Notes/Plain.md"), 60);

		expect(result.ok).toBe(false);
		expect("remind" in (store.notes.get(path("Notes/Plain.md"))?.frontmatter ?? {})).toBe(false);
	});

	it("materialises the vault default when remind is absent, then appends the snooze", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });

		const result = await makeSnoozeReminder(deps)(path("Tasks/Buy milk.md"), 60);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ title: "Buy milk", until: "2026-09-02T11:00" });
		}
		// DEFAULT_REMINDER_SETTINGS.remindByDefault -> the "at time" (offset 0) default is kept alongside the new absolute.
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["remind"]).toEqual(["0", "2026-09-02T11:00"]);
	});

	it("keeps every existing offset spec", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", remind: ["15m", "1d"] });

		const result = await makeSnoozeReminder(deps)(path("Tasks/Buy milk.md"), 60);

		expect(result.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["remind"]).toEqual(["15m", "1d", "2026-09-02T11:00"]);
	});

	it("prunes an absolute spec that's already past", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", remind: ["2026-09-01T08:00"] });

		const result = await makeSnoozeReminder(deps)(path("Tasks/Buy milk.md"), 60);

		expect(result.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["remind"]).toEqual(["2026-09-02T11:00"]);
	});

	it("keeps a future absolute spec", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", remind: ["2026-09-03T08:00"] });

		const result = await makeSnoozeReminder(deps)(path("Tasks/Buy milk.md"), 60);

		expect(result.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["remind"]).toEqual(["2026-09-03T08:00", "2026-09-02T11:00"]);
	});

	it("drops a none spec", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", remind: ["none"] });

		const result = await makeSnoozeReminder(deps)(path("Tasks/Buy milk.md"), 60);

		expect(result.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["remind"]).toEqual(["2026-09-02T11:00"]);
	});
});
