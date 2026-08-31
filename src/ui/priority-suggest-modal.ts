import type { App } from "obsidian";
import { FuzzySuggestModal } from "obsidian";

import { PRIORITIES, priorityLabel } from "@/domain/task";
import type { Priority } from "@/domain/task";

/** Fuzzy-picks one of the three priorities, e.g. for a "Set priority…" command. Same shape as `StatusSuggestModal`. */
export class PrioritySuggestModal extends FuzzySuggestModal<Priority> {
	private readonly onPick: (priority: Priority) => void;

	constructor(app: App, onPick: (priority: Priority) => void) {
		super(app);
		this.onPick = onPick;
		this.setPlaceholder("Set priority…");
	}

	override getItems(): Priority[] {
		return [...PRIORITIES];
	}

	override getItemText(item: Priority): string {
		return priorityLabel(item);
	}

	override onChooseItem(item: Priority): void {
		this.onPick(item);
	}
}
