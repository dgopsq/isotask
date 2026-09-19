import type { TaskDate } from "@/domain/dates";
import type { ReminderSpec } from "@/domain/reminders";
import { formatReminderSpec } from "@/domain/reminders";

export interface ReminderPreset {
	readonly id: string;
	readonly label: string;
	readonly specs: readonly ReminderSpec[];
}

export const REMINDER_PRESETS: readonly ReminderPreset[] = [
	{ id: "at-time", label: "At time", specs: [{ kind: "offset", minutes: 0 }] },
	{ id: "15m", label: "15 min before", specs: [{ kind: "offset", minutes: 15 }] },
	{ id: "1h", label: "1 hour before", specs: [{ kind: "offset", minutes: 60 }] },
	{ id: "1d", label: "1 day before", specs: [{ kind: "offset", minutes: 1440 }] },
	{ id: "none", label: "None", specs: [{ kind: "none" }] },
];

/** Matches by canonical text (`formatReminderSpec`), so `[60m]` and `[1h]` match the same preset but a differently-ordered or -sized list does not. */
export function matchReminderPreset(specs: readonly ReminderSpec[]): ReminderPreset | undefined {
	const canonical = specs.map(formatReminderSpec);
	return REMINDER_PRESETS.find((preset) => {
		const presetCanonical = preset.specs.map(formatReminderSpec);
		return presetCanonical.length === canonical.length && presetCanonical.every((value, index) => value === canonical[index]);
	});
}

export type OffsetUnit = "m" | "h" | "d" | "w";

const UNIT_MINUTES: Readonly<Record<OffsetUnit, number>> = { m: 1, h: 60, d: 1440, w: 10080 };

/** Largest unit that divides `minutes` evenly, for the custom-offset editor's amount+unit fields. */
export function offsetParts(minutes: number): { readonly amount: number; readonly unit: OffsetUnit } {
	if (minutes === 0) {
		return { amount: 0, unit: "m" };
	}
	if (minutes % UNIT_MINUTES.w === 0) {
		return { amount: minutes / UNIT_MINUTES.w, unit: "w" };
	}
	if (minutes % UNIT_MINUTES.d === 0) {
		return { amount: minutes / UNIT_MINUTES.d, unit: "d" };
	}
	if (minutes % UNIT_MINUTES.h === 0) {
		return { amount: minutes / UNIT_MINUTES.h, unit: "h" };
	}
	return { amount: minutes, unit: "m" };
}

export function offsetMinutes(amount: number, unit: OffsetUnit): number {
	return amount * UNIT_MINUTES[unit];
}

function pluralize(amount: number, singular: string): string {
	return amount === 1 ? singular : `${singular}s`;
}

/** Human label for one spec; preset labels are asserted to equal this in tests so they can't drift apart. */
export function describeReminderSpec(spec: ReminderSpec): string {
	switch (spec.kind) {
		case "none":
			return "None";
		case "absolute":
			return spec.at.replace("T", " ");
		case "offset": {
			if (spec.minutes === 0) {
				return "At time";
			}
			const { amount, unit } = offsetParts(spec.minutes);
			const unitLabel = unit === "m" ? "min" : pluralize(amount, unit === "h" ? "hour" : unit === "d" ? "day" : "week");
			return `${String(amount)} ${unitLabel} before`;
		}
		default: {
			const exhaustive: never = spec;
			return exhaustive;
		}
	}
}

/** Joined per-spec descriptions; flags an offset with no anchor to count down from. */
export function describeReminders(specs: readonly ReminderSpec[], anchor: TaskDate | undefined): string {
	if (specs.length === 0 || specs.some((spec) => spec.kind === "none")) {
		return "None";
	}
	const description = specs.map(describeReminderSpec).join(", ");
	const needsAnchor = anchor === undefined && specs.some((spec) => spec.kind === "offset");
	return needsAnchor ? `${description} (no date to remind on)` : description;
}

/**
 * The exact string list `set-reminder.ts`/`create-task.ts` write to the `remind` property:
 * `["none"]` if any spec is `none`, else deduplicated canonical text, first-seen order.
 */
export function canonicalRemindValue(specs: readonly ReminderSpec[]): readonly string[] {
	if (specs.some((spec) => spec.kind === "none")) {
		return ["none"];
	}
	const seen = new Set<string>();
	const values: string[] = [];
	for (const spec of specs) {
		const text = formatReminderSpec(spec);
		if (!seen.has(text)) {
			seen.add(text);
			values.push(text);
		}
	}
	return values;
}
