import type { App, Menu, Plugin, TAbstractFile } from "obsidian";
import { TFile } from "obsidian";

import type { makeSetDate } from "@/app/set-date";
import type { makeSetDuration } from "@/app/set-duration";
import type { makeSetPriority } from "@/app/set-priority";
import type { makeSetProject } from "@/app/set-project";
import type { makeSetRecurrence } from "@/app/set-recurrence";
import type { makeSetStatus } from "@/app/set-status";
import type { makeSetTags } from "@/app/set-tags";
import { parseTask } from "@/domain/frontmatter";
import type { PropertyKeys } from "@/domain/property-keys";
import type { Result } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import type { Task, TaskParseError, TaskPath } from "@/domain/task";
import type { Notifier } from "@/ports/notifier";
import type { TaskEditMenuCtx } from "@/ui/task-edit-menu";
import { buildTaskEditMenu } from "@/ui/task-edit-menu";

export interface RegisterTaskMenusDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly setStatus: ReturnType<typeof makeSetStatus>;
	readonly setPriority: ReturnType<typeof makeSetPriority>;
	readonly setDate: ReturnType<typeof makeSetDate>;
	readonly setDuration: ReturnType<typeof makeSetDuration>;
	readonly setRecurrence: ReturnType<typeof makeSetRecurrence>;
	readonly setProject: ReturnType<typeof makeSetProject>;
	readonly setTags: ReturnType<typeof makeSetTags>;
	readonly notifier: Notifier;
}

/**
 * Parses `file` via `domain/frontmatter.ts#parseTask`, reading the metadata
 * cache directly — same synchronous approach as
 * `commands/register-commands.ts#activeTaskFile`, since a
 * `file-menu`/`editor-menu` handler must add its items before returning.
 * Keeps the full `Result`, unlike `parseTaskFile` below, so a caller can
 * tell "not a task note" (a single `not-a-task` error) apart from "a task
 * note with invalid frontmatter" — the distinction the sidebar task panel
 * (`views/task-panel/task-panel-view.ts`) needs to choose between its
 * convert-prompt and parse-error states.
 */
export function parseTaskFileDetailed(deps: RegisterTaskMenusDeps, file: TFile): Result<Task, readonly TaskParseError[]> {
	const keys = deps.getPropertyKeys();
	const raw = deps.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	return parseTask(file.path as TaskPath, file.basename, raw, keys, deps.getStatuses());
}

/** `parseTaskFileDetailed`, collapsed to `undefined` for anything that isn't a valid task (not a task note, or one that fails to parse) — what the file/editor menu and the per-note header action need, since neither cares why. */
export function parseTaskFile(deps: RegisterTaskMenusDeps, file: TFile): Task | undefined {
	const result = parseTaskFileDetailed(deps, file);
	return result.ok ? result.value : undefined;
}

/** Builds the `ui/task-edit-menu.ts#buildTaskEditMenu` context from `RegisterTaskMenusDeps` — shared by the file/editor menu section below and `adapters/obsidian/view-actions.ts`'s header action, so both open the exact same menu. */
export function taskEditMenuCtx(deps: RegisterTaskMenusDeps): TaskEditMenuCtx {
	return {
		app: deps.app,
		statuses: deps.getStatuses(),
		setStatus: deps.setStatus,
		setPriority: deps.setPriority,
		setDate: deps.setDate,
		setDuration: deps.setDuration,
		setRecurrence: deps.setRecurrence,
		setProject: deps.setProject,
		setTags: deps.setTags,
		notifier: deps.notifier,
	};
}

/** Appends a separated, labelled "Isotask" section (`ui/task-edit-menu.ts#buildTaskEditMenu`'s full property list) to an already-open file/editor menu. */
function addIsotaskSection(menu: Menu, task: Task, deps: RegisterTaskMenusDeps): void {
	menu.addSeparator();
	menu.addItem((item) => item.setTitle("Isotask").setIsLabel(true));
	buildTaskEditMenu(menu, task, taskEditMenuCtx(deps));
}

/**
 * Registers an "Isotask" section on the file-menu (file explorer, tab
 * context menu, …) and the editor-menu (in-editor right-click) for any
 * task note, built from `ui/task-edit-menu.ts#buildTaskEditMenu` — every
 * property editable wherever the plugin owns UI, per `AGENTS.md`.
 */
export function registerTaskMenus(plugin: Plugin, deps: RegisterTaskMenusDeps): void {
	plugin.registerEvent(
		plugin.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
			if (!(file instanceof TFile)) {
				return;
			}
			const task = parseTaskFile(deps, file);
			if (task === undefined) {
				return;
			}
			addIsotaskSection(menu, task, deps);
		}),
	);

	plugin.registerEvent(
		plugin.app.workspace.on("editor-menu", (menu, _editor, info) => {
			const file = info.file;
			if (file === null) {
				return;
			}
			const task = parseTaskFile(deps, file);
			if (task === undefined) {
				return;
			}
			addIsotaskSection(menu, task, deps);
		}),
	);
}
