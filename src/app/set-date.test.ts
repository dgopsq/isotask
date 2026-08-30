import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeSetDate } from "@/app/set-date";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime, TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import { none, some } from "@/domain/result";
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

function makeDeps(): { readonly deps: AppDeps; readonly store: FakeTaskStore } {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const notifier = new FakeNotifier();
	return { deps: { store, clock, notifier, history: new FakeRescheduleHistory(), settings: () => DEFAULT_SETTINGS }, store };
}

describe("makeSetDate", () => {
	it("sets the due date", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });

		const result = await makeSetDate(deps)(path("Tasks/Buy milk.md"), "due", some(date("2026-09-05")));

		expect(result.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["due"]).toBe("2026-09-05");
	});

	it("sets the scheduled date, leaving due untouched", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-05" });

		await makeSetDate(deps)(path("Tasks/Buy milk.md"), "scheduled", some(date("2026-09-04T09:00")));

		const frontmatter = store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter;
		expect(frontmatter?.["scheduled"]).toBe("2026-09-04T09:00");
		expect(frontmatter?.["due"]).toBe("2026-09-05");
	});

	it("removes the date when passed none", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-05" });

		await makeSetDate(deps)(path("Tasks/Buy milk.md"), "due", none());

		expect("due" in (store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter ?? {})).toBe(false);
	});

	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeSetDate(deps)(path("Tasks/Missing.md"), "due", none());
		expect(result.ok).toBe(false);
	});
});
