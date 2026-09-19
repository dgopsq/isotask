import { addMinutes } from "@/domain/dates";
import type { IsoDateTime } from "@/domain/dates";
import type { ReminderId } from "@/domain/reminders";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { TaskPath } from "@/domain/task";
import type { Clock } from "@/ports/clock";
import type { PushChannel, PushError } from "@/ports/push-channel";

export type NtfyCapability = "ready" | "too-old";

export interface CheckNtfyCapabilityDeps {
	readonly channel: PushChannel;
	readonly clock: Clock;
}

export const NTFY_CHECK_ID = "isotask-test" as ReminderId;

/** A server older than 2.16 ignores the sequence id header, so the id never comes back from the poll. */
export function makeCheckNtfyCapability(deps: CheckNtfyCapabilityDeps): () => Promise<Result<NtfyCapability, PushError>> {
	return async () => {
		// Two minutes, not one: datetimes are minute precision and ntfy rejects a Delay under 10 s.
		const at = addMinutes(deps.clock.now(), 2) as IsoDateTime;
		const publishResult = await deps.channel.publish(
			{
				id: NTFY_CHECK_ID,
				path: "" as TaskPath,
				at,
				title: "Isotask ntfy check",
				body: "Reminders from this vault will arrive here.",
				priority: 3,
				tags: ["white_check_mark"],
			},
			{ delayUntil: at },
		);
		if (!publishResult.ok) {
			return err(publishResult.error);
		}

		const listResult = await deps.channel.listKnown({ sinceSeconds: 120 });
		if (!listResult.ok) {
			return err(listResult.error);
		}

		const found = listResult.value.some((known) => known.id === NTFY_CHECK_ID);
		// A pre-2.16 server 404s or ignores the cancel; either way the held message just delivers a minute later.
		await deps.channel.cancel(NTFY_CHECK_ID);
		return ok(found ? "ready" : "too-old");
	};
}

export type CheckNtfyCapability = ReturnType<typeof makeCheckNtfyCapability>;
