import type { App, Plugin, TFile } from "obsidian";
import { normalizePath } from "obsidian";

import type { makeConvertNote } from "@/app/convert-note";
import type { makeCreateTask } from "@/app/create-task";
import type { makeCycleStatus } from "@/app/cycle-status";
import type { AppError } from "@/app/errors";
import { describeAppError } from "@/app/errors";
import { renderTasksBase } from "@/app/generate-base";
import type { DateField, makeSetDate } from "@/app/set-date";
import type { makeSetRecurrence } from "@/app/set-recurrence";
import type { makeSetStatus } from "@/app/set-status";
import { isTaskNote } from "@/domain/frontmatter";
import type { PropertyKeys } from "@/domain/property-keys";
import type { Result } from "@/domain/result";
import { fromNullable, none } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import type { TaskPath } from "@/domain/task";
import { VIEW_TYPE_CALENDAR, VIEW_TYPE_FEED } from "@/plugin-id";
import type { Notifier } from "@/ports/notifier";
import type { TaskStore } from "@/ports/task-store";
import { CreateTaskModal } from "@/ui/create-task-modal";
import { DateModal } from "@/ui/date-modal";
import { RecurrenceModal } from "@/ui/recurrence-modal";
import { StatusSuggestModal } from "@/ui/status-suggest-modal";

export interface RegisterCommandsDeps {
	readonly app: App;
	readonly store: TaskStore;
	readonly notifier: Notifier;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getTaskFolder: () => string;
	readonly getTasksBasePath: () => string;
	readonly createTask: ReturnType<typeof makeCreateTask>;
	readonly convertNote: ReturnType<typeof makeConvertNote>;
	readonly setStatus: ReturnType<typeof makeSetStatus>;
	readonly cycleStatus: ReturnType<typeof makeCycleStatus>;
	readonly setDate: ReturnType<typeof makeSetDate>;
	readonly setRecurrence: ReturnType<typeof makeSetRecurrence>;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The active file, only if it's a task note (per the configured marker) — `null` otherwise. Never reads the deprecated `workspace.activeLeaf`. */
function activeTaskFile(app: App, keys: PropertyKeys): TFile | null {
	const file = app.workspace.getActiveFile();
	if (file === null) {
		return null;
	}
	const raw = app.metadataCache.getFileCache(file)?.frontmatter;
	if (raw === undefined || !isTaskNote(raw, keys)) {
		return null;
	}
	return file;
}

/** Registers every plugin command (`docs/ROADMAP.md` M1). Note-scoped commands use `checkCallback` so they're only offered when the active file is a task note. */
export function registerCommands(plugin: Plugin, deps: RegisterCommandsDeps): void {
	function report(result: Result<unknown, AppError>): void {
		if (!result.ok) {
			deps.notifier.error(describeAppError(result.error));
		}
	}

	async function openDateModal(file: TFile, field: DateField, title: string): Promise<void> {
		const path = file.path as TaskPath;
		const taskResult = await deps.store.read(path);
		const initial = taskResult.ok ? fromNullable(field === "due" ? taskResult.value.due : taskResult.value.scheduled) : none();

		new DateModal(deps.app, {
			title,
			initial,
			onSave: async (value) => {
				report(await deps.setDate(path, field, value));
			},
		}).open();
	}

	async function openRecurrenceModal(file: TFile): Promise<void> {
		const path = file.path as TaskPath;
		const taskResult = await deps.store.read(path);
		const initial = taskResult.ok ? fromNullable(taskResult.value.repeat) : none();

		new RecurrenceModal(deps.app, {
			initial,
			onSave: async (rule) => {
				report(await deps.setRecurrence(path, rule));
			},
		}).open();
	}

	async function createTasksBase(): Promise<void> {
		const path = normalizePath(deps.getTasksBasePath());
		if (deps.app.vault.getAbstractFileByPath(path) !== null) {
			deps.notifier.error(`A file already exists at ${path}.`);
			return;
		}
		const content = renderTasksBase(deps.getPropertyKeys(), deps.getStatuses(), {
			feed: VIEW_TYPE_FEED,
			calendar: VIEW_TYPE_CALENDAR,
		});
		try {
			const file = await deps.app.vault.create(path, content);
			await deps.app.workspace.getLeaf().openFile(file);
		} catch (error) {
			deps.notifier.error(`Could not create ${path}: ${describeError(error)}`);
		}
	}

	async function openTasksBase(): Promise<void> {
		const path = normalizePath(deps.getTasksBasePath());
		const file = deps.app.vault.getFileByPath(path);
		if (file === null) {
			deps.notifier.error(`No file at ${path}. Run "Create tasks base" first.`);
			return;
		}
		await deps.app.workspace.getLeaf().openFile(file);
	}

	plugin.addCommand({
		id: "create-task",
		name: "Create task",
		callback: () => {
			new CreateTaskModal(deps.app, {
				app: deps.app,
				createTask: deps.createTask,
				getStatuses: deps.getStatuses,
				getDefaultFolder: deps.getTaskFolder,
			}).open();
		},
	});

	plugin.addCommand({
		id: "convert-note-to-task",
		name: "Convert note to task",
		checkCallback: (checking) => {
			const file = deps.app.workspace.getActiveFile();
			if (file === null) {
				return false;
			}
			if (!checking) {
				void deps.convertNote(file.path as TaskPath).then(report);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "set-status",
		name: "Set status…",
		checkCallback: (checking) => {
			const file = activeTaskFile(deps.app, deps.getPropertyKeys());
			if (file === null) {
				return false;
			}
			if (!checking) {
				const path = file.path as TaskPath;
				new StatusSuggestModal(deps.app, deps.getStatuses(), (status) => {
					void deps.setStatus(path, status.id).then(report);
				}).open();
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "complete-task",
		name: "Complete task",
		checkCallback: (checking) => {
			const file = activeTaskFile(deps.app, deps.getPropertyKeys());
			if (file === null) {
				return false;
			}
			const doneStatus = deps.getStatuses().find((status) => status.kind === "done");
			if (doneStatus === undefined) {
				if (!checking) {
					deps.notifier.error('No status with kind "done" is configured.');
				}
				return true;
			}
			if (!checking) {
				void deps.setStatus(file.path as TaskPath, doneStatus.id).then(report);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "cycle-status",
		name: "Cycle status",
		checkCallback: (checking) => {
			const file = activeTaskFile(deps.app, deps.getPropertyKeys());
			if (file === null) {
				return false;
			}
			if (!checking) {
				void deps.cycleStatus(file.path as TaskPath).then(report);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "set-due-date",
		name: "Set due date…",
		checkCallback: (checking) => {
			const file = activeTaskFile(deps.app, deps.getPropertyKeys());
			if (file === null) {
				return false;
			}
			if (!checking) {
				void openDateModal(file, "due", "Set due date");
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "set-scheduled-date",
		name: "Set scheduled date…",
		checkCallback: (checking) => {
			const file = activeTaskFile(deps.app, deps.getPropertyKeys());
			if (file === null) {
				return false;
			}
			if (!checking) {
				void openDateModal(file, "scheduled", "Set scheduled date");
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "set-recurrence",
		name: "Set recurrence…",
		checkCallback: (checking) => {
			const file = activeTaskFile(deps.app, deps.getPropertyKeys());
			if (file === null) {
				return false;
			}
			if (!checking) {
				void openRecurrenceModal(file);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "create-tasks-base",
		name: "Create tasks base",
		callback: () => {
			void createTasksBase();
		},
	});

	plugin.addCommand({
		id: "open-tasks-base",
		name: "Open tasks base",
		callback: () => {
			void openTasksBase();
		},
	});
}
