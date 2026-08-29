import type { App, Menu, Plugin, TAbstractFile } from "obsidian";
import { TFile } from "obsidian";

import type { makeSetDate } from "@/app/set-date";
import type { makeSetDuration } from "@/app/set-duration";
import type { makeSetPriority } from "@/app/set-priority";
import type { makeSetProject } from "@/app/set-project";
import type { makeSetRecurrence } from "@/app/set-recurrence";
import type { makeSetStatus } from "@/app/set-status";
import type { makeSetTags } from "@/app/set-tags";
import { isTaskNote, parseTask } from "@/domain/frontmatter";
import type { PropertyKeys } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import type { Task, TaskPath } from "@/domain/task";
import type { Notifier } from "@/ports/notifier";
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

/** Parses `file` into a `Task` if it's a task note (per the configured marker), reading the metadata cache directly — same synchronous approach as `commands/register-commands.ts#activeTaskFile`, since a `file-menu`/`editor-menu` handler must add its items before returning. `undefined` for anything else (not a task note, or one that fails to parse). */
function parseTaskFile(deps: RegisterTaskMenusDeps, file: TFile): Task | undefined {
	const keys = deps.getPropertyKeys();
	const raw = deps.app.metadataCache.getFileCache(file)?.frontmatter;
	if (raw === undefined || !isTaskNote(raw, keys)) {
		return undefined;
	}
	const result = parseTask(file.path as TaskPath, file.basename, raw, keys, deps.getStatuses());
	return result.ok ? result.value : undefined;
}

/** Appends a separated, labelled "Obtask" section (`ui/task-edit-menu.ts#buildTaskEditMenu`'s full property list) to an already-open file/editor menu. */
function addObtaskSection(menu: Menu, task: Task, deps: RegisterTaskMenusDeps): void {
	menu.addSeparator();
	menu.addItem((item) => item.setTitle("Obtask").setIsLabel(true));
	buildTaskEditMenu(menu, task, {
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
	});
}

/**
 * Registers an "Obtask" section on the file-menu (file explorer, tab
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
			addObtaskSection(menu, task, deps);
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
			addObtaskSection(menu, task, deps);
		}),
	);
}
