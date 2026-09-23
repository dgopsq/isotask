import { describe, expect, it } from "vitest";

import type { IsoDateTime } from "@/domain/dates";
import { firedKey, pruneFired, remindersToShow } from "@/domain/desktop-reminders";
import type { FiredReminder } from "@/domain/desktop-reminders";
import type { ReminderId, ReminderInstance } from "@/domain/reminders";

function iso(value: string): IsoDateTime {
	return value as IsoDateTime;
}

function id(value: string): ReminderId {
	return value as ReminderId;
}

function instance(reminderId: string, at: string): ReminderInstance {
	return { id: id(reminderId), at: iso(at), anchor: "due", spec: { kind: "offset", minutes: 0 } };
}

describe("firedKey", () => {
	it("combines id and fire time so a rescheduled reminder gets a different key", () => {
		expect(firedKey(id("isotask-a"), iso("2026-09-20T09:00"))).toBe("isotask-a@2026-09-20T09:00");
		expect(firedKey(id("isotask-a"), iso("2026-09-21T09:00"))).not.toBe(firedKey(id("isotask-a"), iso("2026-09-20T09:00")));
	});
});

describe("remindersToShow", () => {
	it("excludes a due item already recorded as fired", () => {
		const due = [{ reminder: instance("isotask-a", "2026-09-20T09:00") }];
		const fired: readonly FiredReminder[] = [{ key: firedKey(id("isotask-a"), iso("2026-09-20T09:00")), at: iso("2026-09-20T09:00") }];

		expect(remindersToShow(due, fired)).toEqual([]);
	});

	it("keeps a due item whose fire time changed even though its id was fired before", () => {
		const due = [{ reminder: instance("isotask-a", "2026-09-21T09:00") }];
		const fired: readonly FiredReminder[] = [{ key: firedKey(id("isotask-a"), iso("2026-09-20T09:00")), at: iso("2026-09-20T09:00") }];

		expect(remindersToShow(due, fired)).toEqual(due);
	});

	it("keeps a due item with no matching ledger entry", () => {
		const due = [{ reminder: instance("isotask-a", "2026-09-20T09:00") }];

		expect(remindersToShow(due, [])).toEqual(due);
	});
});

describe("pruneFired", () => {
	it("drops entries at or before the cutoff", () => {
		const fired: readonly FiredReminder[] = [
			{ key: "old", at: iso("2026-09-19T09:00") },
			{ key: "boundary", at: iso("2026-09-20T08:00") },
			{ key: "recent", at: iso("2026-09-20T08:30") },
		];

		expect(pruneFired(fired, iso("2026-09-20T08:00"))).toEqual([{ key: "recent", at: iso("2026-09-20T08:30") }]);
	});

	it("keeps every entry when none are old enough to prune", () => {
		const fired: readonly FiredReminder[] = [{ key: "recent", at: iso("2026-09-20T09:00") }];

		expect(pruneFired(fired, iso("2026-09-20T08:00"))).toEqual(fired);
	});
});
