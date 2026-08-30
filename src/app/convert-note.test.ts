import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeConvertNote } from "@/app/convert-note";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function makeDeps(): { readonly deps: AppDeps; readonly store: FakeTaskStore; readonly notifier: FakeNotifier } {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const notifier = new FakeNotifier();
	return { deps: { store, clock, notifier, history: new FakeRescheduleHistory(), settings: () => DEFAULT_SETTINGS }, store, notifier };
}

describe("makeConvertNote", () => {
	it("adds the marker, first-open status and created to a plain note with existing frontmatter", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Notes/Groceries.md"), { tags: ["errand"] });

		const result = await makeConvertNote(deps)(path("Notes/Groceries.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.converted).toBe(true);
		}
		const note = store.notes.get(path("Notes/Groceries.md"));
		expect(note?.frontmatter).toEqual({
			tags: ["errand"],
			type: "task",
			status: "todo",
			created: "2026-09-02T10:00",
		});
	});

	it("adds the marker to a note with no frontmatter at all", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Notes/Plain.md"), {});

		const result = await makeConvertNote(deps)(path("Notes/Plain.md"));

		expect(result.ok).toBe(true);
		const note = store.notes.get(path("Notes/Plain.md"));
		expect(note?.frontmatter).toEqual({ type: "task", status: "todo", created: "2026-09-02T10:00" });
	});

	it("does not overwrite an existing status or created value", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Notes/Groceries.md"), { status: "in-progress", created: "2026-01-01T00:00" });

		await makeConvertNote(deps)(path("Notes/Groceries.md"));

		const note = store.notes.get(path("Notes/Groceries.md"));
		expect(note?.frontmatter["status"]).toBe("in-progress");
		expect(note?.frontmatter["created"]).toBe("2026-01-01T00:00");
	});

	it("is a no-op with an info notice when the note is already a task", async () => {
		const { deps, store, notifier } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });

		const result = await makeConvertNote(deps)(path("Tasks/Buy milk.md"));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.converted).toBe(false);
		}
		expect(notifier.infoMessages).toEqual(["Already a task."]);
		expect(store.notes.get(path("Tasks/Buy milk.md"))?.frontmatter).toEqual({ type: "task", status: "todo" });
	});

	it("fails when the note does not exist", async () => {
		const { deps } = makeDeps();
		const result = await makeConvertNote(deps)(path("Notes/Missing.md"));
		expect(result.ok).toBe(false);
	});
});
