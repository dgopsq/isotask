import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeRescheduleTask } from "@/app/reschedule-task";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
import { makeRedoReschedule, makeUndoReschedule } from "@/app/undo-reschedule";
import type { IsoDate, IsoDateTime, TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { isNone, isSome, some } from "@/domain/result";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { TaskPath } from "@/domain/task";
import type { RescheduleEntry } from "@/ports/reschedule-history";

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

function makeDeps(): { readonly deps: AppDeps; readonly store: FakeTaskStore; readonly history: FakeRescheduleHistory } {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const notifier = new FakeNotifier();
	const history = new FakeRescheduleHistory();
	return { deps: { store, clock, notifier, history, settings: () => DEFAULT_SETTINGS }, store, history };
}

const taskPath = path("Tasks/Water plants.md");

describe("makeUndoReschedule", () => {
	it("returns ok(none()) and writes nothing when there is nothing to undo", async () => {
		const { deps, store } = makeDeps();
		store.seed(taskPath, { type: "task", status: "todo", scheduled: "2026-09-06T09:00" });

		const result = await makeUndoReschedule(deps)();

		expect(result).toEqual({ ok: true, value: { some: false } });
		expect(store.notes.get(taskPath)?.frontmatter["scheduled"]).toBe("2026-09-06T09:00");
	});

	it("applies the undo patch and pushes the entry onto the redo branch", async () => {
		const { deps, store, history } = makeDeps();
		store.seed(taskPath, { type: "task", status: "todo", scheduled: "2026-09-06T09:00", duration: 90 });
		const entry: RescheduleEntry = {
			path: taskPath,
			undo: { scheduled: "2026-09-05T09:00", duration: null },
			redo: { scheduled: "2026-09-06T09:00", duration: 90 },
		};
		history.record(entry);

		const result = await makeUndoReschedule(deps)();

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(isSome(result.value)).toBe(true);
			if (result.value.some) {
				expect(result.value.value).toBe(taskPath);
			}
		}
		expect(store.notes.get(taskPath)?.frontmatter["scheduled"]).toBe("2026-09-05T09:00");
		expect(store.notes.get(taskPath)?.frontmatter["duration"]).toBeUndefined();

		// Committed to the redo branch: redoing restores the original write.
		const redone = await makeRedoReschedule(deps)();
		expect(redone.ok).toBe(true);
		expect(store.notes.get(taskPath)?.frontmatter["scheduled"]).toBe("2026-09-06T09:00");
		expect(store.notes.get(taskPath)?.frontmatter["duration"]).toBe(90);
	});

	it("returns stale-undo, writes nothing, and drops the entry when the note changed since the gesture", async () => {
		const { deps, store, history } = makeDeps();
		// Stored `scheduled` no longer matches what the gesture wrote (redo).
		store.seed(taskPath, { type: "task", status: "todo", scheduled: "2026-09-07T09:00" });
		const entry: RescheduleEntry = {
			path: taskPath,
			undo: { scheduled: "2026-09-05T09:00" },
			redo: { scheduled: "2026-09-06T09:00" },
		};
		history.record(entry);

		const result = await makeUndoReschedule(deps)();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({ kind: "stale-undo", path: taskPath, direction: "undo" });
		}
		expect(store.notes.get(taskPath)?.frontmatter["scheduled"]).toBe("2026-09-07T09:00");
		// Dropped, not left on the undo branch for a retry.
		expect(isNone(history.takeUndo())).toBe(true);
	});

	it("treats a missing key and an explicit null as equivalent when checking staleness", async () => {
		const { deps, store, history } = makeDeps();
		// `duration` was never set; the gesture's redo never wrote it either.
		store.seed(taskPath, { type: "task", status: "todo", scheduled: "2026-09-06T09:00" });
		const entry: RescheduleEntry = {
			path: taskPath,
			undo: { scheduled: "2026-09-05T09:00" },
			redo: { scheduled: "2026-09-06T09:00" },
		};
		history.record(entry);

		const result = await makeUndoReschedule(deps)();

		expect(result.ok).toBe(true);
	});

	it("returns the store error and does not push to redo when the rawFrontmatter read fails", async () => {
		const { deps, history } = makeDeps();
		// Note doesn't exist: rawFrontmatter fails with not-found.
		const entry: RescheduleEntry = { path: taskPath, undo: { scheduled: "2026-09-05T09:00" }, redo: { scheduled: "2026-09-06T09:00" } };
		history.record(entry);

		const result = await makeUndoReschedule(deps)();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("store");
		}
		expect(isNone(history.takeRedo())).toBe(true);
	});

	it("returns the store error and does not push to redo when the write fails", async () => {
		const { deps, store, history } = makeDeps();
		store.seed(taskPath, { type: "task", status: "todo", scheduled: "2026-09-06T09:00" });
		const entry: RescheduleEntry = { path: taskPath, undo: { scheduled: "2026-09-05T09:00" }, redo: { scheduled: "2026-09-06T09:00" } };
		history.record(entry);
		store.updateProperties = async () => ({ ok: false, error: { kind: "io-error", path: taskPath, message: "disk full" } });

		const result = await makeUndoReschedule(deps)();

		expect(result.ok).toBe(false);
		expect(isNone(history.takeRedo())).toBe(true);
	});
});

describe("makeRedoReschedule", () => {
	it("returns ok(none()) and writes nothing when there is nothing to redo", async () => {
		const { deps, store } = makeDeps();
		store.seed(taskPath, { type: "task", status: "todo", scheduled: "2026-09-05T09:00" });

		const result = await makeRedoReschedule(deps)();

		expect(result).toEqual({ ok: true, value: { some: false } });
		expect(store.notes.get(taskPath)?.frontmatter["scheduled"]).toBe("2026-09-05T09:00");
	});

	it("applies the redo patch and pushes the entry back onto the undo branch", async () => {
		const { deps, store, history } = makeDeps();
		store.seed(taskPath, { type: "task", status: "todo", scheduled: "2026-09-05T09:00" });
		const entry: RescheduleEntry = {
			path: taskPath,
			undo: { scheduled: "2026-09-05T09:00" },
			redo: { scheduled: "2026-09-06T09:00" },
		};
		history.pushUndone(entry);

		const result = await makeRedoReschedule(deps)();

		expect(result.ok).toBe(true);
		expect(store.notes.get(taskPath)?.frontmatter["scheduled"]).toBe("2026-09-06T09:00");
		expect(isNone(history.takeRedo())).toBe(true);
	});

	it("returns stale-undo when the note changed since the undo", async () => {
		const { deps, store, history } = makeDeps();
		// Stored value no longer matches the values the undo wrote.
		store.seed(taskPath, { type: "task", status: "todo", scheduled: "2026-09-08T09:00" });
		const entry: RescheduleEntry = {
			path: taskPath,
			undo: { scheduled: "2026-09-05T09:00" },
			redo: { scheduled: "2026-09-06T09:00" },
		};
		history.pushUndone(entry);

		const result = await makeRedoReschedule(deps)();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({ kind: "stale-undo", path: taskPath, direction: "redo" });
		}
		expect(store.notes.get(taskPath)?.frontmatter["scheduled"]).toBe("2026-09-08T09:00");
	});
});

describe("reschedule -> undo -> redo -> undo round trip", () => {
	it("wires makeRescheduleTask's inverse patch through the history correctly end to end", async () => {
		const { deps, store } = makeDeps();
		store.seed(taskPath, { type: "task", status: "todo", scheduled: "2026-09-05T09:00" });

		const rescheduleResult = await makeRescheduleTask(deps)(taskPath, "scheduled", date("2026-09-05T09:00"), some(date("2026-09-05T10:30")));
		expect(rescheduleResult.ok).toBe(true);
		if (!rescheduleResult.ok) return;
		deps.history.record(rescheduleResult.value);
		expect(store.notes.get(taskPath)?.frontmatter["duration"]).toBe(90);

		const undone = await makeUndoReschedule(deps)();
		expect(undone.ok).toBe(true);
		expect(store.notes.get(taskPath)?.frontmatter["duration"]).toBeUndefined();

		const redone = await makeRedoReschedule(deps)();
		expect(redone.ok).toBe(true);
		expect(store.notes.get(taskPath)?.frontmatter["duration"]).toBe(90);

		const undoneAgain = await makeUndoReschedule(deps)();
		expect(undoneAgain.ok).toBe(true);
		expect(store.notes.get(taskPath)?.frontmatter["duration"]).toBeUndefined();
	});
});
