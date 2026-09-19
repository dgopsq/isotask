import type { TFile, WorkspaceLeaf } from "obsidian";
import { ItemView, MarkdownView, Setting, setTooltip } from "obsidian";

import type { RegisterTaskMenusDeps } from "@/adapters/obsidian/menus";
import { parseTaskFileDetailed } from "@/adapters/obsidian/menus";
import { projectRawColor } from "@/adapters/obsidian/project-color-lookup";
import type { makeConvertNote } from "@/app/convert-note";
import type { AppError } from "@/app/errors";
import { describeAppError } from "@/app/errors";
import type { DateField } from "@/app/set-date";
import { dotColorClasses, resolveDotColor } from "@/domain/project-color";
import { describeRRule } from "@/domain/recurrence";
import { describeReminders } from "@/domain/reminder-presets";
import type { ReminderDefaults } from "@/domain/reminders";
import { defaultReminderSpecs, reminderAnchor } from "@/domain/reminders";
import type { Result } from "@/domain/result";
import { findStatus, isTerminal, toggleStatus } from "@/domain/status";
import type { Priority, Task, TaskParseError, TaskPath } from "@/domain/task";
import { describeTaskParseError, PRIORITIES, priorityLabel } from "@/domain/task";
import { formatDurationMinutes } from "@/domain/task-display";
import { cssClass, VIEW_TYPE_TASK_PANEL } from "@/plugin-id";
import {
	openDateModalFor,
	openDurationModalFor,
	openProjectModalFor,
	openRecurrenceModalFor,
	openReminderModalFor,
	openTagsModalFor,
} from "@/ui/edit-field-modals";
import { ProjectColorModal } from "@/ui/project-color-modal";

/** Shared with the ribbon icon (`main.ts`) so the two never drift apart. */
export const TASK_PANEL_ICON = "square-check";
const TASK_PANEL_DISPLAY_TEXT = "Task";

/** Debounce window for a `metadataCache` `changed` re-render, matching the feed row's touch-and-hold pattern's use of a plain `window.setTimeout`. */
const REFRESH_DEBOUNCE_MS = 100;

export interface TaskPanelViewDeps extends RegisterTaskMenusDeps {
	readonly convertNote: ReturnType<typeof makeConvertNote>;
}

/**
 * Sidebar "Task" panel: a plain `ItemView` (not a Bases view) that follows
 * whichever markdown note is currently active and renders its task fields
 * as a form — one `Setting` row per property, editable in place through the
 * same use-cases and modals every other surface uses. There is no local
 * task state and no Save button (`plans/2026-08-31-task-page-editing.md`
 * D1): every change writes through immediately, and the panel simply
 * re-renders from the metadata cache afterwards.
 */
export class TaskPanelView extends ItemView {
	private readonly deps: TaskPanelViewDeps;
	private currentFile: TFile | null = null;
	private refreshTimer: number | undefined;
	// The project note path the last render's swatch resolved, so the
	// `metadataCache` `changed` listener below can also catch a color edited
	// from elsewhere (the feed's project-link menu, the "Set project color"
	// command, or the note edited by hand) while this panel follows one of
	// its tasks — the write lands on the *project* note, never `currentFile`
	// itself. Set in `renderProjectColorSwatch`; cleared at the top of every
	// `render()` so a render with no project (or no resolvable file) doesn't
	// keep re-rendering for a project the panel no longer shows.
	private lastProjectPath: string | undefined;

	constructor(leaf: WorkspaceLeaf, deps: TaskPanelViewDeps) {
		super(leaf);
		this.deps = deps;
	}

	override getViewType(): string {
		return VIEW_TYPE_TASK_PANEL;
	}

	override getDisplayText(): string {
		return TASK_PANEL_DISPLAY_TEXT;
	}

	override getIcon(): string {
		return TASK_PANEL_ICON;
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass(cssClass("panel"));

		this.registerEvent(
			this.deps.app.workspace.on("active-leaf-change", (leaf) => {
				// Only a markdown leaf changes what the panel follows: focus
				// moving into a sidebar leaf (this panel included) must not
				// tear down the form mid-interaction.
				const view = leaf?.view;
				if (view instanceof MarkdownView) {
					this.followFile(view.file);
				}
			}),
		);
		this.registerEvent(
			this.deps.app.workspace.on("file-open", (file) => {
				this.followFile(file !== null && file.extension === "md" ? file : null);
			}),
		);
		this.registerEvent(
			this.deps.app.metadataCache.on("changed", (file) => {
				if (this.currentFile !== null && file.path === this.currentFile.path) {
					this.scheduleRender();
					return;
				}
				// The followed task names a project whose own note just changed —
				// most likely its `color`, edited from the feed/command/by hand
				// rather than through this panel's own swatch (`onDone` already
				// re-renders directly for that path). See `lastProjectPath`'s doc
				// comment.
				if (this.lastProjectPath !== undefined && file.path === this.lastProjectPath) {
					this.scheduleRender();
				}
			}),
		);
		this.registerEvent(
			this.deps.app.vault.on("rename", () => {
				// `metadataCache` deliberately fires no `changed` on rename, and
				// a rename mutates the followed `TFile` in place — so the
				// rendered form's captured `task.path` is stale the instant this
				// fires. Re-render immediately (no debounce) so no click can
				// dispatch a use-case at the dead path. Unconditional on
				// purpose: a parent-folder rename mutates the path too but
				// reports only the folder.
				if (this.currentFile !== null) {
					this.clearRefreshTimer();
					this.render();
				}
			}),
		);
		this.registerEvent(
			this.deps.app.vault.on("delete", () => {
				// Existence check rather than identity: deleting a parent
				// folder reports only the folder, not the followed file.
				if (this.currentFile !== null && this.deps.app.vault.getFileByPath(this.currentFile.path) === null) {
					this.currentFile = null;
					this.clearRefreshTimer();
					this.render();
				}
			}),
		);
		this.register(() => {
			this.clearRefreshTimer();
		});

		this.currentFile = this.activeMarkdownFile();
		this.render();
	}

	/** Points the panel at `file`, re-rendering only when it actually changed — a leaf-change back to the note the panel already shows must not reset the form (open dropdowns, scroll). Content changes to the same file re-render via the `metadataCache` subscription instead. */
	private followFile(file: TFile | null): void {
		if (file?.path === this.currentFile?.path) {
			return;
		}
		this.currentFile = file;
		this.scheduleRender();
	}

	override async onClose(): Promise<void> {
		this.clearRefreshTimer();
	}

	private clearRefreshTimer(): void {
		if (this.refreshTimer !== undefined) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	/** Debounces bursty `metadataCache` `changed` events (e.g. a multi-key `processFrontMatter` write) down to a single re-render, clearing any pending one on re-fire. */
	private scheduleRender(): void {
		this.clearRefreshTimer();
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = undefined;
			this.render();
		}, REFRESH_DEBOUNCE_MS);
	}

	/** The active file, only if it's a markdown note — `null` for anything else (a PDF, an image, no file at all). `getActiveFile` (rather than `getActiveViewOfType(MarkdownView)`) keeps the panel following the last-active note even while focus is on the panel itself, in the sidebar. */
	private activeMarkdownFile(): TFile | null {
		const file = this.deps.app.workspace.getActiveFile();
		return file !== null && file.extension === "md" ? file : null;
	}

	private report(result: Result<unknown, AppError>): void {
		if (!result.ok) {
			this.deps.notifier.error(describeAppError(result.error));
		}
	}

	private render(): void {
		const file = this.currentFile;

		const root = this.contentEl;
		root.empty();
		// Reset here, not just on the "no project" branches below: every path
		// through `render()` either re-sets this from `renderProjectColorSwatch`
		// or genuinely has no project note to track.
		this.lastProjectPath = undefined;

		if (file === null) {
			root.createDiv({ cls: cssClass("panel__empty"), text: "Open a note to see its task fields." });
			return;
		}

		// An unindexed cache (note just created, or startup) would be
		// indistinguishable from "no frontmatter" below and flash the convert
		// prompt at a real task; `metadataCache` fires `changed` for the path
		// once indexed, which re-renders past this state.
		if (this.deps.app.metadataCache.getFileCache(file) === null) {
			root.createDiv({ cls: cssClass("panel__empty"), text: "Loading…" });
			return;
		}

		const result = parseTaskFileDetailed(this.deps, file);
		if (result.ok) {
			this.renderForm(root, result.value);
			return;
		}

		const isNotATask = result.error.length === 1 && result.error[0]?.kind === "not-a-task";
		if (isNotATask) {
			this.renderConvertPrompt(root, file);
			return;
		}

		this.renderParseErrors(root, file, result.error);
	}

	private renderConvertPrompt(root: HTMLElement, file: TFile): void {
		root.createEl("h3", { text: file.basename, cls: cssClass("panel__title") });
		root.createDiv({ cls: cssClass("panel__empty"), text: "Not a task note yet." });

		new Setting(root).addButton((button) =>
			button
				.setButtonText("Convert to task")
				.setCta()
				.onClick(() => {
					void this.deps.convertNote(file.path as TaskPath).then((result) => {
						this.report(result);
					});
				}),
		);
	}

	private renderParseErrors(root: HTMLElement, file: TFile, errors: readonly TaskParseError[]): void {
		root.createEl("h3", { text: file.basename, cls: cssClass("panel__title") });
		root.createDiv({ text: "This task note has errors:", cls: cssClass("panel__error-heading") });

		const list = root.createEl("ul", { cls: cssClass("panel__error-list") });
		for (const error of errors) {
			list.createEl("li", { text: describeTaskParseError(error), cls: cssClass("panel__error") });
		}
	}

	private renderForm(root: HTMLElement, task: Task): void {
		root.createEl("h3", { text: task.title, cls: cssClass("panel__title") });

		this.renderDoneField(root, task);
		this.renderPriorityField(root, task);
		this.renderDateField(root, task, "due", "Due");
		this.renderDateField(root, task, "scheduled", "Scheduled");
		this.renderDurationField(root, task);
		this.renderRepeatField(root, task);
		this.renderReminderField(root, task);
		this.renderProjectField(root, task);
		this.renderTagsField(root, task);
	}

	/** Status is a two-way toggle (open/done, per ADR 0017) — no dropdown, no status list. */
	private renderDoneField(root: HTMLElement, task: Task): void {
		const statuses = this.deps.getStatuses();
		const current = findStatus(statuses, task.status);
		const isDone = current.some && isTerminal(current.value.kind);

		new Setting(root)
			.setName("Done")
			.addToggle((toggle) =>
				toggle.setValue(isDone).onChange(() => {
					const next = toggleStatus(statuses, task.status);
					if (!next.some) {
						this.deps.notifier.error("No status to toggle to is configured");
						toggle.setValue(isDone);
						return;
					}
					void this.deps.setStatus(task.path, next.value.id).then((result) => {
						this.report(result);
						if (!result.ok) {
							toggle.setValue(isDone);
						}
					});
				}),
			);
	}

	private renderPriorityField(root: HTMLElement, task: Task): void {
		const options: Record<string, string> = {};
		for (const priority of PRIORITIES) {
			options[priority] = priorityLabel(priority);
		}

		new Setting(root)
			.setName("Priority")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(options)
					.setValue(task.priority)
					.onChange((value) => {
						void this.deps.setPriority(task.path, value as Priority).then((result) => {
							this.report(result);
						});
					}),
			);
	}

	private renderDateField(root: HTMLElement, task: Task, field: DateField, label: string): void {
		const value = field === "due" ? task.due : task.scheduled;

		new Setting(root)
			.setName(label)
			.setDesc(value ?? "Not set")
			.addButton((button) =>
				button.setButtonText("Edit…").onClick(() => {
					openDateModalFor(this.deps.app, task, field, this.deps.setDate, this.deps.notifier);
				}),
			);
	}

	private renderDurationField(root: HTMLElement, task: Task): void {
		new Setting(root)
			.setName("Duration")
			.setDesc(task.duration !== undefined ? formatDurationMinutes(task.duration) : "Not set")
			.addButton((button) =>
				button.setButtonText("Edit…").onClick(() => {
					openDurationModalFor(this.deps.app, task, this.deps.setDuration, this.deps.notifier);
				}),
			);
	}

	private renderRepeatField(root: HTMLElement, task: Task): void {
		new Setting(root)
			.setName("Repeat")
			.setDesc(task.repeat !== undefined ? describeRRule(task.repeat) : "Not set")
			.addButton((button) =>
				button.setButtonText("Edit…").onClick(() => {
					openRecurrenceModalFor(this.deps.app, task, this.deps.setRecurrence, this.deps.notifier);
				}),
			);
	}

	private renderReminderField(root: HTMLElement, task: Task): void {
		const defaults: ReminderDefaults = this.deps.getReminderDefaults();
		const specs = task.remind ?? defaultReminderSpecs(defaults);

		const setting = new Setting(root)
			.setName("Reminder")
			.setDesc(describeReminders(specs, reminderAnchor(task)?.at))
			.addButton((button) =>
				button.setButtonText("Edit…").onClick(() => {
					openReminderModalFor(this.deps.app, task, this.deps.setReminder, this.deps.getReminderDefaults, this.deps.notifier);
				}),
			);

		if (task.remind === undefined) {
			setting.descEl.addClass(cssClass("panel__default"));
		}
	}

	private renderProjectField(root: HTMLElement, task: Task): void {
		const setting = new Setting(root)
			.setName("Project")
			.setDesc(task.project ?? "Not set")
			.addButton((button) =>
				button.setButtonText("Edit…").onClick(() => {
					openProjectModalFor(this.deps.app, task, this.deps.setProject, this.deps.notifier);
				}),
			);

		this.renderProjectColorSwatch(setting, task);
	}

	/**
	 * A compact color swatch next to the Project field, only once the
	 * project resolves to an actual note — there's nothing to set a color
	 * on otherwise. Opens `ProjectColorModal` for that note; since the
	 * write lands on the *project* note rather than the followed task note,
	 * the panel's own `metadataCache` `changed` subscription (scoped to
	 * `currentFile`) never fires for it, so the modal's `onDone` re-renders
	 * directly instead.
	 */
	private renderProjectColorSwatch(setting: Setting, task: Task): void {
		const project = task.project;
		if (project === undefined) {
			return;
		}
		const projectFile = this.deps.app.metadataCache.getFirstLinkpathDest(project, task.path);
		if (projectFile === null) {
			return;
		}
		this.lastProjectPath = projectFile.path;

		const rawColor = projectRawColor(this.deps.app, project, task.path);
		const dotColor = resolveDotColor(rawColor, project);

		const swatch = setting.controlEl.createEl("button", {
			cls: [cssClass("swatch"), cssClass("swatch--compact"), ...dotColorClasses(dotColor)],
			attr: { type: "button", "aria-label": "Set project color" },
		});
		setTooltip(swatch, "Set project color");
		if (dotColor.kind === "hex") {
			swatch.setCssProps({ "--isotask-dot-color": dotColor.value });
		}
		swatch.addEventListener("click", () => {
			new ProjectColorModal(this.deps.app, projectFile, () => {
				this.render();
			}).open();
		});
	}

	private renderTagsField(root: HTMLElement, task: Task): void {
		new Setting(root)
			.setName("Tags")
			.setDesc(task.tags.length > 0 ? task.tags.map((tag) => `#${tag}`).join(", ") : "Not set")
			.addButton((button) =>
				button.setButtonText("Edit…").onClick(() => {
					openTagsModalFor(this.deps.app, task, this.deps.setTags, this.deps.notifier);
				}),
			);
	}
}
