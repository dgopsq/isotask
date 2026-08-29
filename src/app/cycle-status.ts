import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { SetStatusOutcome } from "@/app/set-status";
import { makeSetStatus } from "@/app/set-status";
import type { Result } from "@/domain/result";
import { err } from "@/domain/result";
import { nextStatusInCycle } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

/** Advances a task to the next status in the configured order (array order, wrapping), via `setStatus`. */
export function makeCycleStatus(deps: AppDeps) {
	const setStatus = makeSetStatus(deps);

	return async (path: TaskPath): Promise<Result<SetStatusOutcome, AppError>> => {
		const taskResult = await deps.store.read(path);
		if (!taskResult.ok) {
			return err(storeError(taskResult.error));
		}

		const next = nextStatusInCycle(deps.settings().statuses, taskResult.value.status);
		if (!next.some) {
			return err({ kind: "no-status-configured" });
		}

		return setStatus(path, next.value.id);
	};
}

export type CycleStatus = ReturnType<typeof makeCycleStatus>;
