import type { AppDeps } from "@/app/deps";
import { describeRecurrenceError, storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { FrontmatterPatch } from "@/domain/frontmatter";
import { parseRRule } from "@/domain/recurrence";
import type { Option, Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { TaskPath } from "@/domain/task";

/** Sets or clears (`none`) a task's `repeat` RRULE body, validating it via `domain/recurrence.ts#parseRRule` first. */
export function makeSetRecurrence(deps: AppDeps) {
	return async (path: TaskPath, rule: Option<string>): Promise<Result<void, AppError>> => {
		const key = deps.settings().propertyKeys.repeat;

		if (!rule.some) {
			const result = await deps.store.updateProperties(path, { [key]: null });
			return result.ok ? ok(undefined) : err(storeError(result.error));
		}

		const parsed = parseRRule(rule.value);
		if (!parsed.ok) {
			return err({ kind: "invalid-rrule", reason: describeRecurrenceError(parsed.error) });
		}

		const patch: FrontmatterPatch = { [key]: parsed.value };
		const result = await deps.store.updateProperties(path, patch);
		return result.ok ? ok(undefined) : err(storeError(result.error));
	};
}

export type SetRecurrence = ReturnType<typeof makeSetRecurrence>;
