import { findStatus, isTerminal } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";
import type { Task } from "@/domain/task";

/** "complete"/"reopen": `completed` needs to catch up with `status`; "none": already consistent. */
export type CompletionDrift = "complete" | "reopen" | "none";

/**
 * Detects whether `completed` has drifted from `status` (an edit outside `app/set-status.ts`).
 * An unresolved status is treated as consistent, not drift.
 */
export function completionDrift(task: Task, statuses: readonly StatusConfig[]): CompletionDrift {
	const status = findStatus(statuses, task.status);
	if (!status.some) {
		return "none";
	}

	const hasCompleted = task.completed !== undefined;
	if (isTerminal(status.value.kind) && !hasCompleted) {
		return "complete";
	}
	if (!isTerminal(status.value.kind) && hasCompleted) {
		return "reopen";
	}
	return "none";
}
