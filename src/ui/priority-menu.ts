import type { Menu } from "obsidian";

import type { Priority } from "@/domain/task";
import { PRIORITIES, priorityLabel } from "@/domain/task";

/** Icon per `Priority`, used by both the feed row's priority control and the menu items below. */
const PRIORITY_ICON: Readonly<Record<Priority, string>> = {
	normal: "minus",
	high: "arrow-up",
	urgent: "flame",
};

export function priorityIcon(priority: Priority): string {
	return PRIORITY_ICON[priority];
}

/** Adds one menu item per `Priority` to `menu`, checking the current one. Shared by the feed row priority control and `ui/task-edit-menu.ts`. */
export function buildPriorityMenu(menu: Menu, current: Priority, onPick: (priority: Priority) => void): void {
	for (const priority of PRIORITIES) {
		menu.addItem((item) => {
			item
				.setTitle(priorityLabel(priority))
				.setIcon(priorityIcon(priority))
				.setChecked(priority === current)
				.onClick(() => {
					onPick(priority);
				});
		});
	}
}
