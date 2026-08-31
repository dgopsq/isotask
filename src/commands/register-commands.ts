import type { App, Plugin, TFile } from "obsidian";
import { normalizePath } from "obsidian";

import type { makeConvertNote } from "@/app/convert-note";
import type { makeCreateTask } from "@/app/create-task";
import type { makeCycleStatus } from "@/app/cycle-status";
import type { AppError } from "@/app/errors";
import { describeAppError, storeError } from "@/app/errors";
import { renderTasksBase } from "@/app/generate-base";
import type { DateField, makeSetDate } from "@/app/set-date";
import type { makeSetDuration } from "@/app/set-duration";
import type { makeSetPriority } from "@/app/set-priority";
import type { makeSetProject } from "@/app/set-project";
import type { makeSetRecurrence } from "@/app/set-recurrence";
import type { makeSetStatus } from "@/app/set-status";
import type { makeSetTags } from "@/app/set-tags";
import type { RedoReschedule, UndoReschedule } from "@/app/undo-reschedule";
import { isTaskNote } from "@/domain/frontmatter";
import type { PropertyKeys } from "@/domain/property-keys";
import type { Result } from "@/domain/result";
import { err } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import type { Task, TaskPath } from "@/domain/task";
import { VIEW_TYPE_CALENDAR, VIEW_TYPE_FEED, VIEW_TYPE_TASK_PANEL } from "@/plugin-id";
import type { Notifier } from "@/ports/notifier";
import type { TaskStore } from "@/ports/task-store";
import { CreateTaskModal } from "@/ui/create-task-modal";
import { openDateModalFor, openDurationModalFor, openProjectModalFor, openRecurrenceModalFor, openTagsModalFor } from "@/ui/edit-field-modals";
import { PrioritySuggestModal } from "@/ui/priority-suggest-modal";
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
	readonly setPriority: ReturnType<typeof makeSetPriority>;
	readonly setDuration: ReturnType<typeof makeSetDuration>;
	readonly setRecurrence: ReturnType<typeof makeSetRecurrence>;
	readonly setProject: ReturnType<typeof makeSetProject>;
	readonly setTags: ReturnType<typeof makeSetTags>;
	readonly undoReschedule: UndoReschedule;
	readonly redoReschedule: RedoReschedule;
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

	/**
	 * Shared body of the "Undo/redo last calendar reschedule" commands: run
	 * one history step, and tell the user only when there was nothing to
	 * do — a successful undo/redo is visible on the calendar itself (if
	 * open), so a notice on top of that would be noise. These operate on the
	 * same shared `RescheduleHistory` instance the calendar view records
	 * into, so they work regardless of what is focused — the mobile path,
	 * where there is no Cmd+Z.
	 */
	async function runHistoryStep(step: UndoReschedule | RedoReschedule, emptyMessage: string): Promise<void> {
		const result = await step();
		if (!result.ok) {
			deps.notifier.error(describeAppError(result.error));
			return;
		}
		if (!result.value.some) {
			deps.notifier.info(emptyMessage);
		}
	}

	/**
	 * Reads and parses the task at `file`, then hands it to `action` — the
	 * shared precondition of every command below that seeds a modal from the
	 * task's current field values (`ui/edit-field-modals.ts`). Reports the
	 * store error and skips `action` if the note doesn't parse, rather than
	 * opening a modal seeded with nothing to edit.
	 */
	async function withTask(file: TFile, action: (task: Task) => void): Promise<void> {
		const taskResult = await deps.store.read(file.path as TaskPath);
		if (!taskResult.ok) {
			report(err(storeError(taskResult.error)));
			return;
		}
		action(taskResult.value);
	}

	async function openDateModal(file: TFile, field: DateField): Promise<void> {
		await withTask(file, (task) => {
			openDateModalFor(deps.app, task, field, deps.setDate, deps.notifier);
		});
	}

	async function openRecurrenceModal(file: TFile): Promise<void> {
		await withTask(file, (task) => {
			openRecurrenceModalFor(deps.app, task, deps.setRecurrence, deps.notifier);
		});
	}

	async function openDurationModal(file: TFile): Promise<void> {
		await withTask(file, (task) => {
			openDurationModalFor(deps.app, task, deps.setDuration, deps.notifier);
		});
	}

	async function openProjectModal(file: TFile): Promise<void> {
		await withTask(file, (task) => {
			openProjectModalFor(deps.app, task, deps.setProject, deps.notifier);
		});
	}

	async function openTagsModal(file: TFile): Promise<void> {
		await withTask(file, (task) => {
			openTagsModalFor(deps.app, task, deps.setTags, deps.notifier);
		});
	}

	async function createTasksBase(): Promise<void> {
		const path = normalizePath(deps.getTasksBasePath());
		if (deps.app.vault.getAbstractFileByPath(path) !== null) {
			deps.notifier.error(`A file already exists at ${path}.`);
			return;
		}
		const content = renderTasksBase(
			deps.getPropertyKeys(),
			deps.getStatuses(),
			{ feed: VIEW_TYPE_FEED, calendar: VIEW_TYPE_CALENDAR },
			deps.getTaskFolder(),
		);
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

	/** Reveals the sidebar task panel (`views/task-panel/task-panel-view.ts`), reusing an already-open leaf of that type if there is one, else opening a new one in the right sidebar. */
	async function revealTaskPanel(): Promise<void> {
		const existing = deps.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_PANEL)[0];
		if (existing !== undefined) {
			await deps.app.workspace.revealLeaf(existing);
			return;
		}
		// `getRightLeaf` can come back null (no right split available); fall
		// back to a main-area tab so the command never silently no-ops.
		const leaf = deps.app.workspace.getRightLeaf(false) ?? deps.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_TASK_PANEL, active: true });
		await deps.app.workspace.revealLeaf(leaf);
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
				void openDateModal(file, "due");
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
				void openDateModal(file, "scheduled");
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
		id: "set-priority",
		name: "Set priority…",
		checkCallback: (checking) => {
			const file = activeTaskFile(deps.app, deps.getPropertyKeys());
			if (file === null) {
				return false;
			}
			if (!checking) {
				const path = file.path as TaskPath;
				new PrioritySuggestModal(deps.app, (priority) => {
					void deps.setPriority(path, priority).then(report);
				}).open();
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "set-duration",
		name: "Set duration…",
		checkCallback: (checking) => {
			const file = activeTaskFile(deps.app, deps.getPropertyKeys());
			if (file === null) {
				return false;
			}
			if (!checking) {
				void openDurationModal(file);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "set-project",
		name: "Set project…",
		checkCallback: (checking) => {
			const file = activeTaskFile(deps.app, deps.getPropertyKeys());
			if (file === null) {
				return false;
			}
			if (!checking) {
				void openProjectModal(file);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "set-tags",
		name: "Set tags…",
		checkCallback: (checking) => {
			const file = activeTaskFile(deps.app, deps.getPropertyKeys());
			if (file === null) {
				return false;
			}
			if (!checking) {
				void openTagsModal(file);
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

	plugin.addCommand({
		id: "open-task-panel",
		name: "Open task panel",
		callback: () => {
			void revealTaskPanel();
		},
	});

	plugin.addCommand({
		id: "undo-reschedule",
		name: "Undo last calendar reschedule",
		callback: () => {
			void runHistoryStep(deps.undoReschedule, "Nothing to undo.");
		},
	});

	plugin.addCommand({
		id: "redo-reschedule",
		name: "Redo last calendar reschedule",
		callback: () => {
			void runHistoryStep(deps.redoReschedule, "Nothing to redo.");
		},
	});
}
