import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { FrontmatterPatch } from "@/domain/frontmatter";
import type { Option, Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { Minutes, TaskPath } from "@/domain/task";

/** Sets or clears (`none`) a task's `duration`, in minutes. */
export function makeSetDuration(deps: AppDeps) {
	return async (path: TaskPath, value: Option<Minutes>): Promise<Result<void, AppError>> => {
		const key = deps.settings().propertyKeys.duration;
		const patch: FrontmatterPatch = { [key]: value.some ? value.value : null };

		const result = await deps.store.updateProperties(path, patch);
		return result.ok ? ok(undefined) : err(storeError(result.error));
	};
}

export type SetDuration = ReturnType<typeof makeSetDuration>;
