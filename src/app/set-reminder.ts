import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import { canonicalRemindValue } from "@/domain/reminder-presets";
import type { ReminderSpec } from "@/domain/reminders";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { TaskPath } from "@/domain/task";

/** Sets or clears (`undefined`/`[]`) a task's `remind` list; any `none` spec collapses the write to `["none"]`. */
export function makeSetReminder(deps: AppDeps) {
	return async (path: TaskPath, specs: readonly ReminderSpec[] | undefined): Promise<Result<void, AppError>> => {
		// Reject a non-task note up front: a stray `remind` there is invisible until the linter runs.
		const readResult = await deps.store.read(path);
		if (!readResult.ok) {
			return err(storeError(readResult.error));
		}

		const key = deps.settings().propertyKeys.remind;

		if (specs === undefined || specs.length === 0) {
			const result = await deps.store.updateProperties(path, { [key]: null });
			return result.ok ? ok(undefined) : err(storeError(result.error));
		}

		const result = await deps.store.updateProperties(path, { [key]: canonicalRemindValue(specs) });
		return result.ok ? ok(undefined) : err(storeError(result.error));
	};
}

export type SetReminder = ReturnType<typeof makeSetReminder>;
