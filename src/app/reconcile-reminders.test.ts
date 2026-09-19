import { describe, expect, it } from "vitest";

import { MIN_LOOKAHEAD_HOURS, makeReconcileReminders } from "@/app/reconcile-reminders";
import type { ReconcileRemindersDeps } from "@/app/reconcile-reminders";
import { FakeClock, FakePushChannel, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import type { KnownReminder } from "@/domain/reminder-plan";
import { reminderId } from "@/domain/reminders";
import type { ReminderId } from "@/domain/reminders";
import { ok } from "@/domain/result";
import type { Result } from "@/domain/result";
import { DEFAULT_REMINDER_SETTINGS, DEFAULT_SETTINGS } from "@/domain/settings";
import type { NtfySettings, ReminderSettings } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { TaskPath } from "@/domain/task";
import type { PushError, PushListOptions } from "@/ports/push-channel";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function iso(value: string): IsoDateTime {
	return value as IsoDateTime;
}

function id(value: string): ReminderId {
	return value as ReminderId;
}

function reminderSettings(overrides: Partial<Omit<ReminderSettings, "ntfy">> & { readonly ntfy?: Partial<NtfySettings> } = {}): ReminderSettings {
	return {
		...DEFAULT_REMINDER_SETTINGS,
		...overrides,
		ntfy: { ...DEFAULT_REMINDER_SETTINGS.ntfy, enabled: true, ...(overrides.ntfy ?? {}) },
	};
}

function makeHarness(options: { readonly reminders?: ReminderSettings; readonly now: string }) {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock(iso(options.now), options.now.slice(0, 10) as IsoDate);
	const channel = new FakePushChannel();
	const reminders = options.reminders ?? reminderSettings();
	const deps: ReconcileRemindersDeps = {
		store,
		clock,
		channel,
		settings: () => ({ ...DEFAULT_SETTINGS, reminders }),
	};
	return { store, clock, channel, deps, reconcile: makeReconcileReminders(deps) };
}

const dueOffsetZero = (taskPath: TaskPath) => reminderId(taskPath, "due", { kind: "offset", minutes: 0 });

describe("makeReconcileReminders", () => {
	it("returns disabled when the ntfy toggle is off, without listing or publishing", async () => {
		const { deps, store, channel } = makeHarness({ reminders: DEFAULT_REMINDER_SETTINGS, now: "2026-09-20T09:00" });
		let listCalled = false;
		store.list = async () => {
			listCalled = true;
			return [];
		};
		const reconcile = makeReconcileReminders(deps);

		const outcome = await reconcile();

		expect(outcome).toEqual({ kind: "disabled" });
		expect(listCalled).toBe(false);
		expect(channel.listCalls).toEqual([]);
		expect(channel.publishCalls).toEqual([]);
	});

	it("returns unreachable on a listKnown failure, without touching the store or publishing", async () => {
		const { store, channel, reconcile } = makeHarness({ now: "2026-09-20T09:00" });
		let listCalled = false;
		store.list = async () => {
			listCalled = true;
			return [];
		};
		channel.failListWith({ kind: "network", message: "down" });

		const outcome = await reconcile();

		expect(outcome).toEqual({ kind: "unreachable", error: { kind: "network", message: "down" } });
		expect(listCalled).toBe(false);
		expect(channel.publishCalls).toEqual([]);
		expect(channel.cancelCalls).toEqual([]);
	});

	it("polls listKnown with sinceSeconds = catchUpMinutes*60 + lookaheadHours*3600", async () => {
		const reminders = reminderSettings({ catchUpMinutes: 45, ntfy: { lookaheadHours: 10 } });
		const { channel, reconcile } = makeHarness({ now: "2026-09-20T09:00", reminders });

		await reconcile();

		expect(channel.listCalls).toEqual([{ sinceSeconds: 45 * 60 + 10 * 3600 }]);
	});

	it("publishes a delayed message for a reminder due within the lookahead window", async () => {
		const { store, channel, reconcile } = makeHarness({ now: "2026-09-20T08:00" });
		store.seed(path("Tasks/Trip.md"), { type: "task", status: "todo", due: "2026-09-20T10:00" });

		const outcome = await reconcile();

		expect(outcome).toEqual({ kind: "reconciled", published: 1, cancelled: 0, failed: [], clampedLookaheadHours: undefined });
		expect(channel.publishCalls).toHaveLength(1);
		expect(channel.publishCalls[0]?.options).toEqual({ delayUntil: iso("2026-09-20T10:00") });
	});

	it("publishes immediately (no delayUntil) for a reminder inside the catch-up window", async () => {
		const { store, channel, reconcile } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T08:40" });

		const outcome = await reconcile();

		expect(outcome).toEqual({ kind: "reconciled", published: 1, cancelled: 0, failed: [], clampedLookaheadHours: undefined });
		expect(channel.publishCalls).toHaveLength(1);
		expect(channel.publishCalls[0]?.options).toBeUndefined();
	});

	it("excludes a reminder older than catchUpMinutes and one beyond the lookahead window", async () => {
		const { store, channel, reconcile } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Old.md"), { type: "task", status: "todo", due: "2026-09-18T09:00" }); // 2 days ago, catch-up is 60 min
		store.seed(path("Tasks/Far.md"), { type: "task", status: "todo", due: "2026-09-30T09:00" }); // beyond the default 72h lookahead

		const outcome = await reconcile();

		expect(outcome).toEqual({ kind: "reconciled", published: 0, cancelled: 0, failed: [], clampedLookaheadHours: undefined });
		expect(channel.publishCalls).toEqual([]);
	});

	it("does not republish when the server already knows the reminder at the same time", async () => {
		const { store, channel, reconcile } = makeHarness({ now: "2026-09-20T08:00" });
		store.seed(path("Tasks/Trip.md"), { type: "task", status: "todo", due: "2026-09-20T10:00" });
		channel.known = [{ id: dueOffsetZero(path("Tasks/Trip.md")), at: iso("2026-09-20T10:00") }];

		const outcome = await reconcile();

		expect(outcome).toEqual({ kind: "reconciled", published: 0, cancelled: 0, failed: [], clampedLookaheadHours: undefined });
	});

	it("cancels a known future reminder that no task desires", async () => {
		const { channel, reconcile } = makeHarness({ now: "2026-09-20T09:00" });
		channel.known = [{ id: id("isotask-orphan"), at: iso("2026-09-21T09:00") }];

		const outcome = await reconcile();

		expect(outcome).toEqual({ kind: "reconciled", published: 0, cancelled: 1, failed: [], clampedLookaheadHours: undefined });
		expect(channel.cancelCalls).toEqual([id("isotask-orphan")]);
	});

	it("records a cancel failure without crediting a cancellation", async () => {
		const { channel, reconcile } = makeHarness({ now: "2026-09-20T09:00" });
		channel.known = [{ id: id("isotask-orphan"), at: iso("2026-09-21T09:00") }];
		channel.failCancelWith({ kind: "network", message: "boom" });

		const outcome = await reconcile();

		expect(outcome).toEqual({
			kind: "reconciled",
			published: 0,
			cancelled: 0,
			failed: [{ id: id("isotask-orphan"), error: { kind: "network", message: "boom" } }],
			clampedLookaheadHours: undefined,
		});
	});

	it("keeps going after a publish failure (sequential, no short-circuit)", async () => {
		const { store, channel, reconcile } = makeHarness({ now: "2026-09-20T08:00" });
		store.seed(path("Tasks/A.md"), { type: "task", status: "todo", due: "2026-09-20T10:00" });
		store.seed(path("Tasks/B.md"), { type: "task", status: "todo", due: "2026-09-20T11:00" });
		channel.failNext({ kind: "network", message: "boom" });

		const outcome = await reconcile();

		expect(outcome.kind).toBe("reconciled");
		expect(outcome).toEqual({
			kind: "reconciled",
			published: 1,
			cancelled: 0,
			failed: [{ id: dueOffsetZero(path("Tasks/A.md")), error: { kind: "network", message: "boom" } }],
			clampedLookaheadHours: undefined,
		});
		expect(channel.publishCalls).toHaveLength(2);
	});

	it("cancels a done task's known reminder without publishing anything for it", async () => {
		const { store, channel, reconcile } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "done", due: "2026-09-20T10:00" });
		channel.known = [{ id: dueOffsetZero(path("Tasks/Buy milk.md")), at: iso("2026-09-20T10:00") }];

		const outcome = await reconcile();

		expect(outcome).toEqual({ kind: "reconciled", published: 0, cancelled: 1, failed: [], clampedLookaheadHours: undefined });
	});

	it("cancels a capability-check probe reminder id left on the server", async () => {
		const { channel, reconcile } = makeHarness({ now: "2026-09-20T09:00" });
		channel.known = [{ id: id("isotask-test"), at: iso("2026-09-21T09:00") }];

		const outcome = await reconcile();

		expect(outcome).toEqual({ kind: "reconciled", published: 0, cancelled: 1, failed: [], clampedLookaheadHours: undefined });
	});

	it("clamps the session lookahead after a server 400 on a delayed publish, skipping items beyond the new cap", async () => {
		const reminders = reminderSettings({ ntfy: { lookaheadHours: 72 } });
		const { store, channel, reconcile } = makeHarness({ now: "2026-09-20T00:00", reminders });
		store.seed(path("Tasks/Near.md"), { type: "task", status: "todo", due: "2026-09-20T10:00" }); // +10h
		store.seed(path("Tasks/Mid.md"), { type: "task", status: "todo", due: "2026-09-21T06:00" }); // +30h
		store.seed(path("Tasks/Far.md"), { type: "task", status: "todo", due: "2026-09-22T02:00" }); // +50h
		channel.rejectDelaysBeyond(iso("2026-09-21T00:00")); // now + 24h

		const outcome = await reconcile();

		expect(outcome).toEqual({ kind: "reconciled", published: 1, cancelled: 0, failed: [], clampedLookaheadHours: 18 });
		expect(channel.publishCalls).toHaveLength(2); // Near succeeds, Mid gets the 400; Far is never requested
		expect(channel.publishCalls[0]?.message.path).toBe(path("Tasks/Near.md"));
		expect(channel.publishCalls[1]?.message.path).toBe(path("Tasks/Mid.md"));

		channel.listCalls.length = 0;
		channel.publishCalls.length = 0;
		await reconcile();

		expect(channel.listCalls[0]).toEqual({ sinceSeconds: 60 * 60 + 18 * 3600 });
		expect(channel.publishCalls.some((call) => call.message.path === path("Tasks/Mid.md"))).toBe(false);
	});

	it("floors the session cap at MIN_LOOKAHEAD_HOURS and still counts the reminder as failed once it stays inside", async () => {
		const { store, channel, reconcile } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Soon.md"), { type: "task", status: "todo", due: "2026-09-20T09:30" });
		channel.rejectDelaysBeyond(iso("2026-09-20T09:00"));

		const outcome = await reconcile();

		expect(outcome).toEqual({
			kind: "reconciled",
			published: 0,
			cancelled: 0,
			failed: [{ id: dueOffsetZero(path("Tasks/Soon.md")), error: { kind: "server", status: 400, message: "delay too far" } }],
			clampedLookaheadHours: MIN_LOOKAHEAD_HOURS,
		});
	});

	it("single-flights: a call made while one is in flight returns the same outcome without polling twice", async () => {
		const { channel, deps } = makeHarness({ now: "2026-09-20T09:00" });
		let resolveList: ((value: Result<readonly KnownReminder[], PushError>) => void) | undefined;
		channel.listKnown = async (options: PushListOptions) => {
			channel.listCalls.push(options);
			return new Promise((resolve) => {
				resolveList = resolve;
			});
		};
		const reconcile = makeReconcileReminders(deps);

		const first = reconcile();
		const second = reconcile();
		resolveList?.(ok([]));
		const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

		expect(firstOutcome).toBe(secondOutcome);
		expect(channel.listCalls).toHaveLength(1);
	});
});
