import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import { toWikilink } from "@/domain/frontmatter";
import type { FrontmatterPatch } from "@/domain/frontmatter";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { TaskPath } from "@/domain/task";

/** Sets or clears (`null`) a task's `project`, stored as a `[[wikilink]]` (`domain/frontmatter.ts#toWikilink`). */
export function makeSetProject(deps: AppDeps) {
	return async (path: TaskPath, project: string | null): Promise<Result<void, AppError>> => {
		const key = deps.settings().propertyKeys.project;
		const patch: FrontmatterPatch = { [key]: project === null ? null : toWikilink(project) };

		const result = await deps.store.updateProperties(path, patch);
		return result.ok ? ok(undefined) : err(storeError(result.error));
	};
}

export type SetProject = ReturnType<typeof makeSetProject>;
