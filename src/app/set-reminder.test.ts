import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeSetReminder } from "@/app/set-reminder";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import type { ReminderSpec } from "@/domain/reminders";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function offset(minutes: number): ReminderSpec {
	return { kind: "offset", minutes };
}

function makeDeps(): { readonly deps: AppDeps; readonly store: FakeTaskStore } {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const notifier = new FakeNotifier();
	return { deps: { store, clock, notifier, history: new FakeRescheduleHistory(), settings: () => DEFAULT_SETTINGS }, store };
}

describe("makeSetReminder", () => {
	it("sets a single preset", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-05" });

		const result = await makeSetReminder(deps)(path("Tasks/Buy milk.md"), [offset(1440)]);

		expect(result.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["remind"]).toEqual(["1d"]);
	});

	it("sets several specs, in order", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-05" });

		await makeSetReminder(deps)(path("Tasks/Buy milk.md"), [offset(1440), offset(15)]);

		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["remind"]).toEqual(["1d", "15m"]);
	});

	it("replaces an existing value", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", remind: ["15m"] });

		await makeSetReminder(deps)(path("Tasks/Buy milk.md"), [offset(60)]);

		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["remind"]).toEqual(["1h"]);
	});

	it("removes the property when passed undefined", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", remind: ["15m"] });

		await makeSetReminder(deps)(path("Tasks/Buy milk.md"), undefined);

		expect("remind" in (store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter ?? {})).toBe(false);
	});

	it("removes the property when passed an empty list", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", remind: ["15m"] });

		await makeSetReminder(deps)(path("Tasks/Buy milk.md"), []);

		expect("remind" in (store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter ?? {})).toBe(false);
	});

	it("collapses a list containing none to [\"none\"]", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });

		await makeSetReminder(deps)(path("Tasks/Buy milk.md"), [offset(15), { kind: "none" }]);

		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["remind"]).toEqual(["none"]);
	});

	it("dedupes specs with the same canonical text", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });

		await makeSetReminder(deps)(path("Tasks/Buy milk.md"), [offset(60), offset(60)]);

		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["remind"]).toEqual(["1h"]);
	});

	it("fails when the task note does not exist, without writing anything", async () => {
		const { deps } = makeDeps();
		const result = await makeSetReminder(deps)(path("Tasks/Missing.md"), [offset(15)]);
		expect(result.ok).toBe(false);
	});

	it("fails on a non-task note", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Notes/Plain.md"), { title: "Not a task" });

		const result = await makeSetReminder(deps)(path("Notes/Plain.md"), [offset(15)]);

		expect(result.ok).toBe(false);
		expect("remind" in (store.notes.get(path("Notes/Plain.md"))?.frontmatter ?? {})).toBe(false);
	});
});
