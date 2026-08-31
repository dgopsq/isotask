import type { Minutes } from "@/domain/task";

/**
 * Human-readable rendering of a task's `duration`, e.g. `90` -> `"1h 30m"`,
 * `60` -> `"1h"`, `45` -> `"45m"`. Shared by any surface that shows a task's
 * duration as text rather than a raw minute count (currently the sidebar
 * task panel, `views/task-panel/task-panel-view.ts`). Negative input is
 * clamped to zero — `duration` is validated non-negative on parse
 * (`domain/frontmatter.ts`), so this only guards against a stale/unparsed
 * value ever reaching here.
 */
export function formatDurationMinutes(minutes: Minutes): string {
	const total = Math.max(0, Math.round(minutes));
	const hours = String(Math.floor(total / 60));
	const remainder = String(total % 60);

	if (hours === "0") {
		return `${remainder}m`;
	}
	if (remainder === "0") {
		return `${hours}h`;
	}
	return `${hours}h ${remainder}m`;
}
