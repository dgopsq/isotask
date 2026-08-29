import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { FrontmatterPatch } from "@/domain/frontmatter";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { Priority, TaskPath } from "@/domain/task";

/** Sets a task's `priority`. Unlike `due`/`scheduled`/`project`/`tags`, priority always has a value (missing parses as `"normal"`, `docs/DOMAIN-MODEL.md`), so there's no clearing variant. */
export function makeSetPriority(deps: AppDeps) {
	return async (path: TaskPath, priority: Priority): Promise<Result<void, AppError>> => {
		const key = deps.settings().propertyKeys.priority;
		const patch: FrontmatterPatch = { [key]: priority };

		const result = await deps.store.updateProperties(path, patch);
		return result.ok ? ok(undefined) : err(storeError(result.error));
	};
}

export type SetPriority = ReturnType<typeof makeSetPriority>;
