import type { App, QueryController } from "obsidian";
import { BasesView } from "obsidian";

import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import { BUCKET_ORDER, groupIntoBuckets } from "@/domain/buckets";
import type { Bucket } from "@/domain/buckets";
import { fromJsDate } from "@/domain/dates";
import type { Weekday } from "@/domain/dates";
import type { PropertyKeys } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import { findStatus } from "@/domain/status";
import type { Task } from "@/domain/task";

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
}

/**
 * Minimal M0 feed view: proves the Bases view API end to end. Renders
 * bucket headers and plain rows (title link, status text, date) from parsed
 * tasks. No row actions/menus yet — that's M2.
 */
export class FeedBasesView extends BasesView {
	override type = "obtask-feed";

	private readonly viewContainerEl: HTMLElement;
	private readonly deps: FeedBasesViewDeps;

	constructor(controller: QueryController, containerEl: HTMLElement, deps: FeedBasesViewDeps) {
		super(controller);
		this.viewContainerEl = containerEl;
		this.deps = deps;
		this.viewContainerEl.addClass("obtask-feed");
	}

	override onDataUpdated(): void {
		this.viewContainerEl.empty();

		const keys = this.deps.getPropertyKeys();
		const statuses = this.deps.getStatuses();
		const today = fromJsDate(new Date());
		const firstDay = this.deps.getWeekStart();

		for (const group of this.data.groupedData) {
			if (group.hasKey() && group.key !== undefined) {
				this.viewContainerEl.createEl("h3", { text: group.key.toString(), cls: "obtask-feed__group" });
			}

			const { tasks, invalid } = tasksFromBasesEntries(this.deps.app, group.entries, keys, statuses);
			const buckets = groupIntoBuckets(tasks, { today, firstDay, source: "due" });

			for (const bucket of BUCKET_ORDER) {
				const bucketTasks = buckets.get(bucket) ?? [];
				if (bucketTasks.length === 0) {
					continue;
				}
				this.viewContainerEl.createEl("h4", { text: BUCKET_LABELS[bucket], cls: "obtask-feed__bucket" });
				for (const task of bucketTasks) {
					this.renderRow(task, statuses);
				}
			}

			for (const entry of invalid) {
				const row = this.viewContainerEl.createDiv({ cls: "obtask-feed__row obtask-feed__row--invalid" });
				row.createSpan({ text: entry.path, cls: "obtask-feed__title" });
				row.createSpan({ text: entry.errors.map((e) => e.kind).join(", "), cls: "obtask-feed__error" });
			}
		}
	}

	private renderRow(task: Task, statuses: readonly StatusConfig[]): void {
		const row = this.viewContainerEl.createDiv({ cls: "obtask-feed__row" });

		const link = row.createEl("a", {
			text: task.title,
			cls: ["internal-link", "obtask-feed__title"],
			href: task.path,
		});
		this.registerDomEvent(link, "click", (evt) => {
			evt.preventDefault();
			void this.deps.app.workspace.openLinkText(task.path, "", false);
		});

		const statusOption = findStatus(statuses, task.status);
		row.createSpan({
			text: statusOption.some ? statusOption.value.label : task.status,
			cls: "obtask-feed__status",
		});

		const dateText = task.due ?? task.scheduled ?? "";
		if (dateText.length > 0) {
			row.createSpan({ text: dateText, cls: "obtask-feed__date" });
		}
	}
}
