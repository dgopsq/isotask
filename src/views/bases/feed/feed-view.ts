import type { App, QueryController } from "obsidian";
import { BasesView, Component, Menu, setIcon } from "obsidian";

import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import type { DateField } from "@/app/set-date";
import type { makeSetDate } from "@/app/set-date";
import type { makeSetStatus } from "@/app/set-status";
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
import type { StatusId, Task, TaskPath } from "@/domain/task";
import { priorityChipClass } from "@/domain/task";
import { cssClass, VIEW_TYPE_FEED } from "@/plugin-id";
import type { Notifier } from "@/ports/notifier";
import { DateModal } from "@/ui/date-modal";
import { buildStatusMenu, statusIcon } from "@/ui/status-menu";

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

export interface FeedBasesViewDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getWeekStart: () => Weekday;
	readonly setStatus: ReturnType<typeof makeSetStatus>;
	readonly setDate: ReturnType<typeof makeSetDate>;
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
				row.createSpan({ text: entry.errors.map((e) => e.kind).join(", "), cls: cssClass("feed__error") });
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
		this.renderPriorityChip(row, task);
		this.renderProjectLink(row, task);
		this.renderTags(row, task);
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

	/** Priority chip: base layout class plus one `obtask-priority-<value>` class per `domain/task.ts#priorityChipClass`, mapped to a theme colour in `styles/obtask.css`. */
	private renderPriorityChip(row: HTMLElement, task: Task): void {
		const label = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
		row.createSpan({
			text: label,
			cls: [cssClass("feed__priority"), cssClass(priorityChipClass(task.priority))],
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
			const menu = new Menu();
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

	private async setStatus(path: TaskPath, statusId: StatusId): Promise<void> {
		const result = await this.deps.setStatus(path, statusId);
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
