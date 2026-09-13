import { findStatus, isTerminal } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";
import type { Task } from "@/domain/task";

/**
 * `"complete"`/`"reopen"` mean `completed` needs to catch up with `status`
 * (an edit outside the plugin's own set-status path); `"none"` means the
 * two are already consistent.
 */
export type CompletionDrift = "complete" | "reopen" | "none";

/**
 * Detects whether a task's `completed` frontmatter has drifted from its
 * `status` — the signature of an edit made directly in frontmatter (not
 * through `app/set-status.ts`), per `docs/adr/0018-reconcile-completed-with-status.md`.
 * A status that fails to resolve (e.g. the status list changed since the
 * task was parsed) is treated as consistent, not as drift.
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
