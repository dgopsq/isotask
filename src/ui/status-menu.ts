import type { Menu } from "obsidian";

import type { StatusConfig, StatusKind } from "@/domain/status";
import type { StatusId } from "@/domain/task";

/** Icon used for a status that doesn't configure its own (`docs/DOMAIN-MODEL.md#statuses`' default kinds). */
const DEFAULT_ICON_BY_KIND: Readonly<Record<StatusKind, string>> = {
	open: "circle",
	active: "circle-dot",
	done: "check-circle-2",
	cancelled: "x-circle",
};

/** The icon to render for a status: its own configured icon, falling back to a default for its kind. */
export function statusIcon(status: StatusConfig): string {
	return status.icon ?? DEFAULT_ICON_BY_KIND[status.kind];
}

/** Adds one menu item per configured status to `menu`, checking the current one. Shared by the feed row status control and the file-menu "Set status" entries. */
export function buildStatusMenu(
	menu: Menu,
	statuses: readonly StatusConfig[],
	current: StatusId,
	onPick: (status: StatusConfig) => void,
): void {
	for (const status of statuses) {
		menu.addItem((item) => {
			item
				.setTitle(status.label)
				.setIcon(statusIcon(status))
				.setChecked(status.id === current)
				.onClick(() => {
					onPick(status);
				});
		});
	}
}
