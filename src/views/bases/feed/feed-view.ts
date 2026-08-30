import type { App, QueryController } from "obsidian";
import { BasesView, Component, Menu, setIcon } from "obsidian";

import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import type { DateField } from "@/app/set-date";
import type { makeSetDate } from "@/app/set-date";
import type { makeSetDuration } from "@/app/set-duration";
import type { makeSetPriority } from "@/app/set-priority";
import type { makeSetProject } from "@/app/set-project";
import type { makeSetRecurrence } from "@/app/set-recurrence";
import type { makeSetStatus } from "@/app/set-status";
import type { makeSetTags } from "@/app/set-tags";
import { describeAppError } from "@/app/errors";
import type { Bucket, DateSource } from "@/domain/buckets";
import { BUCKET_ORDER, groupIntoBuckets } from "@/domain/buckets";
import type { TaskDate } from "@/domain/dates";
import { fromJsDate } from "@/domain/dates";
import type { Weekday } from "@/domain/dates";
import type { FeedRowAnchor } from "@/domain/feed-row";
import { feedRowAnchor, feedRowDefaultDateField } from "@/domain/feed-row";
import { parseFeedViewOptions } from "@/domain/feed-view-options";
import type { PropertyKeys } from "@/domain/property-keys";
import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import { findStatus } from "@/domain/status";
import type { Priority, StatusId, Task, TaskPath } from "@/domain/task";
import { describeTaskParseError, priorityChipClass, priorityLabel } from "@/domain/task";
import { refreshAfterMetadataResolved } from "@/views/bases/refresh-after-resolved";
import { cssClass, VIEW_TYPE_FEED } from "@/plugin-id";
import type { Notifier } from "@/ports/notifier";
import { DateModal } from "@/ui/date-modal";
import { buildPriorityMenu, priorityIcon } from "@/ui/priority-menu";
import { buildStatusMenu, statusIcon } from "@/ui/status-menu";
import { buildTaskEditMenu } from "@/ui/task-edit-menu";

const BUCKET_LABELS: Readonly<Record<Bucket, string>> = {
	overdue: "Overdue",
	today: "Today",
	"this-week": "This week",
	"next-week": "Next week",
	later: "Later",
	"no-date": "No date",
};

const DATE_FIELD_LABELS: Readonly<Record<FeedRowAnchor["field"], string>> = {
	due: "Due",
	scheduled: "Scheduled",
};

/**
 * A `Menu` forced to render as DOM rather than a native OS context menu.
 * Obsidian defaults `useNativeMenu` to `true` on macOS when the
 * `nativeMenus` vault config is unset (`Menu`'s `onload`, verified against
 * the bundled app bundle) — a native menu can't be keyboard-navigated or
 * styled the same as the rest of this plugin's UI, and has no DOM to test
 * against, so every menu this view opens itself forces the DOM path.
 */
function newMenu(): Menu {
	return new Menu().setUseNativeMenu(false);
}

export interface FeedBasesViewDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getWeekStart: () => Weekday;
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
 * Feed view: renders bucket headers and rows (status control, title link,
 * date chip, priority chip, project link, tags) from parsed tasks, honouring
 * the three Bases-native view options (`domain/feed-view-options.ts`)
 * registered in `views/bases/register.ts`. Row layout stays thin — pure
 * domain code decides buckets/anchors, this file only renders and dispatches.
 */
export class FeedBasesView extends BasesView {
	override type = VIEW_TYPE_FEED;

	private readonly viewContainerEl: HTMLElement;
	private readonly deps: FeedBasesViewDeps;
	/**
	 * Owns the DOM listeners of the current render. Rows are rebuilt on every
	 * `onDataUpdated`, so registering their listeners on the view itself would
	 * accumulate cleanup closures (and the detached rows they close over) for
	 * the view's whole lifetime. Swapping a child component per render frees
	 * the previous render's listeners instead.
	 */
	private rows: Component = new Component();

	constructor(controller: QueryController, containerEl: HTMLElement, deps: FeedBasesViewDeps) {
		super(controller);
		this.viewContainerEl = containerEl;
		this.deps = deps;
		this.viewContainerEl.addClass(cssClass("feed"));

		refreshAfterMetadataResolved(this, this.deps.app);
	}

	override onDataUpdated(): void {
		this.removeChild(this.rows);
		this.rows = this.addChild(new Component());
		this.viewContainerEl.empty();

		const keys = this.deps.getPropertyKeys();
		const statuses = this.deps.getStatuses();
		const today = fromJsDate(new Date());
		const firstDay = this.deps.getWeekStart();
		const options = parseFeedViewOptions(this.config);

		for (const group of this.data.groupedData) {
			if (group.hasKey() && group.key !== undefined) {
				this.viewContainerEl.createEl("h3", { text: group.key.toString(), cls: cssClass("feed__group") });
			}

			const { tasks, invalid } = tasksFromBasesEntries(this.deps.app, group.entries, keys, statuses);
			const buckets = groupIntoBuckets(tasks, {
				today,
				firstDay,
				source: options.dateSource,
				statuses,
				completedAtBottom: options.completedAtBottom,
				order: this.config.getSort().length === 0 ? "smart" : "preserve",
			});

			for (const bucket of BUCKET_ORDER) {
				const bucketTasks = buckets.get(bucket) ?? [];
				if (bucketTasks.length === 0 && !options.showEmptyBuckets) {
					continue;
				}

				this.viewContainerEl.createEl("h4", { text: BUCKET_LABELS[bucket], cls: cssClass("feed__bucket") });

				if (bucketTasks.length === 0) {
					this.viewContainerEl.createDiv({ text: "No tasks", cls: cssClass("feed__bucket-empty") });
					continue;
				}

				for (const task of bucketTasks) {
					this.renderRow(task, statuses, options.dateSource);
				}
			}

			for (const entry of invalid) {
				const row = this.viewContainerEl.createDiv({
					cls: [cssClass("feed__row"), cssClass("feed__row--invalid")],
				});
				row.createSpan({ text: entry.path, cls: cssClass("feed__title") });
				row.createSpan({ text: entry.errors.map((e) => describeTaskParseError(e)).join(", "), cls: cssClass("feed__error") });
			}
		}
	}

	private renderRow(task: Task, statuses: readonly StatusConfig[], dateSource: DateSource): void {
		const row = this.viewContainerEl.createDiv({ cls: cssClass("feed__row") });

		this.renderStatusControl(row, task, statuses);

		const link = row.createEl("a", {
			text: task.title,
			cls: ["internal-link", cssClass("feed__title")],
			href: task.path,
		});
		this.rows.registerDomEvent(link, "click", (evt) => {
			evt.preventDefault();
			void this.deps.app.workspace.openLinkText(task.path, "", false);
		});

		this.renderDateChip(row, task, dateSource);
		this.renderPriorityControl(row, task);
		this.renderProjectLink(row, task);
		this.renderTags(row, task);

		this.registerRowContextMenu(row, task, statuses);
	}

	/**
	 * Date chip: the field the configured date source resolved to
	 * (`due`/`scheduled`), plus its value — see `domain/feed-row.ts#feedRowAnchor`.
	 * A button-like span (same click/Enter/Space pattern as the status
	 * control) that opens `DateModal` pre-filled with the row's anchor
	 * field/value, dispatching `setDate` on save. When the task has no
	 * anchor date yet, renders a muted "Set date" chip that still opens the
	 * modal, targeting `feedRowDefaultDateField(dateSource)`.
	 */
	private renderDateChip(row: HTMLElement, task: Task, dateSource: DateSource): void {
		const anchor = feedRowAnchor(task, dateSource);
		const field = anchor.some ? anchor.value.field : feedRowDefaultDateField(dateSource);
		const initial: Option<TaskDate> = anchor.some ? some(anchor.value.value) : none();

		const chip = row.createSpan({
			cls: [cssClass("feed__date"), "clickable-icon"],
			attr: { role: "button", tabindex: "0" },
		});
		chip.setText(anchor.some ? `${DATE_FIELD_LABELS[anchor.value.field]}: ${anchor.value.value}` : "Set date");
		if (!anchor.some) {
			chip.addClass(cssClass("feed__date--empty"));
		}

		const openModal = (): void => {
			new DateModal(this.deps.app, {
				title: field === "due" ? "Set due date" : "Set scheduled date",
				initial,
				onSave: (value) => {
					void this.setDate(task.path, field, value);
				},
			}).open();
		};

		this.rows.registerDomEvent(chip, "click", openModal);
		this.rows.registerDomEvent(chip, "keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				openModal();
			}
		});
	}

	/**
	 * Priority control: base layout class plus one `obtask-priority-<value>`
	 * class per `domain/task.ts#priorityChipClass` (mapped to a theme colour
	 * in `styles/obtask.css`), same clickable-icon/button-like pattern as the
	 * status control — opens `buildPriorityMenu` on click/Enter/Space and
	 * dispatches to `setPriority`.
	 */
	private renderPriorityControl(row: HTMLElement, task: Task): void {
		const control = row.createSpan({
			cls: [cssClass("feed__priority"), cssClass(priorityChipClass(task.priority)), "clickable-icon"],
			attr: { role: "button", tabindex: "0" },
		});

		setIcon(control.createSpan({ cls: cssClass("feed__priority-icon") }), priorityIcon(task.priority));
		control.createSpan({ text: priorityLabel(task.priority), cls: cssClass("feed__priority-label") });

		const openMenu = (evt: MouseEvent | KeyboardEvent): void => {
			const menu = newMenu();
			buildPriorityMenu(menu, task.priority, (priority) => {
				void this.setPriority(task.path, priority);
			});
			if (evt instanceof MouseEvent) {
				menu.showAtMouseEvent(evt);
			} else {
				const rect = control.getBoundingClientRect();
				menu.showAtPosition({ x: rect.left, y: rect.bottom });
			}
		};

		this.rows.registerDomEvent(control, "click", openMenu);
		this.rows.registerDomEvent(control, "keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				openMenu(evt);
			}
		});
	}

	/** Internal link to the project note, if `task.project` resolves to an existing file — same open pattern as the title link. Unresolved projects render as plain text (no dead-link click). */
	private renderProjectLink(row: HTMLElement, task: Task): void {
		const project = task.project;
		if (project === undefined) {
			return;
		}

		const dest = this.deps.app.metadataCache.getFirstLinkpathDest(project, task.path);
		if (dest === null) {
			row.createSpan({ text: project, cls: cssClass("feed__project") });
			return;
		}

		const link = row.createEl("a", {
			text: project,
			cls: ["internal-link", cssClass("feed__project")],
			href: project,
		});
		this.rows.registerDomEvent(link, "click", (evt) => {
			evt.preventDefault();
			void this.deps.app.workspace.openLinkText(project, task.path, false);
		});
	}

	private renderTags(row: HTMLElement, task: Task): void {
		if (task.tags.length === 0) {
			return;
		}
		const container = row.createSpan({ cls: cssClass("feed__tags") });
		for (const tag of task.tags) {
			container.createSpan({ text: `#${tag}`, cls: cssClass("feed__tag") });
		}
	}

	/** Button-like span (icon + label) that opens the status `Menu` on click/Enter/Space and dispatches to `setStatus`. */
	private renderStatusControl(row: HTMLElement, task: Task, statuses: readonly StatusConfig[]): void {
		const statusOption = findStatus(statuses, task.status);
		const control = row.createSpan({
			cls: [cssClass("feed__status"), "clickable-icon"],
			attr: { role: "button", tabindex: "0" },
		});

		setIcon(control.createSpan({ cls: cssClass("feed__status-icon") }), statusOption.some ? statusIcon(statusOption.value) : "circle");
		control.createSpan({
			text: statusOption.some ? statusOption.value.label : task.status,
			cls: cssClass("feed__status-label"),
		});

		const openMenu = (evt: MouseEvent | KeyboardEvent): void => {
			const menu = newMenu();
			buildStatusMenu(menu, statuses, task.status, (status) => {
				void this.setStatus(task.path, status.id);
			});
			if (evt instanceof MouseEvent) {
				menu.showAtMouseEvent(evt);
			} else {
				const rect = control.getBoundingClientRect();
				menu.showAtPosition({ x: rect.left, y: rect.bottom });
			}
		};

		this.rows.registerDomEvent(control, "click", openMenu);
		this.rows.registerDomEvent(control, "keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				openMenu(evt);
			}
		});
	}

	/**
	 * Opens `buildTaskEditMenu` (every editable property, `ui/task-edit-menu.ts`)
	 * at the pointer on right-click, and on a ~500ms touch-and-hold for
	 * mobile — Obsidian exposes no built-in long-press helper, so this times
	 * `touchstart`..`touchend`/`touchmove`/`touchcancel` itself via
	 * `window.setTimeout`, cleared on any of those or (as a safety net) when
	 * `this.rows` unloads.
	 */
	private registerRowContextMenu(row: HTMLElement, task: Task, statuses: readonly StatusConfig[]): void {
		const openEditMenu = (position: { readonly clientX: number; readonly clientY: number }): void => {
			const menu = newMenu();
			buildTaskEditMenu(menu, task, {
				app: this.deps.app,
				statuses,
				setStatus: this.deps.setStatus,
				setPriority: this.deps.setPriority,
				setDate: this.deps.setDate,
				setDuration: this.deps.setDuration,
				setRecurrence: this.deps.setRecurrence,
				setProject: this.deps.setProject,
				setTags: this.deps.setTags,
				notifier: this.deps.notifier,
			});
			menu.showAtPosition({ x: position.clientX, y: position.clientY });
		};

		// Android WebView fires both our touch-and-hold timer below AND a
		// native `contextmenu` event for the same long-press, which would
		// otherwise open the menu twice. `suppressNextContextMenu` lets the
		// timer claim the gesture so the following `contextmenu` event is
		// swallowed (still `preventDefault()`ed, so no native menu appears
		// on top) exactly once. Desktop right-click never sets the flag, so
		// its `contextmenu` event always opens the menu as before.
		let suppressNextContextMenu = false;

		this.rows.registerDomEvent(row, "contextmenu", (evt) => {
			evt.preventDefault();
			if (suppressNextContextMenu) {
				suppressNextContextMenu = false;
				return;
			}
			openEditMenu(evt);
		});

		let longPressTimer: number | undefined;
		const clearLongPress = (): void => {
			if (longPressTimer !== undefined) {
				window.clearTimeout(longPressTimer);
				longPressTimer = undefined;
			}
		};

		this.rows.registerDomEvent(row, "touchstart", (evt) => {
			const touch = evt.touches[0];
			if (touch === undefined) {
				return;
			}
			const { clientX, clientY } = touch;
			clearLongPress();
			longPressTimer = window.setTimeout(() => {
				suppressNextContextMenu = true;
				openEditMenu({ clientX, clientY });
			}, 500);
		});
		this.rows.registerDomEvent(row, "touchend", clearLongPress);
		this.rows.registerDomEvent(row, "touchmove", clearLongPress);
		this.rows.registerDomEvent(row, "touchcancel", clearLongPress);
		this.rows.register(clearLongPress);
	}

	private async setStatus(path: TaskPath, statusId: StatusId): Promise<void> {
		const result = await this.deps.setStatus(path, statusId);
		if (!result.ok) {
			this.deps.notifier.error(describeAppError(result.error));
		}
	}

	private async setPriority(path: TaskPath, priority: Priority): Promise<void> {
		const result = await this.deps.setPriority(path, priority);
		if (!result.ok) {
			this.deps.notifier.error(describeAppError(result.error));
		}
	}

	private async setDate(path: TaskPath, field: DateField, value: Option<TaskDate>): Promise<void> {
		const result = await this.deps.setDate(path, field, value);
		if (!result.ok) {
			this.deps.notifier.error(describeAppError(result.error));
		}
	}
}
