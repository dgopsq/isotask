import { addDays, format } from "date-fns";

import { bucketFor } from "@/domain/buckets";
import type { Bucket } from "@/domain/buckets";
import type { IsoDate, Weekday } from "@/domain/dates";

/**
 * Fixture generation for the e2e vault (`e2e/vault/Tasks/`). Dates are always
 * computed relative to "now" (never checked in) so the suite stays valid on
 * any day it runs. Bucket membership for the "soon" task is computed via the
 * real `bucketFor` domain function rather than hard-coded, so the assertions
 * in `e2e/specs/feed.e2e.ts` stay correct regardless of which day of the week
 * (or which side of a week boundary) the suite runs on.
 *
 * This module is imported both by `generate-fixtures.mts` (writes the notes
 * into the vault before `wdio` starts) and by the e2e specs (to know what to
 * expect in the rendered DOM) — single source of truth for the fixture data.
 */

/** Matches the plugin's default week-start setting (Monday-first). */
export const WEEK_START: Weekday = 0;

export const BUCKET_LABELS: Readonly<Record<Bucket, string>> = {
	overdue: "Overdue",
	today: "Today",
	"this-week": "This week",
	"next-week": "Next week",
	later: "Later",
	"no-date": "No date",
};

export interface FixtureTask {
	readonly filename: string;
	readonly title: string;
	readonly frontmatter: Readonly<Record<string, string>>;
	readonly body: string;
	readonly bucket: Bucket;
}

export interface FixtureInvalidTask {
	readonly filename: string;
	readonly title: string;
	readonly frontmatter: Readonly<Record<string, string>>;
	readonly body: string;
}

/**
 * A weekly-recurring task, due today, used by `e2e/specs/views.e2e.ts`'s
 * "Actions" suite to exercise complete -> spawn-next-occurrence. Kept
 * separate from `tasks` (rather than folded in) so it never affects the
 * Feed view's bucket-structure assertions, which iterate `tasks` directly.
 */
export interface FixtureRecurringTask {
	readonly filename: string;
	readonly title: string;
	readonly due: IsoDate;
	readonly frontmatter: Readonly<Record<string, string>>;
	readonly body: string;
}

export interface Fixtures {
	readonly today: IsoDate;
	readonly tasks: readonly FixtureTask[];
	readonly invalid: FixtureInvalidTask;
	readonly recurring: FixtureRecurringTask;
}

function isoDate(date: Date): IsoDate {
	return format(date, "yyyy-MM-dd") as IsoDate;
}

/**
 * Builds the fixture task set relative to `now` (defaults to the real
 * current time). Every date-bearing task's bucket is computed with the real
 * `bucketFor` domain function so the e2e assertions never hard-code bucket
 * boundaries.
 */
export function buildFixtures(now: Date = new Date()): Fixtures {
	const today = isoDate(now);

	function dueWithBucket(offsetDays: number): { readonly due: IsoDate; readonly bucket: Bucket } {
		const due = isoDate(addDays(now, offsetDays));
		return { due, bucket: bucketFor(due, today, WEEK_START) };
	}

	const overdue = dueWithBucket(-4);
	const dueToday = dueWithBucket(0);
	const soon = dueWithBucket(2);
	const later = dueWithBucket(20);

	const tasks: readonly FixtureTask[] = [
		{
			filename: "Overdue task.md",
			title: "Overdue task",
			// Extended with priority/project/tags (M2 Wave 3) so the feed row
			// chip assertions in `views.e2e.ts` have real data to render.
			// `tags` is a YAML flow-list scalar string — `noteContent` writes
			// raw scalars, so this parses as a two-element string array with no
			// renderer change needed.
			frontmatter: { type: "task", status: "todo", due: overdue.due, priority: "high", project: "Q3 Launch", tags: "[work, urgent]" },
			body: "Generated e2e fixture: overdue.",
			bucket: overdue.bucket,
		},
		{
			filename: "Today task.md",
			title: "Today task",
			frontmatter: { type: "task", status: "todo", due: dueToday.due },
			body: "Generated e2e fixture: due today.",
			bucket: dueToday.bucket,
		},
		{
			filename: "This week or next week task.md",
			title: "This week or next week task",
			frontmatter: { type: "task", status: "todo", due: soon.due },
			body: "Generated e2e fixture: due in two days.",
			bucket: soon.bucket,
		},
		{
			filename: "Later task.md",
			title: "Later task",
			frontmatter: { type: "task", status: "todo", due: later.due },
			body: "Generated e2e fixture: due later.",
			bucket: later.bucket,
		},
		{
			filename: "No date task.md",
			title: "No date task",
			frontmatter: { type: "task", status: "todo" },
			body: "Generated e2e fixture: no date.",
			bucket: "no-date",
		},
	];

	const invalid: FixtureInvalidTask = {
		filename: "Invalid task.md",
		title: "Invalid task",
		frontmatter: { type: "task", status: "banana", due: "not-a-date" },
		body: "Generated e2e fixture: invalid status and date, on purpose.",
	};

	const recurring: FixtureRecurringTask = {
		filename: "Recurring task.md",
		title: "Recurring task",
		due: today,
		frontmatter: { type: "task", status: "todo", due: today, repeat: "FREQ=WEEKLY" },
		body: "Generated e2e fixture: recurring weekly task.",
	};

	return { today, tasks, invalid, recurring };
}

/**
 * Renders a task fixture's frontmatter + body as note content. Values are
 * plain vault-fixture strings (status ids, ISO dates) with no YAML-special
 * characters, so bare (unquoted) scalars are used — matching the shape of a
 * hand-written task note and avoiding any YAML-scalar-typing surprises
 * (e.g. an unquoted date being read back as something other than a string).
 */
export function noteContent(frontmatter: Readonly<Record<string, string>>, body: string): string {
	const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`);
	return `---\n${lines.join("\n")}\n---\n${body}\n`;
}
