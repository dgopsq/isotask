import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { FrontmatterPatch } from "@/domain/frontmatter";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { TaskPath } from "@/domain/task";

/** Sets a task's `tags`; an empty list clears the key entirely rather than writing an empty array. */
export function makeSetTags(deps: AppDeps) {
	return async (path: TaskPath, tags: readonly string[]): Promise<Result<void, AppError>> => {
		const key = deps.settings().propertyKeys.tags;
		const patch: FrontmatterPatch = { [key]: tags.length > 0 ? tags : null };

		const result = await deps.store.updateProperties(path, patch);
		return result.ok ? ok(undefined) : err(storeError(result.error));
	};
}

export type SetTags = ReturnType<typeof makeSetTags>;
