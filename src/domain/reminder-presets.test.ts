import { describe, expect, it } from "vitest";

import type { IsoDateTime, TaskDate } from "@/domain/dates";
import {
	canonicalRemindValue,
	describeReminderSpec,
	describeReminders,
	matchReminderPreset,
	offsetMinutes,
	offsetParts,
	REMINDER_PRESETS,
} from "@/domain/reminder-presets";
import type { ReminderSpec } from "@/domain/reminders";

function offset(minutes: number): ReminderSpec {
	return { kind: "offset", minutes };
}

describe("offsetParts / offsetMinutes", () => {
	it("picks the largest evenly-dividing unit", () => {
		expect(offsetParts(0)).toEqual({ amount: 0, unit: "m" });
		expect(offsetParts(15)).toEqual({ amount: 15, unit: "m" });
		expect(offsetParts(60)).toEqual({ amount: 1, unit: "h" });
		expect(offsetParts(120)).toEqual({ amount: 2, unit: "h" });
		expect(offsetParts(1440)).toEqual({ amount: 1, unit: "d" });
		expect(offsetParts(4320)).toEqual({ amount: 3, unit: "d" });
		expect(offsetParts(10080)).toEqual({ amount: 1, unit: "w" });
		expect(offsetParts(20160)).toEqual({ amount: 2, unit: "w" });
	});

	it("is the inverse of offsetMinutes", () => {
		expect(offsetMinutes(15, "m")).toBe(15);
		expect(offsetMinutes(1, "h")).toBe(60);
		expect(offsetMinutes(1, "d")).toBe(1440);
		expect(offsetMinutes(2, "w")).toBe(20160);
	});
});

describe("describeReminderSpec", () => {
	it("describes none", () => {
		expect(describeReminderSpec({ kind: "none" })).toBe("None");
	});

	it("describes an at-time offset", () => {
		expect(describeReminderSpec(offset(0))).toBe("At time");
	});

	it("describes minute offsets without pluralising the unit", () => {
		expect(describeReminderSpec(offset(15))).toBe("15 min before");
		expect(describeReminderSpec(offset(45))).toBe("45 min before");
	});

	it("describes hour offsets, singular and plural", () => {
		expect(describeReminderSpec(offset(60))).toBe("1 hour before");
		expect(describeReminderSpec(offset(120))).toBe("2 hours before");
	});

	it("describes day offsets, singular and plural", () => {
		expect(describeReminderSpec(offset(1440))).toBe("1 day before");
		expect(describeReminderSpec(offset(4320))).toBe("3 days before");
	});

	it("describes week offsets, singular and plural", () => {
		expect(describeReminderSpec(offset(10080))).toBe("1 week before");
		expect(describeReminderSpec(offset(20160))).toBe("2 weeks before");
	});

	it("describes an absolute spec as the ISO datetime with a space", () => {
		expect(describeReminderSpec({ kind: "absolute", at: "2026-09-20T15:00" as IsoDateTime })).toBe("2026-09-20 15:00");
	});

	it("every preset's label equals describeReminderSpec of its one spec", () => {
		for (const preset of REMINDER_PRESETS) {
			expect(preset.specs).toHaveLength(1);
			const [spec] = preset.specs;
			expect(spec).toBeDefined();
			if (spec !== undefined) {
				expect(preset.label).toBe(describeReminderSpec(spec));
			}
		}
	});
});

describe("describeReminders", () => {
	const anchor = "2026-09-20" as TaskDate;

	it("returns None for an empty list", () => {
		expect(describeReminders([], anchor)).toBe("None");
	});

	it("returns None when any spec is none", () => {
		expect(describeReminders([offset(15), { kind: "none" }], anchor)).toBe("None");
	});

	it("joins multiple specs in order", () => {
		expect(describeReminders([offset(0), offset(15)], anchor)).toBe("At time, 15 min before");
	});

	it("appends a no-anchor suffix when there is no date and an offset is present", () => {
		expect(describeReminders([offset(15)], undefined)).toBe("15 min before (no date to remind on)");
	});

	it("does not append the no-anchor suffix for an absolute-only list", () => {
		const absolute: ReminderSpec = { kind: "absolute", at: "2026-09-20T15:00" as IsoDateTime };
		expect(describeReminders([absolute], undefined)).toBe("2026-09-20 15:00");
	});
});

describe("matchReminderPreset", () => {
	it("matches an exact single-spec list", () => {
		expect(matchReminderPreset([offset(1440)])?.id).toBe("1d");
		expect(matchReminderPreset([{ kind: "none" }])?.id).toBe("none");
	});

	it("matches by canonical text, not raw minutes", () => {
		expect(matchReminderPreset([offset(60)])?.id).toBe("1h");
	});

	it("is order sensitive and does not match duplicated entries", () => {
		expect(matchReminderPreset([offset(60), offset(60)])).toBeUndefined();
	});

	it("returns undefined for a multi-entry list", () => {
		expect(matchReminderPreset([offset(0), offset(15)])).toBeUndefined();
	});

	it("returns undefined for an unmatched offset", () => {
		expect(matchReminderPreset([offset(30)])).toBeUndefined();
	});
});

describe("canonicalRemindValue", () => {
	it("returns an empty list for an empty input", () => {
		expect(canonicalRemindValue([])).toEqual([]);
	});

	it("collapses any none to [\"none\"]", () => {
		expect(canonicalRemindValue([offset(15), { kind: "none" }])).toEqual(["none"]);
	});

	it("formats and dedupes by canonical text, keeping first-seen order", () => {
		expect(canonicalRemindValue([offset(60), offset(60)])).toEqual(["1h"]);
		expect(canonicalRemindValue([offset(1440), offset(15)])).toEqual(["1d", "15m"]);
	});
});
