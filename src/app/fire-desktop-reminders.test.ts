import { describe, expect, it } from "vitest";

import type { FireDesktopRemindersDeps } from "@/app/fire-desktop-reminders";
import { makeFireDesktopReminders } from "@/app/fire-desktop-reminders";
import { FakeClock, FakeFiredReminderLedger, FakeSystemNotifier, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_REMINDER_SETTINGS, DEFAULT_SETTINGS } from "@/domain/settings";
import type { ReminderSettings } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { TaskPath } from "@/domain/task";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function iso(value: string): IsoDateTime {
	return value as IsoDateTime;
}

function reminderSettings(overrides: Partial<ReminderSettings> = {}): ReminderSettings {
	return { ...DEFAULT_REMINDER_SETTINGS, desktopNotifications: true, ...overrides };
}

function makeHarness(options: { readonly reminders?: ReminderSettings; readonly now: string }) {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock(iso(options.now), options.now.slice(0, 10) as IsoDate);
	const notifier = new FakeSystemNotifier();
	const ledger = new FakeFiredReminderLedger();
	const opened: TaskPath[] = [];
	const reminders = options.reminders ?? reminderSettings();
	const deps: FireDesktopRemindersDeps = {
		store,
		clock,
		notifier,
		ledger,
		settings: () => ({ ...DEFAULT_SETTINGS, reminders }),
		openTask: (p) => {
			opened.push(p);
		},
	};
	return { store, clock, notifier, ledger, opened, deps, fire: makeFireDesktopReminders(deps) };
}

describe("makeFireDesktopReminders", () => {
	it("returns 0 without touching the store when the setting is off", async () => {
		const { store, fire } = makeHarness({ reminders: DEFAULT_REMINDER_SETTINGS, now: "2026-09-20T09:00" });
		let listCalled = false;
		store.list = async () => {
			listCalled = true;
			return [];
		};

		expect(await fire()).toBe(0);
		expect(listCalled).toBe(false);
	});

	it("returns 0 without touching the store when the notifier is unavailable", async () => {
		const { store, notifier, fire } = makeHarness({ now: "2026-09-20T09:00" });
		notifier.setAvailable(false);
		let listCalled = false;
		store.list = async () => {
			listCalled = true;
			return [];
		};

		expect(await fire()).toBe(0);
		expect(listCalled).toBe(false);
	});

	it("shows a due reminder once and opens the task on click", async () => {
		const { store, notifier, opened, fire } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T08:40" });

		expect(await fire()).toBe(1);
		expect(notifier.shown).toHaveLength(1);
		expect(notifier.shown[0]?.notification.title).toBe("Buy milk");

		notifier.shown[0]?.onClick();
		expect(opened).toEqual([path("Tasks/Buy milk.md")]);
	});

	it("does not re-show a reminder already fired", async () => {
		const { store, notifier, fire } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T08:40" });

		expect(await fire()).toBe(1);
		expect(await fire()).toBe(0);
		expect(notifier.shown).toHaveLength(1);
	});

	it("fires again when the reminder is rescheduled to a new time", async () => {
		const { store, clock, notifier, fire } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T08:40" });

		expect(await fire()).toBe(1);

		clock.set(iso("2026-09-20T10:00"), "2026-09-20" as IsoDate);
		await store.updateProperties(path("Tasks/Buy milk.md"), { due: "2026-09-20T09:50" });

		expect(await fire()).toBe(1);
		expect(notifier.shown).toHaveLength(2);
	});

	it("does not fire a reminder outside the catch-up window", async () => {
		const { store, fire } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Old.md"), { type: "task", status: "todo", due: "2026-09-18T09:00" });

		expect(await fire()).toBe(0);
	});

	it("does not fire a reminder for a closed task", async () => {
		const { store, fire } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Done.md"), { type: "task", status: "done", due: "2026-09-20T08:40" });

		expect(await fire()).toBe(0);
	});

	it("single-flights concurrent calls", async () => {
		const { store, notifier, deps } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T08:40" });
		let resolveList: (() => void) | undefined;
		store.list = async () =>
			new Promise((resolve) => {
				resolveList = () => {
					resolve([]);
				};
			});
		const fire = makeFireDesktopReminders(deps);

		const first = fire();
		const second = fire();
		resolveList?.();
		const [firstCount, secondCount] = await Promise.all([first, second]);

		expect(firstCount).toBe(secondCount);
		expect(notifier.shown).toEqual([]);
	});
});
