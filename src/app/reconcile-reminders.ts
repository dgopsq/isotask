import type { IsoDateTime } from "@/domain/dates";
import { addMinutes, compareTaskDate } from "@/domain/dates";
import { dueReminders, planReminders, toPushMessage } from "@/domain/reminder-plan";
import type { ReminderId } from "@/domain/reminders";
import type { IsotaskSettings } from "@/domain/settings";
import { findStatus, isTerminal } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";
import type { StatusId } from "@/domain/task";
import type { Clock } from "@/ports/clock";
import type { PushChannel, PushError, PushPublishOptions } from "@/ports/push-channel";
import type { TaskStore } from "@/ports/task-store";

export interface ReconcileRemindersDeps {
	readonly store: TaskStore;
	readonly clock: Clock;
	readonly channel: PushChannel;
	readonly settings: () => IsotaskSettings;
}

export interface ReminderFailure {
	readonly id: ReminderId;
	readonly error: PushError;
}

export type ReconcileOutcome =
	| { readonly kind: "disabled" }
	| { readonly kind: "unreachable"; readonly error: PushError }
	| {
			readonly kind: "reconciled";
			readonly published: number;
			readonly cancelled: number;
			readonly failed: readonly ReminderFailure[];
			/** Effective lookahead in hours after a server-side Delay limit forced a clamp this session; undefined when the setting applies unchanged. */
			readonly clampedLookaheadHours: number | undefined;
	  };

export const MIN_LOOKAHEAD_HOURS = 1;

function isOpenStatus(statuses: readonly StatusConfig[], statusId: StatusId): boolean {
	const found = findStatus(statuses, statusId);
	if (!found.some) {
		return true;
	}
	return !isTerminal(found.value.kind);
}

/** The poll is the ledger. The Delay cap lives in the closure because ntfy exposes no way to read its limit: it is only learned from a 400 in this session. */
export function makeReconcileReminders(deps: ReconcileRemindersDeps): () => Promise<ReconcileOutcome> {
	let sessionCap: number | undefined;
	let inFlight: Promise<ReconcileOutcome> | undefined;

	async function run(): Promise<ReconcileOutcome> {
		const settings = deps.settings();
		if (!settings.reminders.ntfy.enabled) {
			return { kind: "disabled" };
		}

		const now = deps.clock.now();
		const configuredLookahead = settings.reminders.ntfy.lookaheadHours;
		const lookahead = sessionCap === undefined ? configuredLookahead : Math.min(configuredLookahead, sessionCap);
		const catchUp = settings.reminders.catchUpMinutes;

		const listResult = await deps.channel.listKnown({ sinceSeconds: catchUp * 60 + lookahead * 3600 });
		if (!listResult.ok) {
			return { kind: "unreachable", error: listResult.error };
		}

		const tasks = await deps.store.list();
		const tasksWithIsOpen = tasks.map((task) => ({ task, isOpen: isOpenStatus(settings.statuses, task.status) }));
		const due = dueReminders(
			tasksWithIsOpen,
			addMinutes(now, -catchUp) as IsoDateTime,
			addMinutes(now, lookahead * 60) as IsoDateTime,
			{ remindByDefault: settings.reminders.remindByDefault, timeOfDay: settings.reminders.defaultTime },
		);
		const desired = due.map(({ task, reminder }) => toPushMessage(task, reminder));

		const plan = planReminders(desired, listResult.value, now);

		let published = 0;
		const failed: ReminderFailure[] = [];
		let currentCap = lookahead;

		for (const item of plan.publish) {
			const threshold = addMinutes(now, currentCap * 60);
			if (compareTaskDate(item.message.at, threshold) > 0) {
				continue;
			}

			const options: PushPublishOptions | undefined = item.delayUntil === undefined ? undefined : { delayUntil: item.delayUntil };
			const result = await deps.channel.publish(item.message, options);
			if (result.ok) {
				published += 1;
				continue;
			}

			const error = result.error;
			if (item.delayUntil !== undefined && error.kind === "server" && error.status === 400) {
				let outsideNow = false;
				while (!outsideNow && currentCap !== MIN_LOOKAHEAD_HOURS) {
					currentCap = Math.max(MIN_LOOKAHEAD_HOURS, Math.floor(currentCap / 2));
					outsideNow = compareTaskDate(item.message.at, addMinutes(now, currentCap * 60)) > 0;
				}
				if (!outsideNow) {
					failed.push({ id: item.message.id, error });
				}
			} else {
				failed.push({ id: item.message.id, error });
			}
		}

		if (currentCap < lookahead) {
			sessionCap = currentCap;
		}

		let cancelled = 0;
		for (const id of plan.cancel) {
			const result = await deps.channel.cancel(id);
			if (result.ok) {
				cancelled += 1;
			} else {
				failed.push({ id, error: result.error });
			}
		}

		return { kind: "reconciled", published, cancelled, failed, clampedLookaheadHours: sessionCap };
	}

	return async () => {
		if (inFlight !== undefined) {
			return inFlight;
		}
		const promise = run().finally(() => {
			inFlight = undefined;
		});
		inFlight = promise;
		return promise;
	};
}

export type ReconcileReminders = ReturnType<typeof makeReconcileReminders>;
