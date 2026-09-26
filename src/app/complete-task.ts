import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import { makeWriteStatusTransition } from "@/app/set-status";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import { firstDoneStatus, isOpenStatus } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

export interface CompleteTaskOutcome {
	readonly title: string;
	readonly alreadyDone: boolean;
}

/**
 * Idempotent "mark done" for the reminder push's Done action: a task that's
 * already closed is a no-op (never reopened), so tapping the action twice
 * is safe. Goes through the same status-transition path as `set-status.ts`/
 * `toggle-done.ts`, so recurrence spawning and the `completed` stamp behave
 * identically.
 */
export function makeCompleteTask(deps: AppDeps) {
	const writeStatusTransition = makeWriteStatusTransition(deps);

	return async (path: TaskPath): Promise<Result<CompleteTaskOutcome, AppError>> => {
		const taskResult = await deps.store.read(path);
		if (!taskResult.ok) {
			return err(storeError(taskResult.error));
		}
		const task = taskResult.value;
		const settings = deps.settings();

		if (!isOpenStatus(settings.statuses, task.status)) {
			return ok({ title: task.title, alreadyDone: true });
		}

		const toStatus = firstDoneStatus(settings.statuses);
		if (!toStatus.some) {
			return err({ kind: "no-status-configured" });
		}

		const rawResult = await deps.store.rawFrontmatter(path);
		if (!rawResult.ok) {
			return err(storeError(rawResult.error));
		}

		const transitionResult = await writeStatusTransition({ path, task, raw: rawResult.value, to: toStatus.value });
		if (!transitionResult.ok) {
			return err(transitionResult.error);
		}

		return ok({ title: task.title, alreadyDone: false });
	};
}

export type CompleteTask = ReturnType<typeof makeCompleteTask>;
