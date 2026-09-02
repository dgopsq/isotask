import { describe, expect, it } from "vitest";

import type { AppDeps } from "@/app/deps";
import { makeCreateTask } from "@/app/create-task";
import type { TaskDraft } from "@/app/create-task";
import { FakeClock, FakeNotifier, FakeRescheduleHistory, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime, TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import type { ObtaskSettings } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { Minutes, RRuleString, TaskPath } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

function path(value: string): TaskPath {
	return value as TaskPath;
}

function makeDeps(overrides: Partial<ObtaskSettings> = {}): {
	readonly deps: AppDeps;
	readonly store: FakeTaskStore;
} {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock("2026-09-02T10:00" as IsoDateTime, "2026-09-02" as IsoDate);
	const notifier = new FakeNotifier();
	const settings: ObtaskSettings = { ...DEFAULT_SETTINGS, ...overrides };
	return { deps: { store, clock, notifier, history: new FakeRescheduleHistory(), settings: () => settings }, store };
}

describe("makeCreateTask", () => {
	it("creates a task with default status, taskFolder and created = now", async () => {
		const { deps, store } = makeDeps();
		const draft: TaskDraft = { title: "Buy milk" };
		const result = await makeCreateTask(deps)(draft);

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.value).toBe("Tasks/Buy milk.md");
		const note = store.notes.get(result.value);
		expect(note?.frontmatter).toEqual({ type: "task", status: "todo", created: "2026-09-02T10:00" });
	});

	it("sets only the frontmatter keys that have a value", async () => {
		const { deps, store } = makeDeps();
		const draft: TaskDraft = {
			title: "Team sync",
			priority: "high",
			due: date("2026-09-05"),
			project: "Growth",
			tags: ["work"],
		};
		const result = await makeCreateTask(deps)(draft);

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		const note = store.notes.get(result.value);
		expect(note?.frontmatter).toEqual({
			type: "task",
			status: "todo",
			created: "2026-09-02T10:00",
			priority: "high",
			due: "2026-09-05",
			project: "[[Growth]]",
			tags: ["work"],
		});
		expect("scheduled" in (note?.frontmatter ?? {})).toBe(false);
	});

	it("uses draft.folder over settings.taskFolder", async () => {
		const { deps, store } = makeDeps();
		const result = await makeCreateTask(deps)({ title: "Buy milk", folder: "Work/Tasks" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("Work/Tasks/Buy milk.md");
		}
		expect(store.notes.has(path("Work/Tasks/Buy milk.md"))).toBe(true);
	});

	it("expands {{title}} and {{due}} in the filename template", async () => {
		const { deps } = makeDeps({ newTaskFilenameTemplate: "{{title}} ({{due}})" });
		const result = await makeCreateTask(deps)({ title: "Buy milk", due: date("2026-09-05") });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("Tasks/Buy milk (2026-09-05).md");
		}
	});

	it("sanitises characters not allowed in a filename", async () => {
		const { deps } = makeDeps();
		const result = await makeCreateTask(deps)({ title: 'Buy "milk" / eggs?' });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("Tasks/Buy milk  eggs.md");
		}
	});

	it("de-duplicates like Obsidian: appends \" 2\", \" 3\", ...", async () => {
		const { deps, store } = makeDeps();
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo" });
		store.seed(path("Tasks/Buy milk 2.md"), { type: "task", status: "todo" });

		const result = await makeCreateTask(deps)({ title: "Buy milk" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("Tasks/Buy milk 3.md");
		}
	});

	it("fails with no-status-configured when no open status is configured", async () => {
		const { deps } = makeDeps({ statuses: DEFAULT_STATUSES.filter((s) => s.kind !== "open") });
		const result = await makeCreateTask(deps)({ title: "Buy milk" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({ kind: "no-status-configured" });
		}
	});

	it("sets duration and repeat when provided", async () => {
		const { deps, store } = makeDeps();
		const result = await makeCreateTask(deps)({
			title: "Water plants",
			scheduled: date("2026-09-02T08:00"),
			duration: 15 as Minutes,
			repeat: "FREQ=DAILY" as RRuleString,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const note = store.notes.get(result.value);
			expect(note?.frontmatter["duration"]).toBe(15);
			expect(note?.frontmatter["repeat"]).toBe("FREQ=DAILY");
		}
	});
});
