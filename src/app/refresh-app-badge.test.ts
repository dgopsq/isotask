import { describe, expect, it } from "vitest";

import { makeRefreshAppBadge } from "@/app/refresh-app-badge";
import { FakeAppBadge, FakeClock, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_REMINDER_SETTINGS, DEFAULT_SETTINGS } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function makeHarness(options: { readonly appBadge: boolean }) {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock("2026-09-20T09:00" as IsoDateTime, "2026-09-20" as IsoDate);
	const badge = new FakeAppBadge();
	const settings = { ...DEFAULT_SETTINGS, reminders: { ...DEFAULT_REMINDER_SETTINGS, appBadge: options.appBadge } };
	const refresh = makeRefreshAppBadge({ store, clock, badge, settings: () => settings });
	return { store, badge, refresh };
}

describe("makeRefreshAppBadge", () => {
	it("does nothing when the badge is unavailable", async () => {
		const { store, badge, refresh } = makeHarness({ appBadge: true });
		badge.setAvailable(false);
		badge.count = 7;
		let listCalled = false;
		store.list = async () => {
			listCalled = true;
			return [];
		};

		await refresh();

		expect(badge.count).toBe(7);
		expect(listCalled).toBe(false);
	});

	it("clears the badge without listing when the setting is off", async () => {
		const { store, badge, refresh } = makeHarness({ appBadge: false });
		badge.count = 3;
		let listCalled = false;
		store.list = async () => {
			listCalled = true;
			return [];
		};

		await refresh();

		expect(badge.count).toBeUndefined();
		expect(listCalled).toBe(false);
	});

	it("sets the count of open overdue and due-today tasks", async () => {
		const { store, badge, refresh } = makeHarness({ appBadge: true });
		store.seed(path("overdue.md"), { type: "task", due: "2026-09-10" });
		store.seed(path("today.md"), { type: "task", due: "2026-09-20T18:00" });
		store.seed(path("future.md"), { type: "task", due: "2026-09-25" });
		store.seed(path("done.md"), { type: "task", due: "2026-09-10", status: "done" });
		store.seed(path("no-due.md"), { type: "task" });

		await refresh();

		expect(badge.count).toBe(2);
	});

	it("passes a zero count through to the badge", async () => {
		const { store, badge, refresh } = makeHarness({ appBadge: true });
		store.seed(path("future.md"), { type: "task", due: "2026-09-25" });
		badge.count = 5;

		await refresh();

		expect(badge.count).toBe(0);
	});
});
