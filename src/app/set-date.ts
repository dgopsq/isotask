import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { TaskDate } from "@/domain/dates";
import type { FrontmatterPatch } from "@/domain/frontmatter";
import type { Option, Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { TaskPath } from "@/domain/task";

export type DateField = "due" | "scheduled";

/** Sets or clears (`none`) a task's `due` or `scheduled` date. */
export function makeSetDate(deps: AppDeps) {
	return async (path: TaskPath, field: DateField, value: Option<TaskDate>): Promise<Result<void, AppError>> => {
		const keys = deps.settings().propertyKeys;
		const key = field === "due" ? keys.due : keys.scheduled;
		const patch: FrontmatterPatch = { [key]: value.some ? value.value : null };

		const result = await deps.store.updateProperties(path, patch);
		return result.ok ? ok(undefined) : err(storeError(result.error));
	};
}

export type SetDate = ReturnType<typeof makeSetDate>;
