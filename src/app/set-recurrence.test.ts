import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeSetRecurrence } from "@/app/set-recurrence";
import { FakeClock, FakeNotifier, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { none, some } from "@/domain/result";
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

describe("makeSetRecurrence", () => {
	it("normalises and sets a valid rule", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-02" });

		const result = await makeSetRecurrence(deps)(path("Tasks/Buy milk.md"), some("freq=weekly"));

		expect(result.ok).toBe(true);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter["repeat"]).toBe("FREQ=WEEKLY");
	});

	it("removes the rule when passed none", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", repeat: "FREQ=WEEKLY" });

		await makeSetRecurrence(deps)(path("Tasks/Buy milk.md"), none());

		expect("repeat" in (store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter ?? {})).toBe(false);
	});

	it("fails with invalid-rrule on an unparsable rule, without writing anything", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });

		const result = await makeSetRecurrence(deps)(path("Tasks/Buy milk.md"), some("not a rule"));

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("invalid-rrule");
		}
		expect("repeat" in (store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter ?? {})).toBe(false);
	});

	it("fails when the task note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeSetRecurrence(deps)(path("Tasks/Missing.md"), none());
		expect(result.ok).toBe(false);
	});
});
