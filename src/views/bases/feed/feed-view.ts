import type { App, QueryController } from "obsidian";
import { BasesView, Menu, setIcon } from "obsidian";

import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import type { makeSetStatus } from "@/app/set-status";
import { describeAppError } from "@/app/errors";
import { BUCKET_ORDER, groupIntoBuckets } from "@/domain/buckets";
import type { Bucket } from "@/domain/buckets";
import { fromJsDate } from "@/domain/dates";
import type { Weekday } from "@/domain/dates";
import type { PropertyKeys } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import { findStatus } from "@/domain/status";
import type { StatusId, Task, TaskPath } from "@/domain/task";
import { cssClass, VIEW_TYPE_FEED } from "@/plugin-id";
import type { Notifier } from "@/ports/notifier";
import { buildStatusMenu, statusIcon } from "@/ui/status-menu";

const BUCKET_LABELS: Readonly<Record<Bucket, string>> = {
	overdue: "Overdue",
	today: "Today",
	"this-week": "This week",
	"next-week": "Next week",
	later: "Later",
	"no-date": "No date",
};

export interface FeedBasesViewDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getWeekStart: () => Weekday;
	readonly setStatus: ReturnType<typeof makeSetStatus>;
	readonly notifier: Notifier;
}

/**
 * M0/M1 feed view: renders bucket headers and rows (title link, a clickable
 * status control, date) from parsed tasks. Full row layout (priority/project/
 * tags chips, feed view options) is M2.
 */
export class FeedBasesView extends BasesView {
	override type = VIEW_TYPE_FEED;

	private readonly viewContainerEl: HTMLElement;
	private readonly deps: FeedBasesViewDeps;

	constructor(controller: QueryController, containerEl: HTMLElement, deps: FeedBasesViewDeps) {
		super(controller);
		this.viewContainerEl = containerEl;
		this.deps = deps;
		this.viewContainerEl.addClass(cssClass("feed"));
	}

	override onDataUpdated(): void {
		this.viewContainerEl.empty();

		const keys = this.deps.getPropertyKeys();
		const statuses = this.deps.getStatuses();
		const today = fromJsDate(new Date());
		const firstDay = this.deps.getWeekStart();

		for (const group of this.data.groupedData) {
			if (group.hasKey() && group.key !== undefined) {
				this.viewContainerEl.createEl("h3", { text: group.key.toString(), cls: cssClass("feed__group") });
			}

			const { tasks, invalid } = tasksFromBasesEntries(this.deps.app, group.entries, keys, statuses);
			const buckets = groupIntoBuckets(tasks, { today, firstDay, source: "due" });

			for (const bucket of BUCKET_ORDER) {
				const bucketTasks = buckets.get(bucket) ?? [];
				if (bucketTasks.length === 0) {
					continue;
				}
				this.viewContainerEl.createEl("h4", { text: BUCKET_LABELS[bucket], cls: cssClass("feed__bucket") });
				for (const task of bucketTasks) {
					this.renderRow(task, statuses);
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

	private renderRow(task: Task, statuses: readonly StatusConfig[]): void {
		const row = this.viewContainerEl.createDiv({ cls: cssClass("feed__row") });

		const link = row.createEl("a", {
			text: task.title,
			cls: ["internal-link", cssClass("feed__title")],
			href: task.path,
		});
		this.registerDomEvent(link, "click", (evt) => {
			evt.preventDefault();
			void this.deps.app.workspace.openLinkText(task.path, "", false);
		});

		this.renderStatusControl(row, task, statuses);

		const dateText = task.due ?? task.scheduled ?? "";
		if (dateText.length > 0) {
			row.createSpan({ text: dateText, cls: cssClass("feed__date") });
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

		this.registerDomEvent(control, "click", openMenu);
		this.registerDomEvent(control, "keydown", (evt) => {
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
}
