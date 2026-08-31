import type { Plugin, WorkspaceLeaf } from "obsidian";
import { Menu, MarkdownView } from "obsidian";

import type { RegisterTaskMenusDeps } from "@/adapters/obsidian/menus";
import { parseTaskFile, taskEditMenuCtx } from "@/adapters/obsidian/menus";
import { buildTaskEditMenu } from "@/ui/task-edit-menu";

const EDIT_TASK_ICON = "square-check";
const EDIT_TASK_TITLE = "Edit task";

/** Every markdown leaf's header action element this module has added, keyed by its `MarkdownView` so a view gains at most one — cleared as views stop being task notes, and swept on unload. */
type ActionEls = WeakMap<MarkdownView, HTMLElement>;

/**
 * A `Menu` forced to render as DOM rather than a native OS context menu —
 * same reasoning and pattern as `views/bases/feed/feed-view.ts#newMenu`.
 */
function newMenu(): Menu {
	return new Menu().setUseNativeMenu(false);
}

function markdownLeaves(deps: RegisterTaskMenusDeps): MarkdownView[] {
	return deps.app.workspace.getLeavesOfType("markdown").flatMap((leaf: WorkspaceLeaf) => {
		return leaf.view instanceof MarkdownView ? [leaf.view] : [];
	});
}

/**
 * Adds (or removes) `view`'s "Edit task" header action to match whether its
 * file is currently a task note, per `parseTaskFile` (same guard as the
 * file/editor menu). The task is re-parsed at click time rather than
 * captured here, so the menu always reflects the latest saved frontmatter
 * even if it changed between the action being added and clicked.
 */
function syncView(view: MarkdownView, deps: RegisterTaskMenusDeps, actionEls: ActionEls): void {
	const file = view.file;
	const task = file === null ? undefined : parseTaskFile(deps, file);
	const existing = actionEls.get(view);

	if (task === undefined) {
		if (existing !== undefined) {
			existing.remove();
			actionEls.delete(view);
		}
		return;
	}

	if (existing !== undefined) {
		return;
	}

	const el = view.addAction(EDIT_TASK_ICON, EDIT_TASK_TITLE, (evt) => {
		const currentFile = view.file;
		const currentTask = currentFile === null ? undefined : parseTaskFile(deps, currentFile);
		if (currentTask === undefined) {
			return;
		}
		const menu = newMenu();
		buildTaskEditMenu(menu, currentTask, taskEditMenuCtx(deps));
		menu.showAtMouseEvent(evt);
	});
	actionEls.set(view, el);
}

function syncAllViews(deps: RegisterTaskMenusDeps, actionEls: ActionEls): void {
	for (const view of markdownLeaves(deps)) {
		syncView(view, deps, actionEls);
	}
}

/**
 * Registers a per-note "Edit task" header action on every open `MarkdownView`
 * whose file is a task note — the same `buildTaskEditMenu` the file/editor
 * menu and feed row use, opened as a DOM menu at the click position.
 *
 * Recomputed on `file-open`, `active-leaf-change`, `layout-change` (a note
 * can gain/lose the marker via edits reflected through these) and
 * `metadataCache`'s `changed` event, plus an initial sweep once the
 * workspace layout is ready (covers leaves already open at startup). Added
 * action elements are tracked in a `WeakMap` so each view gains at most one,
 * and removed when the file stops being a task note or the plugin unloads.
 */
export function registerTaskViewActions(plugin: Plugin, deps: RegisterTaskMenusDeps): void {
	const actionEls: ActionEls = new WeakMap();

	const resync = (): void => {
		syncAllViews(deps, actionEls);
	};

	plugin.app.workspace.onLayoutReady(resync);

	plugin.registerEvent(plugin.app.workspace.on("file-open", resync));
	plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", resync));
	plugin.registerEvent(plugin.app.workspace.on("layout-change", resync));
	plugin.registerEvent(plugin.app.metadataCache.on("changed", resync));

	plugin.register(() => {
		for (const view of markdownLeaves(deps)) {
			const el = actionEls.get(view);
			if (el !== undefined) {
				el.remove();
				actionEls.delete(view);
			}
		}
	});
}
