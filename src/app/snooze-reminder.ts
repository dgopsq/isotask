import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { IsoDateTime } from "@/domain/dates";
import { addMinutes, compareTaskDate } from "@/domain/dates";
import { canonicalRemindValue } from "@/domain/reminder-presets";
import type { ReminderSpec } from "@/domain/reminders";
import { defaultReminderSpecs, parseRemind } from "@/domain/reminders";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import { reminderDefaultsOf } from "@/domain/settings";
import { isOpenStatus } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

export type SnoozeReminderOutcome =
	| { readonly status: "snoozed"; readonly title: string; readonly until: IsoDateTime }
	| { readonly status: "already-done"; readonly title: string }
	| { readonly status: "invalid-remind"; readonly title: string };

/** Drops `none` and any absolute spec that's already past; every offset survives, since it may fire again after a later reschedule. */
function keptSpecs(base: readonly ReminderSpec[], now: IsoDateTime): readonly ReminderSpec[] {
	return base.filter((spec) => spec.kind === "offset" || (spec.kind === "absolute" && compareTaskDate(spec.at, now) > 0));
}

export function makeSnoozeReminder(deps: AppDeps) {
	return async (path: TaskPath, minutes: number): Promise<Result<SnoozeReminderOutcome, AppError>> => {
		const taskResult = await deps.store.read(path);
		if (!taskResult.ok) {
			return err(storeError(taskResult.error));
		}
		const task = taskResult.value;
		const settings = deps.settings();

		if (!isOpenStatus(settings.statuses, task.status)) {
			return ok({ status: "already-done", title: task.title });
		}

		const key = settings.propertyKeys.remind;
		const rawResult = await deps.store.rawFrontmatter(path);
		if (!rawResult.ok) {
			return err(storeError(rawResult.error));
		}
		// task.remind is undefined both when the property is absent and when it fails to parse;
		// re-parse the raw value so a typo'd list isn't silently overwritten with the default.
		if (!parseRemind(rawResult.value[key]).ok) {
			return ok({ status: "invalid-remind", title: task.title });
		}

		const now = deps.clock.now();
		const until = addMinutes(now, minutes) as IsoDateTime;

		const base = task.remind ?? defaultReminderSpecs(reminderDefaultsOf(settings.reminders));
		const specs: readonly ReminderSpec[] = [...keptSpecs(base, now), { kind: "absolute", at: until }];

		const result = await deps.store.updateProperties(path, { [key]: canonicalRemindValue(specs) });
		if (!result.ok) {
			return err(storeError(result.error));
		}

		return ok({ status: "snoozed", title: task.title, until });
	};
}

export type SnoozeReminder = ReturnType<typeof makeSnoozeReminder>;
