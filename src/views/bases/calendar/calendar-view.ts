import type { App, QueryController } from "obsidian";
import { BasesView } from "obsidian";

import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import type { PropertyKeys } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";

export interface CalendarBasesViewDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
}

/**
 * Placeholder M0 calendar view: proves the Bases view API is wired up.
 * Real rendering (`CalendarRenderer` / Event Calendar adapter) lands in M3 —
 * see `src/adapters/calendar/README.md`.
 */
export class CalendarBasesView extends BasesView {
	override type = "obtask-calendar";

	private readonly viewContainerEl: HTMLElement;
	private readonly deps: CalendarBasesViewDeps;

	constructor(controller: QueryController, containerEl: HTMLElement, deps: CalendarBasesViewDeps) {
		super(controller);
		this.viewContainerEl = containerEl;
		this.deps = deps;
	}

	override onDataUpdated(): void {
		this.viewContainerEl.empty();
		const wrapper = this.viewContainerEl.createDiv({ cls: "obtask-calendar" });

		const keys = this.deps.getPropertyKeys();
		const statuses = this.deps.getStatuses();
		const { tasks } = tasksFromBasesEntries(this.deps.app, this.data.data, keys, statuses);

		wrapper.createEl("p", { text: "Calendar view (coming soon)" });
		wrapper.createEl("p", { text: `${String(tasks.length)} task(s) in view` });
	}
}
