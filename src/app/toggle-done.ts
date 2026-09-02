import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { SetStatusOutcome } from "@/app/set-status";
import { makeSetStatus } from "@/app/set-status";
import type { Result } from "@/domain/result";
import { err } from "@/domain/result";
import { toggleStatus } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

/**
 * Toggles a task between done and open, via `setStatus`: a `done`-kind
 * status reopens to the first configured `open` status; any other status
 * (open, or an unknown id) advances to the first configured `done` status.
 * See `domain/status.ts#toggleStatus`.
 */
export function makeToggleDone(deps: AppDeps) {
	const setStatus = makeSetStatus(deps);

	return async (path: TaskPath): Promise<Result<SetStatusOutcome, AppError>> => {
		const taskResult = await deps.store.read(path);
		if (!taskResult.ok) {
			return err(storeError(taskResult.error));
		}

		const next = toggleStatus(deps.settings().statuses, taskResult.value.status);
		if (!next.some) {
			return err({ kind: "no-status-configured" });
		}

		return setStatus(path, next.value.id);
	};
}

export type ToggleDone = ReturnType<typeof makeToggleDone>;
