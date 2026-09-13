import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import { makeWriteStatusTransition } from "@/app/set-status";
import { completionDrift } from "@/domain/completion-drift";
import type { FrontmatterPatch } from "@/domain/frontmatter";
import type { Option, Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import { findStatus } from "@/domain/status";
import type { TaskPath } from "@/domain/task";
import type { TaskStoreError } from "@/ports/task-store";

export type ReconcileOutcome =
	| { readonly kind: "none" }
	| { readonly kind: "completed"; readonly spawned: Option<TaskPath> }
	| { readonly kind: "reopened" };

/** A parse error is not this use-case's problem to report — the feed's Errors group already surfaces it. */
function isParseError(error: TaskStoreError): boolean {
	return error.kind === "invalid-task";
}

/**
 * Reconciles `completed` with `status` for one task note, per
 * `docs/adr/0018-reconcile-completed-with-status.md`: called from
 * `adapters/obsidian/completion-watcher.ts` on every `metadataCache`
 * `changed` event, so an external edit (Properties view, another app, a
 * script) gets the same `completed`/spawn handling as the plugin's own
 * `app/set-status.ts`.
 */
export function makeReconcileCompletion(deps: AppDeps) {
	const writeStatusTransition = makeWriteStatusTransition(deps);

	return async (path: TaskPath): Promise<Result<ReconcileOutcome, AppError>> => {
		const taskResult = await deps.store.read(path);
		if (!taskResult.ok) {
			return isParseError(taskResult.error) ? ok({ kind: "none" }) : err(storeError(taskResult.error));
		}
		const task = taskResult.value;

		const settings = deps.settings();
		const drift = completionDrift(task, settings.statuses);

		if (drift === "none") {
			return ok({ kind: "none" });
		}

		if (drift === "reopen") {
			const patch: FrontmatterPatch = { [settings.propertyKeys.completed]: null };
			const updateResult = await deps.store.updateProperties(path, patch);
			if (!updateResult.ok) {
				return err(storeError(updateResult.error));
			}
			return ok({ kind: "reopened" });
		}

		// drift === "complete": the task is already at its (done) target status,
		// so force the same-status short-circuit off to get the completed patch + spawn plan.
		const toStatus = findStatus(settings.statuses, task.status);
		if (!toStatus.some) {
			return ok({ kind: "none" });
		}

		const rawResult = await deps.store.rawFrontmatter(path);
		if (!rawResult.ok) {
			return isParseError(rawResult.error) ? ok({ kind: "none" }) : err(storeError(rawResult.error));
		}

		const writeResult = await writeStatusTransition({
			path,
			task,
			raw: rawResult.value,
			to: toStatus.value,
			force: true,
		});
		if (!writeResult.ok) {
			return err(writeResult.error);
		}
		return ok({ kind: "completed", spawned: writeResult.value.spawned });
	};
}

export type ReconcileCompletion = ReturnType<typeof makeReconcileCompletion>;
