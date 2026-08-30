import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { DateField } from "@/app/set-date";
import { differenceInMinutes } from "@/domain/dates";
import type { TaskDate } from "@/domain/dates";
import type { FrontmatterPatch } from "@/domain/frontmatter";
import type { Option, Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { Minutes, TaskPath } from "@/domain/task";

/**
 * Moves or resizes a task's `due`/`scheduled` date from a single calendar
 * drag or resize gesture, writing exactly one `FrontmatterPatch` so the
 * gesture produces one `metadataCache` event and one Bases re-render — the
 * naive `setDate` followed by `setDuration` would instead fire two writes
 * (and two re-renders) for what the user experienced as one action.
 *
 * A `due` date has no span, so `end` is ignored entirely and `duration` is
 * never part of the patch for it. For `scheduled`, `end` distinguishes a
 * move (dragging the whole block, `end` is `none`) from a resize (dragging
 * an edge, `end` is `some`): only a resize writes `duration`. Leaving
 * `duration` out of the patch — rather than setting it to `null` — means a
 * block dragged into the all-day row (which drops `end`) keeps its stored
 * duration in frontmatter, so dragging it back out restores the same block
 * size, and a time estimate set via the "set duration" command is never
 * clobbered by an unrelated move.
 */
export function makeRescheduleTask(deps: AppDeps) {
	return async (path: TaskPath, field: DateField, start: TaskDate, end: Option<TaskDate>): Promise<Result<void, AppError>> => {
		const keys = deps.settings().propertyKeys;

		let patch: FrontmatterPatch;
		if (field === "due") {
			patch = { [keys.due]: start };
		} else {
			const minutes: Minutes | undefined = end.some ? (Math.max(1, differenceInMinutes(start, end.value)) as Minutes) : undefined;
			patch = { [keys.scheduled]: start, ...(minutes !== undefined ? { [keys.duration]: minutes } : {}) };
		}

		const result = await deps.store.updateProperties(path, patch);
		return result.ok ? ok(undefined) : err(storeError(result.error));
	};
}

export type RescheduleTask = ReturnType<typeof makeRescheduleTask>;
