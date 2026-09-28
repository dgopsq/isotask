import { bucketFor } from "@/domain/buckets";
import type { IsoDate, Weekday } from "@/domain/dates";
import type { StatusConfig } from "@/domain/status";
import { isOpenStatus } from "@/domain/status";
import type { Task } from "@/domain/task";

/** Open tasks in the feed's overdue or today bucket by `due`; `scheduled` doesn't count. */
export function countNeedingAttention(tasks: readonly Task[], statuses: readonly StatusConfig[], today: IsoDate, firstDay: Weekday): number {
	return tasks.filter((task) => {
		if (task.due === undefined || !isOpenStatus(statuses, task.status)) {
			return false;
		}
		const bucket = bucketFor(task.due, today, firstDay);
		return bucket === "overdue" || bucket === "today";
	}).length;
}
