import type { IsotaskSettings } from "@/domain/settings";
import type { Clock } from "@/ports/clock";
import type { Notifier } from "@/ports/notifier";
import type { RescheduleHistory } from "@/ports/reschedule-history";
import type { TaskStore } from "@/ports/task-store";

/**
 * Ports every `app` use-case is built over, plus a settings accessor
 * (rather than a static settings object) so a use-case always reads the
 * current settings, even across a settings-tab edit mid-session.
 */
export interface AppDeps {
	readonly store: TaskStore;
	readonly clock: Clock;
	readonly notifier: Notifier;
	readonly history: RescheduleHistory;
	readonly settings: () => IsotaskSettings;
}
