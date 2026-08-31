import type { IsoDate, TaskDate, Weekday } from "@/domain/dates";
import { compareTaskDate, endOfWeek, shiftBy, toDateOnly } from "@/domain/dates";
import type { Option } from "@/domain/result";
import { fromNullable, none, some } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import { findStatus, isTerminal } from "@/domain/status";
import type { Task } from "@/domain/task";
import { priorityRank } from "@/domain/task";

/**
 * The six date-anchored buckets, plus the synthetic `"errors"` bucket: tasks
 * that fail to parse at all (`domain/task.ts#TaskParseError`) have no anchor
 * date to bucket by, so they can never come out of `bucketFor`/
 * `groupIntoBuckets` — the feed view assigns them to `"errors"` itself, from
 * the invalid-entry count `adapters/obsidian/bases-entries.ts` reports
 * alongside its parsed tasks. `"errors"` sits last in `BUCKET_ORDER` (after
 * `"no-date"`), so it always renders as the feed's final section.
 */
export type Bucket = "overdue" | "today" | "this-week" | "next-week" | "later" | "no-date" | "errors";

export const BUCKET_ORDER: readonly Bucket[] = ["overdue", "today", "this-week", "next-week", "later", "no-date", "errors"];

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
	/** Configured statuses, used to detect terminal-kind tasks for `completedAtBottom`. */
	readonly statuses?: readonly StatusConfig[];
	/** When true, terminal-kind tasks (see `domain/status.ts#isTerminal`) sort after all others within each bucket. Defaults to false. */
	readonly completedAtBottom?: boolean;
	/**
	 * Within-bucket ordering, after the terminal/non-terminal split above.
	 * `"smart"` (default) sorts by date (per `source`) ascending -> priority
	 * descending -> title ascending. `"preserve"` applies no further
	 * comparison, keeping whatever order the tasks arrived in — used when
	 * the caller's incoming order is already meaningful (e.g. the Bases
	 * toolbar's user-configured sort), since `Array.prototype.sort` is
	 * stable and a comparator returning `0` never reorders equal elements.
	 */
	readonly order?: "smart" | "preserve";
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

function isTaskTerminal(task: Task, statuses: readonly StatusConfig[]): boolean {
	const status = findStatus(statuses, task.status);
	return status.some && isTerminal(status.value.kind);
}

function compareWithinBucket(a: Task, b: Task, options: BucketOptions): number {
	if (options.completedAtBottom === true && options.statuses !== undefined) {
		const terminalCompare = Number(isTaskTerminal(a, options.statuses)) - Number(isTaskTerminal(b, options.statuses));
		if (terminalCompare !== 0) {
			return terminalCompare;
		}
	}
	if (options.order === "preserve") {
		return 0;
	}
	const dateCompare = compareOptionalDate(taskAnchorDate(a, options.source), taskAnchorDate(b, options.source));
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
 * each bucket: (when `completedAtBottom` is set) terminal-kind tasks last,
 * then — per `options.order` — either `"smart"` (date ascending -> priority
 * descending -> title ascending on each side, the default) or `"preserve"`
 * (keep the incoming order, e.g. a Bases toolbar sort, on each side).
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
			[...list].sort((a, b) => compareWithinBucket(a, b, options)),
		);
	}
	return result;
}

/**
 * Which buckets the feed should actually render, in `BUCKET_ORDER` (so
 * `"errors"` — see `Bucket`'s doc comment — always comes last), filtered by
 * `showEmptyBuckets`: a bucket with nothing in it is dropped unless
 * `showEmptyBuckets` is on, in which case every bucket renders (with a
 * placeholder for the ones that are empty). `"errors"` is sized off
 * `invalidCount` — the count of entries that failed to parse — rather than
 * `buckets`, since `groupIntoBuckets` never puts a `Task` there itself (an
 * unparseable entry never became one); every other bucket is sized off
 * `buckets.get(bucket)`. This is the one rule for "is this bucket empty",
 * applied uniformly — the errors bucket gets no special-casing beyond
 * supplying its count differently.
 */
export function visibleBuckets(buckets: ReadonlyMap<Bucket, readonly Task[]>, invalidCount: number, showEmptyBuckets: boolean): readonly Bucket[] {
	return BUCKET_ORDER.filter((bucket) => {
		const count = bucket === "errors" ? invalidCount : (buckets.get(bucket)?.length ?? 0);
		return count > 0 || showEmptyBuckets;
	});
}
