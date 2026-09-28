import { countNeedingAttention } from "@/domain/attention";
import type { IsotaskSettings } from "@/domain/settings";
import type { AppBadge } from "@/ports/app-badge";
import type { Clock } from "@/ports/clock";
import type { TaskStore } from "@/ports/task-store";

export interface RefreshAppBadgeDeps {
	readonly store: TaskStore;
	readonly clock: Clock;
	readonly badge: AppBadge;
	readonly settings: () => IsotaskSettings;
}

/** Sets the icon badge to the overdue-or-due-today count, or clears it when the setting is off. */
export function makeRefreshAppBadge(deps: RefreshAppBadgeDeps): () => Promise<void> {
	return async () => {
		if (!deps.badge.isAvailable()) {
			return;
		}
		const settings = deps.settings();
		if (!settings.reminders.appBadge) {
			deps.badge.clear();
			return;
		}
		const tasks = await deps.store.list();
		deps.badge.set(countNeedingAttention(tasks, settings.statuses, deps.clock.today()));
	};
}

export type RefreshAppBadge = ReturnType<typeof makeRefreshAppBadge>;
