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
	/**
	 * `scheduled` date on the "Today task" fixture (below `tasks`, alongside
	 * its `due: today`) — used by `e2e/specs/views.e2e.ts`'s "Calendar view"
	 * suite to exercise the `events: both` -> `scheduled` view-option switch:
	 * one task carrying both fields lets the switch be asserted as "the due
	 * event disappears, the scheduled one stays" on the same note, rather
	 * than needing to correlate two different fixture tasks.
	 */
	readonly todayTaskScheduled: IsoDate;
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
	const highPriorityOverdue = dueWithBucket(-1);
	const dueToday = dueWithBucket(0);
	const soon = dueWithBucket(2);
	const later = dueWithBucket(20);
	const todayTaskScheduled = isoDate(addDays(now, 3));

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
			// `scheduled` (M3 Wave 3) alongside `due` so the calendar view's
			// `events: both` default renders two events for this one note —
			// see `Fixtures.todayTaskScheduled`. Doesn't affect any Feed
			// assertion: the feed's default `dateSource` is "due", which
			// ignores `scheduled` for both anchor and bucket purposes.
			frontmatter: { type: "task", status: "todo", due: dueToday.due, scheduled: todayTaskScheduled },
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
		{
			filename: "Write M1 plan.md",
			title: "Write M1 plan",
			// A second `priority: high` task, due yesterday (within the current
			// month) — the calendar month view's dot colour reads urgent/high
			// via `--color-red`/`--color-orange`, and every *other* fixture task
			// is `priority: normal` (the interactive-accent dot), so nothing
			// exercised those colours in a calendar screenshot without this one.
			frontmatter: { type: "task", status: "todo", due: highPriorityOverdue.due, priority: "high" },
			body: "Generated e2e fixture: high priority, due yesterday.",
			bucket: highPriorityOverdue.bucket,
		},
		{
			filename: "Team sync.md",
			title: "Team sync",
			// A timed `scheduled` + `duration` (M3 Wave 3 fields), today — every
			// other fixture task is date-only, landing in the calendar's all-day
			// row; this is the only one that gives the week/day time grid an
			// actual timed block to render. No `due`, so — like "No date task"
			// — it falls into the Feed's "no-date" bucket (the Feed's default
			// `dateSource` is "due", which ignores `scheduled`).
			frontmatter: { type: "task", status: "todo", scheduled: `${today}T09:00`, duration: "60", priority: "urgent" },
			body: "Generated e2e fixture: timed scheduled block.",
			bucket: "no-date",
		},
		{
			filename: "Standup.md",
			title: "Standup",
			// A 30-minute timed block, later the same day as "Team sync"'s
			// 1-hour block — the compact hourly time grid (`slotDuration:
			// "01:00:00"`, `slotHeight: 32`, see `event-calendar-renderer.ts`)
			// halves a hovable slot to 16px, so this fixture is what the week
			// screenshot uses to confirm a half-hour block still fits a
			// readable title. No `due`, so — like "Team sync" — it falls into
			// the Feed's "no-date" bucket.
			frontmatter: { type: "task", status: "todo", scheduled: `${today}T11:00`, duration: "30", priority: "normal" },
			body: "Generated e2e fixture: 30-minute timed scheduled block.",
			bucket: "no-date",
		},
		{
			filename: "Planning session.md",
			title: "Planning session",
			// A 2-hour timed block (>= 2 * slotHeight = 64px, `event-calendar-
			// renderer.ts`) — tall enough for both the title and the time
			// line to fit. `views.e2e.ts`'s day-view suite uses this
			// alongside "Team sync"'s 1-hour block to assert the
			// `@container` height query in `calendar.css` that hides
			// `.ec-event-time` in a too-short block: hidden in the 1h block,
			// visible here. No `due`, so — like the other `scheduled`-only
			// fixtures — it falls into the Feed's "no-date" bucket.
			frontmatter: { type: "task", status: "todo", scheduled: `${today}T13:00`, duration: "120", priority: "normal" },
			body: "Generated e2e fixture: 2-hour timed scheduled block.",
			bucket: "no-date",
		},
		{
			filename: "Deadline call.md",
			title: "Deadline call",
			// A timed `due` with no `scheduled` — `due` never carries a
			// `duration` field, so per ADR 0011 this is a zero-duration point
			// event: it renders as an all-day chip with its time as a separate
			// label in front of the title ("14:30" + "Deadline call"), never
			// as a marker inside the time-grid body. `views.e2e.ts`'s week-view
			// test asserts both halves of that: present in `.ec-all-day`,
			// absent from `.ec-time-grid .ec-body`. Bucket is "today" like the
			// other due-today fixtures — `bucketFor` strips the time
			// component before comparing.
			frontmatter: { type: "task", status: "todo", due: `${today}T14:30`, priority: "normal" },
			body: "Generated e2e fixture: timed due, no scheduled.",
			bucket: dueToday.bucket,
		},
		{
			filename: "Early ping.md",
			title: "Early ping",
			// A second timed `due` today, earlier than "Deadline call" — with
			// "Late ping" below, these three timed-due chips (09:15, 11:45,
			// 14:30) plus "Today task"'s date-only due chip give
			// `views.e2e.ts` a same-day set to assert all-day chip ordering
			// on: date-only first, then timed chips by time of day
			// (`domain/calendar-events.ts#sortCalendarEvents`).
			frontmatter: { type: "task", status: "todo", due: `${today}T09:15`, priority: "normal" },
			body: "Generated e2e fixture: timed due, earlier than Deadline call, for chip-ordering.",
			bucket: dueToday.bucket,
		},
		{
			filename: "Late ping.md",
			title: "Late ping",
			// A third timed `due` today, between "Early ping" and "Deadline
			// call" — see "Early ping" above.
			frontmatter: { type: "task", status: "todo", due: `${today}T11:45`, priority: "normal" },
			body: "Generated e2e fixture: timed due, between Early ping and Deadline call, for chip-ordering.",
			bucket: dueToday.bucket,
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

	return { today, tasks, invalid, recurring, todayTaskScheduled };
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
