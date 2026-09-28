import { compareTaskDate, toDateOnly } from "@/domain/dates";
import type { IsoDate } from "@/domain/dates";
import type { StatusConfig } from "@/domain/status";
import { isOpenStatus } from "@/domain/status";
import type { Task } from "@/domain/task";

/** Open tasks due today or earlier (overdue + due today); `scheduled` doesn't count. */
export function countNeedingAttention(tasks: readonly Task[], statuses: readonly StatusConfig[], today: IsoDate): number {
	return tasks.filter((task) => task.due !== undefined && compareTaskDate(toDateOnly(task.due), today) <= 0 && isOpenStatus(statuses, task.status)).length;
}
