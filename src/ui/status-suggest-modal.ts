import type { App } from "obsidian";
import { FuzzySuggestModal } from "obsidian";

import type { StatusConfig } from "@/domain/status";

/** Fuzzy-picks one of the configured statuses, e.g. for a "Set status…" command. */
export class StatusSuggestModal extends FuzzySuggestModal<StatusConfig> {
	private readonly statuses: readonly StatusConfig[];
	private readonly onPick: (status: StatusConfig) => void;

	constructor(app: App, statuses: readonly StatusConfig[], onPick: (status: StatusConfig) => void) {
		super(app);
		this.statuses = statuses;
		this.onPick = onPick;
		this.setPlaceholder("Set status…");
	}

	override getItems(): StatusConfig[] {
		return [...this.statuses];
	}

	override getItemText(item: StatusConfig): string {
		return item.label;
	}

	override onChooseItem(item: StatusConfig): void {
		this.onPick(item);
	}
}
