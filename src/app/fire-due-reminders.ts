import * as v from "valibot";

import type { IsoDateTime } from "@/domain/dates";
import { addMinutes, compareTaskDate } from "@/domain/dates";
import { dueReminders, toPushMessage } from "@/domain/reminder-plan";
import type { ReminderId } from "@/domain/reminders";
import type { IsotaskSettings } from "@/domain/settings";
import { findStatus, isTerminal } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";
import type { StatusId } from "@/domain/task";
import type { Clock } from "@/ports/clock";
import type { Haptics } from "@/ports/haptics";
import type { LocalState } from "@/ports/local-state";
import type { Notifier } from "@/ports/notifier";
import type { PushChannel, PushError } from "@/ports/push-channel";
import type { TaskStore } from "@/ports/task-store";

export interface FireDueRemindersDeps {
	readonly store: TaskStore;
	readonly clock: Clock;
	readonly notifier: Notifier;
	readonly haptics: Haptics;
	readonly channel: PushChannel;
	readonly localState: LocalState;
	readonly settings: () => IsotaskSettings;
	/** Mobile has no background push target of its own: it shows a Notice instead of publishing. */
	readonly isMobile: boolean;
}

export type FireOutcome =
	| { readonly kind: "disabled" }
	| {
			readonly kind: "ticked";
			readonly fired: number;
			readonly failed: readonly { readonly id: ReminderId; readonly error: PushError }[];
	  };

export const REMINDER_TICK_STATE_KEY = "isotask-reminder-tick";

interface ReminderTickState {
	readonly lastTick?: IsoDateTime;
	readonly fired: Readonly<Record<string, IsoDateTime>>;
}

const ReminderTickStateSchema = v.fallback(
	v.object({
		lastTick: v.optional(v.string()),
		fired: v.fallback(v.record(v.string(), v.string()), {}),
	}),
	{ lastTick: undefined, fired: {} },
);

/** Tolerates hand-edited/corrupt local storage: any shape mismatch just replays from `now` with an empty ledger. */
function parseState(raw: unknown): ReminderTickState {
	const parsed = v.parse(ReminderTickStateSchema, raw);
	return parsed.lastTick === undefined
		? { fired: parsed.fired as Record<string, IsoDateTime> }
		: { lastTick: parsed.lastTick as IsoDateTime, fired: parsed.fired as Record<string, IsoDateTime> };
}

function isOpenStatus(statuses: readonly StatusConfig[], statusId: StatusId): boolean {
	const found = findStatus(statuses, statusId);
	if (!found.some) {
		return true;
	}
	return !isTerminal(found.value.kind);
}

/** Advances to `now` on success; on failure holds at `previous` (or `catchUpStart` with no prior tick) so the miss stays inside the next window. */
export function nextLastTick(
	previous: IsoDateTime | undefined,
	now: IsoDateTime,
	catchUpStart: IsoDateTime,
	anyFailed: boolean,
): IsoDateTime {
	if (!anyFailed) {
		return now;
	}
	return previous ?? catchUpStart;
}

/** One reminder tick: `catchUpMinutes` caps the replay window, and the `id@at` ledger key lets a moved anchor fire again. */
export function makeFireDueReminders(deps: FireDueRemindersDeps): () => Promise<FireOutcome> {
	return async () => {
		const settings = deps.settings();
		if (!settings.reminders.ntfy.enabled) {
			return { kind: "disabled" };
		}

		const state = parseState(deps.localState.get(REMINDER_TICK_STATE_KEY));
		const now = deps.clock.now();
		const catchUpStart = addMinutes(now, -settings.reminders.catchUpMinutes) as IsoDateTime;
		const from =
			state.lastTick === undefined
				? now
				: compareTaskDate(state.lastTick, catchUpStart) > 0
					? state.lastTick
					: catchUpStart;

		const tasks = await deps.store.list();
		const tasksWithIsOpen = tasks.map((task) => ({ task, isOpen: isOpenStatus(settings.statuses, task.status) }));
		const due = dueReminders(tasksWithIsOpen, from, now, {
			remindByDefault: settings.reminders.remindByDefault,
			timeOfDay: settings.reminders.defaultTime,
		});

		const fired: Record<string, IsoDateTime> = { ...state.fired };
		const failed: { readonly id: ReminderId; readonly error: PushError }[] = [];
		let firedCount = 0;

		for (const { task, reminder } of due) {
			const key = `${reminder.id}@${reminder.at}`;
			if (key in fired) {
				continue;
			}

			if (deps.isMobile) {
				const message = toPushMessage(task, reminder);
				deps.notifier.info(`${task.title} — ${message.body}`);
				deps.haptics.trigger("success");
				fired[key] = reminder.at;
				firedCount += 1;
				continue;
			}

			const result = await deps.channel.publish(toPushMessage(task, reminder));
			if (result.ok) {
				fired[key] = reminder.at;
				firedCount += 1;
			} else {
				failed.push({ id: reminder.id, error: result.error });
			}
		}

		const prunedFired: Record<string, IsoDateTime> = {};
		for (const [key, at] of Object.entries(fired)) {
			if (compareTaskDate(at, catchUpStart) > 0) {
				prunedFired[key] = at;
			}
		}

		deps.localState.set(REMINDER_TICK_STATE_KEY, {
			lastTick: nextLastTick(state.lastTick, now, catchUpStart, failed.length > 0),
			fired: prunedFired,
		});

		return { kind: "ticked", fired: firedCount, failed };
	};
}

export type FireDueReminders = ReturnType<typeof makeFireDueReminders>;
