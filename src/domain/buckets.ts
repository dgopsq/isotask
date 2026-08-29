import type { IsoDate, TaskDate, Weekday } from "@/domain/dates";
import { compareTaskDate, endOfWeek, shiftBy, toDateOnly } from "@/domain/dates";
import type { Option } from "@/domain/result";
import { fromNullable, none, some } from "@/domain/result";
import type { Task } from "@/domain/task";
import { priorityRank } from "@/domain/task";

export type Bucket = "overdue" | "today" | "this-week" | "next-week" | "later" | "no-date";

export const BUCKET_ORDER: readonly Bucket[] = ["overdue", "today", "this-week", "next-week", "later", "no-date"];

export type DateSource = "due" | "scheduled" | "earliest";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function taskAnchorDate(task: Task, source: DateSource): Option<TaskDate> {
	switch (source) {
		case "due":
			return fromNullable(task.due);
		case "scheduled":
			return fromNullable(task.scheduled);
		case "earliest": {
			if (task.due !== undefined && task.scheduled !== undefined) {
				return some(compareTaskDate(task.due, task.scheduled) <= 0 ? task.due : task.scheduled);
			}
			if (task.due !== undefined) {
				return some(task.due);
			}
			if (task.scheduled !== undefined) {
				return some(task.scheduled);
			}
			return none();
		}
		default: {
			const exhaustive: never = source;
			return exhaustive;
		}
	}
}

export function bucketFor(date: TaskDate, today: IsoDate, firstDay: Weekday): Bucket {
	const dateOnly = toDateOnly(date);
	if (compareTaskDate(dateOnly, today) < 0) {
		return "overdue";
	}
	if (compareTaskDate(dateOnly, today) === 0) {
		return "today";
	}
	const thisWeekEnd = endOfWeek(today, firstDay);
	if (compareTaskDate(dateOnly, thisWeekEnd) <= 0) {
		return "this-week";
	}
	const nextWeekEnd = shiftBy(thisWeekEnd, WEEK_MS);
	if (compareTaskDate(dateOnly, nextWeekEnd) <= 0) {
		return "next-week";
	}
	return "later";
}

export interface BucketOptions {
	readonly today: IsoDate;
	readonly firstDay: Weekday;
	readonly source: DateSource;
}

function compareOptionalDate(a: Option<TaskDate>, b: Option<TaskDate>): number {
	if (a.some && b.some) {
		return compareTaskDate(a.value, b.value);
	}
	if (a.some) {
		return -1;
	}
	if (b.some) {
		return 1;
	}
	return 0;
}

function compareWithinBucket(a: Task, b: Task, source: DateSource): number {
	const dateCompare = compareOptionalDate(taskAnchorDate(a, source), taskAnchorDate(b, source));
	if (dateCompare !== 0) {
		return dateCompare;
	}
	const priorityCompare = priorityRank(b.priority) - priorityRank(a.priority);
	if (priorityCompare !== 0) {
		return priorityCompare;
	}
	return a.title.localeCompare(b.title);
}

/**
 * Groups tasks into buckets by the configured date source, sorted within
 * each bucket: date ascending -> priority descending -> title ascending.
 * Terminal-kind tasks are not excluded here — visibility is Bases' filter's
 * job (see `docs/ARCHITECTURE.md#why-views-never-filter`).
 */
export function groupIntoBuckets(tasks: readonly Task[], options: BucketOptions): ReadonlyMap<Bucket, readonly Task[]> {
	const buckets = new Map<Bucket, Task[]>(BUCKET_ORDER.map((bucket) => [bucket, []]));

	for (const task of tasks) {
		const anchor = taskAnchorDate(task, options.source);
		const bucket: Bucket = anchor.some ? bucketFor(anchor.value, options.today, options.firstDay) : "no-date";
		buckets.get(bucket)?.push(task);
	}

	const result = new Map<Bucket, readonly Task[]>();
	for (const bucket of BUCKET_ORDER) {
		const list = buckets.get(bucket) ?? [];
		result.set(
			bucket,
			[...list].sort((a, b) => compareWithinBucket(a, b, options.source)),
		);
	}
	return result;
}
