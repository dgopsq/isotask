import { describe, expect, it } from "vitest";

import { BUCKET_ORDER, bucketFor, groupIntoBuckets, taskAnchorDate, visibleBuckets, type Bucket } from "@/domain/buckets";
import type { IsoDate, TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";
import type { Task, TaskPath } from "@/domain/task";

// Local four-status list, since DEFAULT_STATUSES no longer configures cancelled — these
// completedAtBottom tests need "cancelled" to resolve to a terminal kind.
const FOUR_STATUSES: readonly StatusConfig[] = [
	{ id: "todo" as Task["status"], label: "To do", kind: "open" },
	{ id: "in-progress" as Task["status"], label: "In progress", kind: "active" },
	{ id: "done" as Task["status"], label: "Done", kind: "done" },
	{ id: "cancelled" as Task["status"], label: "Cancelled", kind: "cancelled" },
];

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

const TODAY = date("2026-09-02") as IsoDate; // Wed

function task(overrides: Partial<Task> & { readonly title: string }): Task {
	return {
		path: `${overrides.title}.md` as TaskPath,
		status: "todo" as Task["status"],
		priority: "normal",
		tags: [],
		...overrides,
	};
}

describe("bucketFor — worked example from docs/DOMAIN-MODEL.md (today = Wed 2026-09-02, Monday start)", () => {
	const table: readonly { readonly value: string; readonly expected: Bucket }[] = [
		{ value: "2026-08-28", expected: "overdue" }, // Fri, last week
		{ value: "2026-09-01", expected: "overdue" }, // Tue, this week, before today
		{ value: "2026-09-02", expected: "today" }, // Wed, today
		{ value: "2026-09-04", expected: "this-week" }, // Fri, this week
		{ value: "2026-09-06", expected: "this-week" }, // Sun, this week
		{ value: "2026-09-07", expected: "next-week" }, // Mon, next week
		{ value: "2026-09-13", expected: "next-week" }, // Sun, next week
		{ value: "2026-09-14", expected: "later" }, // Mon, week after next
		{ value: "2026-12-25", expected: "later" },
	];

	it.each(table)("$value -> $expected", ({ value, expected }) => {
		expect(bucketFor(date(value), TODAY, 0)).toBe(expected);
	});
});

describe("bucketFor — week-start boundaries", () => {
	it("Monday-first: Sunday belongs to this week, Monday to next week", () => {
		expect(bucketFor(date("2026-09-06"), TODAY, 0)).toBe("this-week");
		expect(bucketFor(date("2026-09-07"), TODAY, 0)).toBe("next-week");
	});

	it("Sunday-first: Saturday belongs to this week, Sunday to next week", () => {
		// today = Wed 2026-09-02, week (Sunday-first) = Sun 2026-08-30 .. Sat 2026-09-05
		expect(bucketFor(date("2026-09-05"), TODAY, 6)).toBe("this-week");
		expect(bucketFor(date("2026-09-06"), TODAY, 6)).toBe("next-week");
	});
});

describe("taskAnchorDate", () => {
	it("due", () => {
		const t = task({ title: "a", due: date("2026-09-05") });
		expect(taskAnchorDate(t, "due")).toEqual({ some: true, value: date("2026-09-05") });
	});

	it("scheduled", () => {
		const t = task({ title: "a", scheduled: date("2026-09-05") });
		expect(taskAnchorDate(t, "scheduled")).toEqual({ some: true, value: date("2026-09-05") });
	});

	it("earliest picks the smaller of due/scheduled", () => {
		const t = task({ title: "a", due: date("2026-09-10"), scheduled: date("2026-09-05") });
		expect(taskAnchorDate(t, "earliest")).toEqual({ some: true, value: date("2026-09-05") });
	});

	it("earliest falls back to whichever is present", () => {
		expect(taskAnchorDate(task({ title: "a", due: date("2026-09-10") }), "earliest")).toEqual({
			some: true,
			value: date("2026-09-10"),
		});
		expect(taskAnchorDate(task({ title: "a" }), "earliest")).toEqual({ some: false });
	});
});

describe("groupIntoBuckets", () => {
	it("buckets no-date tasks separately and always returns every bucket key", () => {
		const tasks = [task({ title: "No date" })];
		const grouped = groupIntoBuckets(tasks, { today: TODAY, firstDay: 0, source: "due" });
		expect([...grouped.keys()]).toEqual(BUCKET_ORDER);
		expect(grouped.get("no-date")).toHaveLength(1);
	});

	it("sorts within a bucket by date asc, then priority desc, then title asc", () => {
		const tasks = [
			task({ title: "B late high", due: date("2026-09-04"), priority: "high" }),
			task({ title: "A early", due: date("2026-09-03"), priority: "normal" }),
			task({ title: "C late normal", due: date("2026-09-04"), priority: "normal" }),
			task({ title: "D late high alpha-first", due: date("2026-09-04"), priority: "high" }),
		];
		const grouped = groupIntoBuckets(tasks, { today: TODAY, firstDay: 0, source: "due" });
		const thisWeek = grouped.get("this-week") ?? [];
		expect(thisWeek.map((t) => t.title)).toEqual(["A early", "B late high", "D late high alpha-first", "C late normal"]);
	});

	it('"errors" is always present but never populated — it has no anchor date `bucketFor` can route a `Task` into', () => {
		const tasks = [task({ title: "No date" }), task({ title: "Overdue", due: date("2026-08-28") })];
		const grouped = groupIntoBuckets(tasks, { today: TODAY, firstDay: 0, source: "due" });
		expect(grouped.get("errors")).toEqual([]);
	});
});

describe("visibleBuckets", () => {
	const emptyBuckets = new Map<Bucket, readonly ReturnType<typeof task>[]>(BUCKET_ORDER.map((bucket) => [bucket, []]));

	it("with showEmptyBuckets off and nothing invalid, hides every bucket, including errors", () => {
		expect(visibleBuckets(emptyBuckets, 0, false)).toEqual([]);
	});

	it("with showEmptyBuckets on, shows every bucket in BUCKET_ORDER, including an empty errors bucket", () => {
		expect(visibleBuckets(emptyBuckets, 0, true)).toEqual(BUCKET_ORDER);
	});

	it('"errors" is sized off invalidCount, independently of the buckets map, and sorts after every other bucket', () => {
		expect(visibleBuckets(emptyBuckets, 1, false)).toEqual(["errors"]);
	});

	it("a non-empty date bucket shows even with showEmptyBuckets off, while a still-empty errors bucket stays hidden", () => {
		const tasks = [task({ title: "No date" })];
		const grouped = groupIntoBuckets(tasks, { today: TODAY, firstDay: 0, source: "due" });
		expect(visibleBuckets(grouped, 0, false)).toEqual(["no-date"]);
	});

	it("errors comes last even when every other bucket is also visible", () => {
		const tasks = [
			task({ title: "Overdue", due: date("2026-08-28") }),
			task({ title: "Today", due: date("2026-09-02") }),
			task({ title: "This week", due: date("2026-09-04") }),
			task({ title: "Next week", due: date("2026-09-07") }),
			task({ title: "Later", due: date("2026-12-25") }),
			task({ title: "No date" }),
		];
		const grouped = groupIntoBuckets(tasks, { today: TODAY, firstDay: 0, source: "due" });
		expect(visibleBuckets(grouped, 2, false)).toEqual(BUCKET_ORDER);
	});
});

describe("groupIntoBuckets — completedAtBottom", () => {
	const tasks = [
		task({ title: "Z done early", due: date("2026-09-03"), status: "done" as Task["status"] }),
		task({ title: "A todo late", due: date("2026-09-04"), status: "todo" as Task["status"] }),
		task({ title: "B cancelled mid", due: date("2026-09-03"), status: "cancelled" as Task["status"] }),
		task({ title: "C todo early", due: date("2026-09-03"), status: "todo" as Task["status"] }),
	];

	it("when true (with statuses configured), terminal tasks sort after non-terminal ones, each side keeping date/priority/title order", () => {
		const grouped = groupIntoBuckets(tasks, {
			today: TODAY,
			firstDay: 0,
			source: "due",
			statuses: FOUR_STATUSES,
			completedAtBottom: true,
		});
		const thisWeek = grouped.get("this-week") ?? [];
		expect(thisWeek.map((t) => t.title)).toEqual(["C todo early", "A todo late", "B cancelled mid", "Z done early"]);
	});

	it("when false, terminal-ness is ignored and the existing date order applies", () => {
		const grouped = groupIntoBuckets(tasks, {
			today: TODAY,
			firstDay: 0,
			source: "due",
			statuses: DEFAULT_STATUSES,
			completedAtBottom: false,
		});
		const thisWeek = grouped.get("this-week") ?? [];
		expect(thisWeek.map((t) => t.title)).toEqual(["B cancelled mid", "C todo early", "Z done early", "A todo late"]);
	});

	it("when omitted, behaves the same as false (default off)", () => {
		const grouped = groupIntoBuckets(tasks, { today: TODAY, firstDay: 0, source: "due" });
		const thisWeek = grouped.get("this-week") ?? [];
		expect(thisWeek.map((t) => t.title)).toEqual(["B cancelled mid", "C todo early", "Z done early", "A todo late"]);
	});

	it("when true but statuses is not configured, terminal-ness is ignored (can't classify without configs)", () => {
		const grouped = groupIntoBuckets(tasks, { today: TODAY, firstDay: 0, source: "due", completedAtBottom: true });
		const thisWeek = grouped.get("this-week") ?? [];
		expect(thisWeek.map((t) => t.title)).toEqual(["B cancelled mid", "C todo early", "Z done early", "A todo late"]);
	});
});

describe("groupIntoBuckets — order", () => {
	it('"preserve" keeps the incoming order, ignoring date/priority/title', () => {
		const tasks = [
			task({ title: "Z late normal", due: date("2026-09-04"), priority: "normal" }),
			task({ title: "A early high", due: date("2026-09-03"), priority: "high" }),
			task({ title: "M mid normal", due: date("2026-09-03"), priority: "normal" }),
		];
		const grouped = groupIntoBuckets(tasks, { today: TODAY, firstDay: 0, source: "due", order: "preserve" });
		const thisWeek = grouped.get("this-week") ?? [];
		expect(thisWeek.map((t) => t.title)).toEqual(["Z late normal", "A early high", "M mid normal"]);
	});

	it('"preserve" + completedAtBottom still moves terminal tasks last, keeping relative order on each side', () => {
		const tasks = [
			task({ title: "Z done early", due: date("2026-09-03"), status: "done" as Task["status"] }),
			task({ title: "A todo late", due: date("2026-09-04"), status: "todo" as Task["status"] }),
			task({ title: "B cancelled mid", due: date("2026-09-03"), status: "cancelled" as Task["status"] }),
			task({ title: "C todo early", due: date("2026-09-03"), status: "todo" as Task["status"] }),
		];
		const grouped = groupIntoBuckets(tasks, {
			today: TODAY,
			firstDay: 0,
			source: "due",
			statuses: FOUR_STATUSES,
			completedAtBottom: true,
			order: "preserve",
		});
		const thisWeek = grouped.get("this-week") ?? [];
		expect(thisWeek.map((t) => t.title)).toEqual(["A todo late", "C todo early", "Z done early", "B cancelled mid"]);
	});

	it('omitting `order` (or passing "smart") is unchanged from the pre-existing date/priority/title behavior', () => {
		const tasks = [
			task({ title: "B late high", due: date("2026-09-04"), priority: "high" }),
			task({ title: "A early", due: date("2026-09-03"), priority: "normal" }),
			task({ title: "C late normal", due: date("2026-09-04"), priority: "normal" }),
		];
		const expected = ["A early", "B late high", "C late normal"];

		const omitted = groupIntoBuckets(tasks, { today: TODAY, firstDay: 0, source: "due" });
		expect((omitted.get("this-week") ?? []).map((t) => t.title)).toEqual(expected);

		const explicit = groupIntoBuckets(tasks, { today: TODAY, firstDay: 0, source: "due", order: "smart" });
		expect((explicit.get("this-week") ?? []).map((t) => t.title)).toEqual(expected);
	});
});
