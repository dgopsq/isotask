import { describe, expect, it } from "vitest";

import { REMINDER_TICK_STATE_KEY, makeFireDueReminders, nextLastTick } from "@/app/fire-due-reminders";
import type { FireDueRemindersDeps } from "@/app/fire-due-reminders";
import { FakeClock, FakeNotifier, FakeTaskStore } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import type { PushMessage } from "@/domain/reminder-plan";
import { DEFAULT_REMINDER_SETTINGS, DEFAULT_SETTINGS } from "@/domain/settings";
import type { ReminderSettings } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { TaskPath } from "@/domain/task";
import type { HapticKind, Haptics } from "@/ports/haptics";
import type { LocalState } from "@/ports/local-state";
import type { PushChannel, PushError } from "@/ports/push-channel";
import type { ReminderId } from "@/domain/reminders";

function path(value: string): TaskPath {
	return value as TaskPath;
}

function iso(value: string): IsoDateTime {
	return value as IsoDateTime;
}

class FakeLocalState implements LocalState {
	private readonly values = new Map<string, unknown>();

	get = (key: string): unknown => this.values.get(key);

	set = (key: string, value: unknown): void => {
		this.values.set(key, value);
	};
}

class FakeHaptics implements Haptics {
	readonly calls: HapticKind[] = [];

	trigger = (kind: HapticKind): void => {
		this.calls.push(kind);
	};
}

/** Records every publish; `failNext` makes exactly one subsequent call return an error. */
class FakePushChannel implements PushChannel {
	readonly publishCalls: PushMessage[] = [];
	private pendingFailure: PushError | undefined;

	failNext(error: PushError = { kind: "network", message: "boom" }): void {
		this.pendingFailure = error;
	}

	publish = async (message: PushMessage): Promise<Result<void, PushError>> => {
		this.publishCalls.push(message);
		if (this.pendingFailure !== undefined) {
			const error = this.pendingFailure;
			this.pendingFailure = undefined;
			return err(error);
		}
		return ok(undefined);
	};

	cancel = async (): Promise<Result<void, PushError>> => ok(undefined);

	listScheduled = async (): Promise<Result<readonly ReminderId[], PushError>> => ok([]);
}

function enabledReminderSettings(overrides: Partial<ReminderSettings> = {}): ReminderSettings {
	return {
		...DEFAULT_REMINDER_SETTINGS,
		...overrides,
		ntfy: { ...DEFAULT_REMINDER_SETTINGS.ntfy, enabled: true, ...(overrides.ntfy ?? {}) },
	};
}

function makeHarness(options: { readonly reminders?: ReminderSettings; readonly isMobile?: boolean; readonly now: string }) {
	const store = new FakeTaskStore({ keys: DEFAULT_PROPERTY_KEYS, statuses: DEFAULT_STATUSES });
	const clock = new FakeClock(iso(options.now), options.now.slice(0, 10) as IsoDate);
	const notifier = new FakeNotifier();
	const haptics = new FakeHaptics();
	const channel = new FakePushChannel();
	const localState = new FakeLocalState();
	const reminders = options.reminders ?? enabledReminderSettings();
	const deps: FireDueRemindersDeps = {
		store,
		clock,
		notifier,
		haptics,
		channel,
		localState,
		settings: () => ({ ...DEFAULT_SETTINGS, reminders }),
		isMobile: options.isMobile ?? false,
	};
	return { store, clock, notifier, haptics, channel, localState, deps, tick: makeFireDueReminders(deps) };
}

describe("makeFireDueReminders", () => {
	it("short-circuits when the ntfy toggle is off, without reading tasks or state", async () => {
		const { deps, store, channel } = makeHarness({ reminders: DEFAULT_REMINDER_SETTINGS, now: "2026-09-20T09:00" });
		let listCalled = false;
		store.list = async () => {
			listCalled = true;
			return [];
		};
		const tick = makeFireDueReminders(deps);

		const outcome = await tick();

		expect(outcome).toEqual({ kind: "disabled" });
		expect(listCalled).toBe(false);
		expect(channel.publishCalls).toEqual([]);
	});

	it("first tick on a device replays nothing", async () => {
		const { store, tick, channel } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T08:30" });

		const outcome = await tick();

		expect(outcome).toEqual({ kind: "ticked", fired: 0, failed: [] });
		expect(channel.publishCalls).toEqual([]);
	});

	it("fires a reminder inside (from, now] and records it in the fired ledger", async () => {
		const { store, clock, tick, channel } = makeHarness({ now: "2026-09-20T08:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T09:00" });

		await tick(); // establishes lastTick at 08:00, nothing due yet
		clock.set(iso("2026-09-20T09:00"), "2026-09-20" as IsoDate);
		const outcome = await tick();

		expect(outcome).toEqual({ kind: "ticked", fired: 1, failed: [] });
		expect(channel.publishCalls).toHaveLength(1);
		expect(channel.publishCalls[0]?.title).toBe("Buy milk");
		expect(channel.publishCalls[0]?.path).toBe(path("Tasks/Buy milk.md"));
	});

	it("does not republish on a second tick with the same clock", async () => {
		const { store, clock, tick, channel } = makeHarness({ now: "2026-09-20T08:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T09:00" });
		await tick();
		clock.set(iso("2026-09-20T09:00"), "2026-09-20" as IsoDate);
		await tick();

		const outcome = await tick();

		expect(outcome).toEqual({ kind: "ticked", fired: 0, failed: [] });
		expect(channel.publishCalls).toHaveLength(1);
	});

	it("fires again when a reminder's anchor moves to a new `at`, keeping the same id", async () => {
		const { store, clock, tick, channel } = makeHarness({ now: "2026-09-20T08:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T09:00" });
		await tick();
		clock.set(iso("2026-09-20T09:00"), "2026-09-20" as IsoDate);
		await tick();

		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T10:00" });
		clock.set(iso("2026-09-20T10:00"), "2026-09-20" as IsoDate);
		const outcome = await tick();

		expect(outcome).toEqual({ kind: "ticked", fired: 1, failed: [] });
		expect(channel.publishCalls).toHaveLength(2);
		expect(channel.publishCalls[0]?.id).toBe(channel.publishCalls[1]?.id);
		expect(channel.publishCalls[1]?.at).toBe("2026-09-20T10:00");
	});

	it("caps catch-up replay to catchUpMinutes, ignoring older misses", async () => {
		const reminders = enabledReminderSettings({ catchUpMinutes: 60 });
		const { store, localState, tick, channel } = makeHarness({ now: "2026-09-20T09:00", reminders });
		localState.set(REMINDER_TICK_STATE_KEY, { lastTick: "2026-09-17T09:00", fired: {} });
		store.seed(path("Tasks/Old.md"), { type: "task", status: "todo", due: "2026-09-20T07:00" }); // outside the 60-minute cap
		store.seed(path("Tasks/Recent.md"), { type: "task", status: "todo", due: "2026-09-20T08:30" }); // inside it

		const outcome = await tick();

		expect(outcome).toEqual({ kind: "ticked", fired: 1, failed: [] });
		expect(channel.publishCalls).toHaveLength(1);
		expect(channel.publishCalls[0]?.title).toBe("Recent");
	});

	it("never fires a reminder for a done task", async () => {
		const { store, tick, channel } = makeHarness({ now: "2026-09-20T09:00" });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "done", due: "2026-09-20T08:30" });

		const outcome = await tick();

		expect(outcome).toEqual({ kind: "ticked", fired: 0, failed: [] });
		expect(channel.publishCalls).toEqual([]);
	});

	it("keeps lastTick on failure so the next tick retries, then marks fired on success", async () => {
		const { store, clock, channel, deps } = makeHarness({ now: "2026-09-20T08:00" });
		const tick = makeFireDueReminders(deps);
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T09:00" });
		await tick(); // lastTick -> 08:00, nothing due

		clock.set(iso("2026-09-20T09:00"), "2026-09-20" as IsoDate);
		channel.failNext();
		const failedOutcome = await tick();
		expect(failedOutcome.kind).toBe("ticked");
		expect(failedOutcome.kind === "ticked" && failedOutcome.failed).toHaveLength(1);
		expect(channel.publishCalls).toHaveLength(1);

		const retryOutcome = await tick();

		expect(retryOutcome).toEqual({ kind: "ticked", fired: 1, failed: [] });
		expect(channel.publishCalls).toHaveLength(2);
	});

	it("on mobile, notifies and haptics instead of publishing", async () => {
		const { store, clock, notifier, haptics, channel, tick } = makeHarness({ now: "2026-09-20T08:00", isMobile: true });
		store.seed(path("Tasks/Buy milk.md"), { type: "task", status: "todo", due: "2026-09-20T09:00" });
		await tick(); // establishes lastTick, nothing due yet
		clock.set(iso("2026-09-20T09:00"), "2026-09-20" as IsoDate);

		const outcome = await tick();

		expect(outcome).toEqual({ kind: "ticked", fired: 1, failed: [] });
		expect(channel.publishCalls).toEqual([]);
		expect(notifier.infoMessages).toHaveLength(1);
		expect(notifier.infoMessages[0]).toContain("Buy milk");
		expect(haptics.calls).toEqual(["success"]);
	});

	it("prunes fired-ledger entries older than the catch-up window", async () => {
		const { localState, tick } = makeHarness({ now: "2026-09-20T09:00" });
		localState.set(REMINDER_TICK_STATE_KEY, {
			lastTick: "2026-09-20T08:45",
			fired: { "stale@2026-09-19T00:00": "2026-09-19T00:00", "fresh@2026-09-20T08:30": "2026-09-20T08:30" },
		});

		await tick();

		const state = localState.get(REMINDER_TICK_STATE_KEY) as { readonly fired: Readonly<Record<string, string>> };
		expect(state.fired["stale@2026-09-19T00:00"]).toBeUndefined();
		expect(state.fired["fresh@2026-09-20T08:30"]).toBe("2026-09-20T08:30");
	});

	it("tolerates garbage local state instead of throwing", async () => {
		const { localState, tick, channel } = makeHarness({ now: "2026-09-20T09:00" });
		localState.set(REMINDER_TICK_STATE_KEY, "not even an object");

		const outcome = await tick();

		expect(outcome.kind).toBe("ticked");
		expect(channel.publishCalls).toEqual([]);
	});
});

describe("nextLastTick", () => {
	it("advances to now on full success", () => {
		expect(nextLastTick(iso("2026-09-20T08:00"), iso("2026-09-20T09:00"), iso("2026-09-20T08:00"), false)).toBe(
			"2026-09-20T09:00",
		);
	});

	it("holds at the previous lastTick on failure so the miss is retried", () => {
		expect(nextLastTick(iso("2026-09-20T08:00"), iso("2026-09-20T09:00"), iso("2026-09-20T08:00"), true)).toBe(
			"2026-09-20T08:00",
		);
	});

	it("falls back to catchUpStart on a first-tick failure (no previous lastTick)", () => {
		expect(nextLastTick(undefined, iso("2026-09-20T09:00"), iso("2026-09-20T08:00"), true)).toBe(
			"2026-09-20T08:00",
		);
	});
});
