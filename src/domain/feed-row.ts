import type { DateSource } from "@/domain/buckets";
import type { TaskDate } from "@/domain/dates";
import { compareTaskDate } from "@/domain/dates";
import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";
import type { Task } from "@/domain/task";

/** Which frontmatter property supplied a feed row's anchor date, and its value. */
export interface FeedRowAnchor {
	readonly field: "due" | "scheduled";
	readonly value: TaskDate;
}

/**
 * Resolves the feed row's anchor date for the configured date source, same
 * due/scheduled/earliest precedence as `buckets.ts#taskAnchorDate` (earliest
 * tie -> due) — but also reports which property won, so a row's date-chip
 * click knows which field to edit.
 */
export function feedRowAnchor(task: Task, source: DateSource): Option<FeedRowAnchor> {
	switch (source) {
		case "due":
			return task.due === undefined ? none() : some({ field: "due", value: task.due });
		case "scheduled":
			return task.scheduled === undefined ? none() : some({ field: "scheduled", value: task.scheduled });
		case "earliest": {
			if (task.due !== undefined && task.scheduled !== undefined) {
				return compareTaskDate(task.due, task.scheduled) <= 0
					? some({ field: "due", value: task.due })
					: some({ field: "scheduled", value: task.scheduled });
			}
			if (task.due !== undefined) {
				return some({ field: "due", value: task.due });
			}
			if (task.scheduled !== undefined) {
				return some({ field: "scheduled", value: task.scheduled });
			}
			return none();
		}
		default: {
			const exhaustive: never = source;
			return exhaustive;
		}
	}
}
