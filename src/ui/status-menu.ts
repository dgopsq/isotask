import type { Menu } from "obsidian";

import type { StatusConfig } from "@/domain/status";
import { toggleStatus } from "@/domain/status";
import type { StatusId } from "@/domain/task";

/**
 * Adds a single toggle item to `menu`: "Mark as done" when `task`'s current
 * status isn't `done`-kind, "Reopen" when it is. Picks the target via
 * `domain/status.ts#toggleStatus`; adds nothing when there's no configured
 * target to toggle to (e.g. no `done`/`open` status configured). Shared by
 * the feed row's context menu and the file-menu "Obtask" section.
 */
export function addDoneMenuItem(
	menu: Menu,
	task: { readonly status: StatusId },
	statuses: readonly StatusConfig[],
	onPick: (status: StatusConfig) => void,
): void {
	const next = toggleStatus(statuses, task.status);
	if (!next.some) {
		return;
	}

	// The toggle target's kind is the opposite of the task's current state:
	// toggling *to* `open` means the task is currently done (reopening).
	const reopening = next.value.kind === "open";
	menu.addItem((item) => {
		item
			.setTitle(reopening ? "Reopen" : "Mark as done")
			.setIcon(reopening ? "circle" : "check-circle-2")
			.onClick(() => {
				onPick(next.value);
			});
	});
}
