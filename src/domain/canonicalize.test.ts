import { describe, expect, it } from "vitest";

import { canonicalizeFrontmatter } from "@/domain/canonicalize";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import type { StatusId } from "@/domain/task";

const keys = DEFAULT_PROPERTY_KEYS;

// Local three-status list (todo/waiting/done), since DEFAULT_STATUSES no longer configures
// a second open-kind status — several tests below canonicalize against those labels/ids.
const THREE_STATUSES: readonly StatusConfig[] = [
	{ id: "todo" as StatusId, label: "To do", kind: "open" },
	{ id: "waiting" as StatusId, label: "On hold", kind: "open" },
	{ id: "done" as StatusId, label: "Done", kind: "done" },
];
const statuses = THREE_STATUSES;

describe("canonicalizeFrontmatter", () => {
	describe("status", () => {
		it("leaves an already-canonical status untouched", () => {
			const result = canonicalizeFrontmatter({ status: "todo" }, keys, statuses);
			expect(result.fixes).toEqual([]);
			expect(result.frontmatter['status']).toBe("todo");
		});

		it("trims surrounding whitespace", () => {
			const result = canonicalizeFrontmatter({ status: " todo " }, keys, statuses);
			expect(result.frontmatter['status']).toBe("todo");
			expect(result.fixes).toEqual([{ key: "status", from: " todo ", to: "todo", reason: "whitespace" }]);
		});

		it("folds a differently-cased id", () => {
			const result = canonicalizeFrontmatter({ status: "Done" }, keys, statuses);
			expect(result.frontmatter['status']).toBe("done");
			expect(result.fixes).toEqual([{ key: "status", from: "Done", to: "done", reason: "status-case" }]);
		});

		it("resolves a status label to its id", () => {
			const result = canonicalizeFrontmatter({ status: "On hold" }, keys, statuses);
			expect(result.frontmatter['status']).toBe("waiting");
			expect(result.fixes).toEqual([{ key: "status", from: "On hold", to: "waiting", reason: "status-label" }]);
		});

		it("resolves a case-mismatched label", () => {
			const result = canonicalizeFrontmatter({ status: "ON HOLD" }, keys, statuses);
			expect(result.frontmatter['status']).toBe("waiting");
			expect(result.fixes).toEqual([{ key: "status", from: "ON HOLD", to: "waiting", reason: "status-label" }]);
		});

		it("prefers an id match over a label match when both could apply", () => {
			// Second status's label ("done") collides with the first status's id
			// ("done"); an id match must win, so "Done" resolves to the first
			// status rather than the second.
			const collidingStatuses: readonly StatusConfig[] = [
				{ id: "done" as StatusId, label: "Complete", kind: "done" },
				{ id: "archived" as StatusId, label: "done", kind: "open" },
			];
			const result = canonicalizeFrontmatter({ status: "Done" }, keys, collidingStatuses);
			expect(result.frontmatter['status']).toBe("done");
			expect(result.fixes).toEqual([{ key: "status", from: "Done", to: "done", reason: "status-case" }]);
		});

		it("leaves a genuinely unknown status unchanged", () => {
			const result = canonicalizeFrontmatter({ status: "someday" }, keys, statuses);
			expect(result.frontmatter['status']).toBe("someday");
			expect(result.fixes).toEqual([]);
		});

		it("ignores a non-string status value", () => {
			const result = canonicalizeFrontmatter({ status: 5 }, keys, statuses);
			expect(result.frontmatter['status']).toBe(5);
			expect(result.fixes).toEqual([]);
		});
	});

	describe("priority", () => {
		it("leaves an already-canonical priority untouched", () => {
			const result = canonicalizeFrontmatter({ priority: "high" }, keys, statuses);
			expect(result.fixes).toEqual([]);
		});

		it("trims whitespace around an already-lowercase priority", () => {
			const result = canonicalizeFrontmatter({ priority: " high " }, keys, statuses);
			expect(result.frontmatter['priority']).toBe("high");
			expect(result.fixes).toEqual([{ key: "priority", from: " high ", to: "high", reason: "whitespace" }]);
		});

		it("lower-cases a mixed-case priority", () => {
			const result = canonicalizeFrontmatter({ priority: "High" }, keys, statuses);
			expect(result.frontmatter['priority']).toBe("high");
			expect(result.fixes).toEqual([{ key: "priority", from: "High", to: "high", reason: "priority-case" }]);
		});

		it("leaves an unrecognized priority unchanged", () => {
			const result = canonicalizeFrontmatter({ priority: "asap" }, keys, statuses);
			expect(result.frontmatter['priority']).toBe("asap");
			expect(result.fixes).toEqual([]);
		});

		it("aliases the retired 'low' priority to normal (4-to-3 collapse)", () => {
			const result = canonicalizeFrontmatter({ priority: "low" }, keys, statuses);
			expect(result.frontmatter['priority']).toBe("normal");
			expect(result.fixes).toEqual([{ key: "priority", from: "low", to: "normal", reason: "priority-alias" }]);
		});

		it("aliases 'low' case-insensitively, with surrounding whitespace, to normal", () => {
			const result = canonicalizeFrontmatter({ priority: " LOW " }, keys, statuses);
			expect(result.frontmatter['priority']).toBe("normal");
			expect(result.fixes).toEqual([{ key: "priority", from: " LOW ", to: "normal", reason: "priority-alias" }]);
		});
	});

	describe("duration", () => {
		it("converts a non-negative integer string to a number", () => {
			const result = canonicalizeFrontmatter({ duration: "45" }, keys, statuses);
			expect(result.frontmatter['duration']).toBe(45);
			expect(result.fixes).toEqual([{ key: "duration", from: "45", to: 45, reason: "duration-string" }]);
		});

		it("trims surrounding whitespace before converting", () => {
			const result = canonicalizeFrontmatter({ duration: " 45 " }, keys, statuses);
			expect(result.frontmatter['duration']).toBe(45);
		});

		it("converts \"0\" to the number 0", () => {
			const result = canonicalizeFrontmatter({ duration: "0" }, keys, statuses);
			expect(result.frontmatter['duration']).toBe(0);
			expect(result.fixes).toEqual([{ key: "duration", from: "0", to: 0, reason: "duration-string" }]);
		});

		it("leaves a non-integer duration string unchanged", () => {
			const result = canonicalizeFrontmatter({ duration: "45.5" }, keys, statuses);
			expect(result.frontmatter['duration']).toBe("45.5");
			expect(result.fixes).toEqual([]);
		});

		it("leaves a negative duration string unchanged", () => {
			const result = canonicalizeFrontmatter({ duration: "-5" }, keys, statuses);
			expect(result.frontmatter['duration']).toBe("-5");
			expect(result.fixes).toEqual([]);
		});

		it("leaves an already-numeric duration untouched", () => {
			const result = canonicalizeFrontmatter({ duration: 45 }, keys, statuses);
			expect(result.fixes).toEqual([]);
			expect(result.frontmatter['duration']).toBe(45);
		});
	});

	describe("tags", () => {
		it("wraps a scalar string into a one-element list", () => {
			const result = canonicalizeFrontmatter({ tags: "errand" }, keys, statuses);
			expect(result.frontmatter['tags']).toEqual(["errand"]);
			expect(result.fixes).toEqual([{ key: "tags", from: "errand", to: ["errand"], reason: "tags-scalar" }]);
		});

		it("turns an empty scalar string into an empty list", () => {
			const result = canonicalizeFrontmatter({ tags: "" }, keys, statuses);
			expect(result.frontmatter['tags']).toEqual([]);
		});

		it("leaves an already-array tags value untouched", () => {
			const result = canonicalizeFrontmatter({ tags: ["errand", "home"] }, keys, statuses);
			expect(result.fixes).toEqual([]);
			expect(result.frontmatter['tags']).toEqual(["errand", "home"]);
		});
	});

	describe("dates", () => {
		it("leaves an already-canonical date-only value untouched", () => {
			const result = canonicalizeFrontmatter({ due: "2026-09-05" }, keys, statuses);
			expect(result.fixes).toEqual([]);
		});

		it("leaves an already-canonical datetime value untouched", () => {
			const result = canonicalizeFrontmatter({ due: "2026-09-05T09:00" }, keys, statuses);
			expect(result.fixes).toEqual([]);
		});

		it("trims whitespace around an already-canonical datetime", () => {
			const result = canonicalizeFrontmatter({ due: " 2026-09-05T09:00 " }, keys, statuses);
			expect(result.frontmatter['due']).toBe("2026-09-05T09:00");
			expect(result.fixes).toEqual([{ key: "due", from: " 2026-09-05T09:00 ", to: "2026-09-05T09:00", reason: "whitespace" }]);
		});

		it("strips seconds from an ISO datetime with seconds", () => {
			const result = canonicalizeFrontmatter({ due: "2026-09-05T09:00:00" }, keys, statuses);
			expect(result.frontmatter['due']).toBe("2026-09-05T09:00");
			expect(result.fixes).toEqual([{ key: "due", from: "2026-09-05T09:00:00", to: "2026-09-05T09:00", reason: "date-format" }]);
		});

		it("folds a space-separated datetime to the canonical T-separated form", () => {
			const result = canonicalizeFrontmatter({ due: "2026-09-01 09:00" }, keys, statuses);
			expect(result.frontmatter['due']).toBe("2026-09-01T09:00");
			expect(result.fixes).toEqual([{ key: "due", from: "2026-09-01 09:00", to: "2026-09-01T09:00", reason: "date-format" }]);
		});

		it("folds a space-separated datetime with seconds", () => {
			const result = canonicalizeFrontmatter({ due: "2026-09-01 09:00:00" }, keys, statuses);
			expect(result.frontmatter['due']).toBe("2026-09-01T09:00");
		});

		it("leaves a timezone-suffixed value unchanged", () => {
			const result = canonicalizeFrontmatter({ due: "2026-09-01T09:00:00Z" }, keys, statuses);
			expect(result.frontmatter['due']).toBe("2026-09-01T09:00:00Z");
			expect(result.fixes).toEqual([]);
		});

		it("leaves a genuinely unparseable date unchanged", () => {
			const result = canonicalizeFrontmatter({ due: "next tuesday" }, keys, statuses);
			expect(result.frontmatter['due']).toBe("next tuesday");
			expect(result.fixes).toEqual([]);
		});

		it("applies the same rules to scheduled, created, and completed", () => {
			const result = canonicalizeFrontmatter(
				{
					scheduled: "2026-09-01 09:00",
					created: "2026-09-01T08:00:00",
					completed: " 2026-09-04 ",
				},
				keys,
				statuses,
			);
			expect(result.frontmatter['scheduled']).toBe("2026-09-01T09:00");
			expect(result.frontmatter['created']).toBe("2026-09-01T08:00");
			expect(result.frontmatter['completed']).toBe("2026-09-04");
			expect(result.fixes).toHaveLength(3);
		});
	});

	describe("remind", () => {
		it("folds a lenient offset token, case and whitespace", () => {
			const result = canonicalizeFrontmatter({ remind: "15 M" }, keys, statuses);
			expect(result.frontmatter["remind"]).toEqual(["15m"]);
			expect(result.fixes).toEqual([{ key: "remind", from: "15 M", to: ["15m"], reason: "remind-normalized" }]);
		});

		it("wraps an already-canonical scalar into a list", () => {
			const result = canonicalizeFrontmatter({ remind: "0" }, keys, statuses);
			expect(result.frontmatter["remind"]).toEqual(["0"]);
			expect(result.fixes).toEqual([{ key: "remind", from: "0", to: ["0"], reason: "remind-normalized" }]);
		});

		it("wraps a numeric scalar into a canonical-text list", () => {
			const result = canonicalizeFrontmatter({ remind: 15 }, keys, statuses);
			expect(result.frontmatter["remind"]).toEqual(["15m"]);
		});

		it("leaves an already-canonical list untouched", () => {
			const result = canonicalizeFrontmatter({ remind: ["15m", "1d"] }, keys, statuses);
			expect(result.fixes).toEqual([]);
		});

		it("folds a lenient token inside an already-list value", () => {
			const result = canonicalizeFrontmatter({ remind: ["15 M"] }, keys, statuses);
			expect(result.frontmatter["remind"]).toEqual(["15m"]);
			expect(result.fixes).toEqual([{ key: "remind", from: ["15 M"], to: ["15m"], reason: "remind-normalized" }]);
		});

		it("leaves a genuinely invalid remind value unchanged", () => {
			const result = canonicalizeFrontmatter({ remind: "tomorrow" }, keys, statuses);
			expect(result.frontmatter["remind"]).toBe("tomorrow");
			expect(result.fixes).toEqual([]);
		});

		it("is idempotent after folding a lenient remind value", () => {
			const first = canonicalizeFrontmatter({ remind: "15 M" }, keys, statuses);
			const second = canonicalizeFrontmatter(first.frontmatter, keys, statuses);
			expect(second.fixes).toEqual([]);
		});
	});

	describe("untouched keys and idempotence", () => {
		it("leaves keys not covered by the rules (project, repeat, arbitrary) untouched", () => {
			const raw = { project: "[[Groceries]]", repeat: "FREQ=WEEKLY", custom: "whatever" };
			const result = canonicalizeFrontmatter(raw, keys, statuses);
			expect(result.frontmatter).toEqual(raw);
			expect(result.fixes).toEqual([]);
		});

		it("is idempotent: canonicalizing already-canonical frontmatter yields zero fixes", () => {
			const raw = {
				type: "task",
				status: "waiting",
				priority: "high",
				due: "2026-09-05T09:00",
				scheduled: "2026-09-03",
				duration: 30,
				tags: ["errand", "home"],
				created: "2026-09-01T08:00",
				completed: "2026-09-04T10:00",
			};
			const first = canonicalizeFrontmatter(raw, keys, statuses);
			expect(first.fixes).toEqual([]);
			const second = canonicalizeFrontmatter(first.frontmatter, keys, statuses);
			expect(second.fixes).toEqual([]);
			expect(second.frontmatter).toEqual(first.frontmatter);
		});

		it("is idempotent after fixing a batch of messy frontmatter", () => {
			const raw = {
				status: " Done ",
				priority: "HIGH",
				duration: "45",
				tags: "errand",
				due: "2026-09-01 09:00:00",
			};
			const first = canonicalizeFrontmatter(raw, keys, statuses);
			expect(first.fixes.length).toBeGreaterThan(0);
			const second = canonicalizeFrontmatter(first.frontmatter, keys, statuses);
			expect(second.fixes).toEqual([]);
		});
	});
});
