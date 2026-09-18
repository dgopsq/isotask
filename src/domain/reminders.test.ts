import { describe, expect, it, vi } from "vitest";

// anchorDateTime builds a real local Date to apply defaults.timeOfDay — pin TZ so this
// suite doesn't depend on the host machine's zone (see recurrence.test.ts).
vi.stubEnv("TZ", "Europe/Rome");

import type { IsoDateTime, TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import type { ReminderDefaults, ReminderSpec } from "@/domain/reminders";
import {
	DEFAULT_REMINDER_DEFAULTS,
	formatReminderSpec,
	parseRemind,
	reminderAnchor,
	reminderId,
	reminderTimes,
} from "@/domain/reminders";
import { isErr, isOk } from "@/domain/result";
import type { StatusId, Task, TaskPath } from "@/domain/task";

function date(value: string): TaskDate {
	const result = parseTaskDate(value);
	if (!result.ok) {
		throw new Error(`bad fixture date ${value}`);
	}
	return result.value;
}

function iso(value: string): IsoDateTime {
	return value as IsoDateTime;
}

function task(overrides: Partial<Task> & { readonly title: string }): Task {
	return {
		path: `${overrides.title}.md` as TaskPath,
		status: "todo" as StatusId,
		priority: "normal",
		tags: [],
		...overrides,
	};
}

describe("parseRemind", () => {
	it("returns [] for undefined, null, and an empty string", () => {
		expect(parseRemind(undefined)).toEqual({ ok: true, value: [] });
		expect(parseRemind(null)).toEqual({ ok: true, value: [] });
		expect(parseRemind("")).toEqual({ ok: true, value: [] });
		expect(parseRemind([])).toEqual({ ok: true, value: [] });
	});

	it("parses 'none' case-insensitively", () => {
		expect(parseRemind("none")).toEqual({ ok: true, value: [{ kind: "none" }] });
		expect(parseRemind("NONE")).toEqual({ ok: true, value: [{ kind: "none" }] });
		expect(parseRemind(" None ")).toEqual({ ok: true, value: [{ kind: "none" }] });
	});

	it("a list containing none resolves to [none] only, ignoring other entries", () => {
		expect(parseRemind(["15m", "none", "1h"])).toEqual({ ok: true, value: [{ kind: "none" }] });
	});

	it("parses the bare string '0' as a zero offset", () => {
		expect(parseRemind("0")).toEqual({ ok: true, value: [{ kind: "offset", minutes: 0 }] });
	});

	it("parses a number as minutes", () => {
		expect(parseRemind(0)).toEqual({ ok: true, value: [{ kind: "offset", minutes: 0 }] });
		expect(parseRemind(15)).toEqual({ ok: true, value: [{ kind: "offset", minutes: 15 }] });
	});

	it.each([
		["15m", 15],
		["15min", 15],
		["2h", 120],
		["1d", 1440],
		["1w", 10080],
		["15 M", 15], // case-insensitive, optional space
	] as const)("parses offset token %s as %i minutes", (token, minutes) => {
		expect(parseRemind(token)).toEqual({ ok: true, value: [{ kind: "offset", minutes }] });
	});

	it("parses a datetime with a time part as absolute", () => {
		expect(parseRemind("2026-09-20T09:00")).toEqual({
			ok: true,
			value: [{ kind: "absolute", at: iso("2026-09-20T09:00") }],
		});
	});

	it("rejects a date-only value (no time part)", () => {
		expect(isErr(parseRemind("2026-09-20"))).toBe(true);
	});

	it("parses a list of mixed valid tokens in order", () => {
		expect(parseRemind(["15m", "1d", "2026-09-20T09:00"])).toEqual({
			ok: true,
			value: [
				{ kind: "offset", minutes: 15 },
				{ kind: "offset", minutes: 1440 },
				{ kind: "absolute", at: iso("2026-09-20T09:00") },
			],
		});
	});

	it.each(["tomorrow", "15", "0m", "-5m", "15x", ""])("rejects invalid token %p as a scalar", (bad) => {
		if (bad === "") {
			// empty scalar is the documented "empty" case, not an error.
			expect(isOk(parseRemind(bad))).toBe(true);
			return;
		}
		expect(parseRemind(bad)).toEqual({ ok: false, error: { kind: "invalid-remind", value: bad } });
	});

	it("carries the offending token in the error", () => {
		const result = parseRemind(["15m", "not-a-token"]);
		expect(result).toEqual({ ok: false, error: { kind: "invalid-remind", value: "not-a-token" } });
	});

	it("rejects a negative number", () => {
		expect(isErr(parseRemind(-5))).toBe(true);
	});

	it("rejects a non-integer number", () => {
		expect(isErr(parseRemind(1.5))).toBe(true);
	});

	it("rejects a boolean token", () => {
		expect(isErr(parseRemind(true))).toBe(true);
	});

	it("rejects an offset amount too large to be a safe integer", () => {
		expect(parseRemind("99999999999999999999m")).toEqual({
			ok: false,
			error: { kind: "invalid-remind", value: "99999999999999999999m" },
		});
	});

	it("rejects an offset exceeding 1 year (525600 minutes)", () => {
		expect(isErr(parseRemind("2w"))).toBe(false); // sanity: well within bounds
		expect(isErr(parseRemind("366d"))).toBe(true);
		expect(isErr(parseRemind(525_601))).toBe(true);
	});

	it("accepts exactly 1 year (525600 minutes) at the boundary", () => {
		expect(parseRemind("365d")).toEqual({ ok: true, value: [{ kind: "offset", minutes: 525_600 }] });
		expect(parseRemind(525_600)).toEqual({ ok: true, value: [{ kind: "offset", minutes: 525_600 }] });
	});

	it("365d round-trips through formatReminderSpec", () => {
		const parsed = parseRemind("365d");
		if (!parsed.ok) {
			throw new Error("unreachable: 365d should parse");
		}
		expect(parsed.value.map(formatReminderSpec)).toEqual(["365d"]);
	});
});

describe("formatReminderSpec", () => {
	it("formats none", () => {
		expect(formatReminderSpec({ kind: "none" })).toBe("none");
	});

	it("formats a zero offset as the bare '0'", () => {
		expect(formatReminderSpec({ kind: "offset", minutes: 0 })).toBe("0");
	});

	it.each([
		[15, "15m"],
		[45, "45m"],
		[60, "1h"],
		[120, "2h"],
		[1440, "1d"],
		[10080, "1w"],
		[20160, "2w"],
	] as const)("formats %i minutes as the largest unit that divides evenly (%s)", (minutes, expected) => {
		expect(formatReminderSpec({ kind: "offset", minutes })).toBe(expected);
	});

	it("formats an absolute spec as its ISO datetime", () => {
		expect(formatReminderSpec({ kind: "absolute", at: iso("2026-09-20T09:00") })).toBe("2026-09-20T09:00");
	});

	it("round-trips every parseRemind output back to its canonical token", () => {
		for (const token of ["none", "0", "15m", "2h", "1d", "1w", "2026-09-20T09:00"]) {
			const parsed = parseRemind(token);
			if (!parsed.ok) {
				throw new Error(`unreachable: ${token} should parse`);
			}
			expect(parsed.value.map(formatReminderSpec)).toEqual([token]);
		}
	});
});

describe("reminderAnchor", () => {
	it("prefers scheduled over due", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20"), scheduled: date("2026-09-19T09:00") });
		expect(reminderAnchor(t)).toEqual({ kind: "scheduled", at: date("2026-09-19T09:00") });
	});

	it("falls back to due when scheduled is absent", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20") });
		expect(reminderAnchor(t)).toEqual({ kind: "due", at: date("2026-09-20") });
	});

	it("is undefined when neither is set", () => {
		expect(reminderAnchor(task({ title: "Buy milk" }))).toBeUndefined();
	});
});

describe("reminderId", () => {
	it("is deterministic for the same inputs", () => {
		const path = "Tasks/Buy milk.md" as TaskPath;
		const spec: ReminderSpec = { kind: "offset", minutes: 15 };
		expect(reminderId(path, "due", spec)).toBe(reminderId(path, "due", spec));
	});

	it("differs when the anchor kind differs", () => {
		const path = "Tasks/Buy milk.md" as TaskPath;
		const spec: ReminderSpec = { kind: "offset", minutes: 15 };
		expect(reminderId(path, "due", spec)).not.toBe(reminderId(path, "scheduled", spec));
	});

	it("is prefixed isotask- and lowercase-hex", () => {
		const id = reminderId("Tasks/Buy milk.md" as TaskPath, "due", { kind: "offset", minutes: 15 });
		expect(id).toMatch(/^isotask-[a-f0-9]+$/);
		expect(id.length).toBeLessThan(40);
	});
});

describe("reminderTimes", () => {
	const defaults: ReminderDefaults = DEFAULT_REMINDER_DEFAULTS;

	it("returns [] for a closed task regardless of remind", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20"), remind: [{ kind: "offset", minutes: 0 }] });
		expect(reminderTimes(t, defaults, false)).toEqual([]);
	});

	it("remind undefined + remindByDefault: behaves as [offset 0] at the anchor", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20T15:00") });
		const result = reminderTimes(t, defaults, true);
		expect(result).toHaveLength(1);
		expect(result[0]?.at).toBe("2026-09-20T15:00");
		expect(result[0]?.anchor).toBe("due");
	});

	it("remind undefined + remindByDefault false: []", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20T15:00") });
		expect(reminderTimes(t, { ...defaults, remindByDefault: false }, true)).toEqual([]);
	});

	it("remind: [none]: []", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20T15:00"), remind: [{ kind: "none" }] });
		expect(reminderTimes(t, defaults, true)).toEqual([]);
	});

	it("a date-only anchor uses defaults.timeOfDay before subtracting the offset", () => {
		const t = task({ title: "Buy milk", due: date("2026-09-20"), remind: [{ kind: "offset", minutes: 30 }] });
		const result = reminderTimes(t, defaults, true);
		expect(result[0]?.at).toBe("2026-09-20T08:30");
	});

	it("an offset with no anchor is dropped", () => {
		const t = task({ title: "Buy milk", remind: [{ kind: "offset", minutes: 30 }] });
		expect(reminderTimes(t, defaults, true)).toEqual([]);
	});

	it("an absolute reminder is kept even with no anchor", () => {
		const t = task({ title: "Buy milk", remind: [{ kind: "absolute", at: iso("2026-09-20T09:00") }] });
		const result = reminderTimes(t, defaults, true);
		expect(result).toHaveLength(1);
		expect(result[0]?.at).toBe("2026-09-20T09:00");
		expect(result[0]?.anchor).toBe("absolute");
	});

	it("sorts multiple instances by their fire time", () => {
		const t = task({
			title: "Buy milk",
			due: date("2026-09-20T15:00"),
			remind: [
				{ kind: "offset", minutes: 0 },
				{ kind: "offset", minutes: 60 },
				{ kind: "absolute", at: iso("2026-09-19T09:00") },
			],
		});
		const result = reminderTimes(t, defaults, true);
		expect(result.map((r) => r.at)).toEqual(["2026-09-19T09:00", "2026-09-20T14:00", "2026-09-20T15:00"]);
	});

	it("dedupes identical instances by id (same anchor + spec)", () => {
		const t = task({
			title: "Buy milk",
			due: date("2026-09-20T15:00"),
			remind: [
				{ kind: "offset", minutes: 0 },
				{ kind: "offset", minutes: 0 },
			],
		});
		expect(reminderTimes(t, defaults, true)).toHaveLength(1);
	});
});
