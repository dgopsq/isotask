import type { Brand } from "@/domain/brand";
import type { IsoDateTime, TaskDate } from "@/domain/dates";
import { addMinutes, compareTaskDate, fromJsDateTime, isDateTime, parseTaskDate, toJsDate } from "@/domain/dates";
import type { FrontmatterValue } from "@/domain/frontmatter";
import { djb2a } from "@/domain/hash";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { Task, TaskPath } from "@/domain/task";

/** How long before the anchor a reminder fires; `minutes: 0` fires at the anchor itself. */
export type ReminderSpec =
	| { readonly kind: "offset"; readonly minutes: number }
	| { readonly kind: "absolute"; readonly at: IsoDateTime }
	| { readonly kind: "none" };

export interface ReminderParseError {
	readonly kind: "invalid-remind";
	readonly value: string;
}

const UNIT_MINUTES: Readonly<Record<string, number>> = {
	m: 1,
	min: 1,
	h: 60,
	d: 1440,
	w: 10080,
};

const OFFSET_RE = /^(\d+)\s?(min|m|h|d|w)$/;

/** 1 year in minutes — a reminder further out than that is almost certainly a typo, not an intended offset. */
const MAX_OFFSET_MINUTES = 525_600;

function isValidOffsetMinutes(minutes: number): boolean {
	return Number.isSafeInteger(minutes) && minutes >= 0 && minutes <= MAX_OFFSET_MINUTES;
}

function describeToken(raw: FrontmatterValue): string {
	if (typeof raw === "string") {
		return raw;
	}
	if (typeof raw === "number" || typeof raw === "boolean") {
		return String(raw);
	}
	return raw === null ? "null" : JSON.stringify(raw);
}

function parseToken(raw: FrontmatterValue): Result<ReminderSpec, ReminderParseError> {
	if (typeof raw === "number") {
		if (!isValidOffsetMinutes(raw)) {
			return err({ kind: "invalid-remind", value: describeToken(raw) });
		}
		return ok({ kind: "offset", minutes: raw });
	}
	if (typeof raw !== "string") {
		return err({ kind: "invalid-remind", value: describeToken(raw) });
	}

	const trimmed = raw.trim();
	const lower = trimmed.toLowerCase();

	if (lower === "0") {
		return ok({ kind: "offset", minutes: 0 });
	}

	const offsetMatch = OFFSET_RE.exec(lower);
	if (offsetMatch !== null) {
		const amountText: string | undefined = offsetMatch[1];
		const unitText: string | undefined = offsetMatch[2];
		const amount = amountText === undefined ? 0 : Number(amountText);
		const unitMinutes = unitText === undefined ? undefined : UNIT_MINUTES[unitText];
		if (amount > 0 && Number.isSafeInteger(amount) && unitMinutes !== undefined) {
			const minutes = amount * unitMinutes;
			if (isValidOffsetMinutes(minutes)) {
				return ok({ kind: "offset", minutes });
			}
		}
	}

	const dateResult = parseTaskDate(trimmed);
	if (dateResult.ok && isDateTime(dateResult.value)) {
		return ok({ kind: "absolute", at: dateResult.value });
	}

	return err({ kind: "invalid-remind", value: raw });
}

/**
 * Parses a `remind` frontmatter value into its spec list. `undefined`/`null`/empty -> `[]`.
 * A list containing `none` (anywhere, case-insensitive) collapses to `[none]` only.
 */
export function parseRemind(value: FrontmatterValue | undefined): Result<readonly ReminderSpec[], ReminderParseError> {
	if (value === undefined || value === null || value === "") {
		return ok([]);
	}

	const rawTokens: readonly FrontmatterValue[] = Array.isArray(value) ? value : [value];
	if (rawTokens.length === 0) {
		return ok([]);
	}

	for (const raw of rawTokens) {
		if (typeof raw === "string" && raw.trim().toLowerCase() === "none") {
			return ok([{ kind: "none" }]);
		}
	}

	const specs: ReminderSpec[] = [];
	for (const raw of rawTokens) {
		const parsed = parseToken(raw);
		if (!parsed.ok) {
			return parsed;
		}
		specs.push(parsed.value);
	}
	return ok(specs);
}

/** Canonical text form: `none`, `0`, `15m`, `2h`, `1d`, `1w` (largest unit that divides evenly), or the ISO datetime. */
export function formatReminderSpec(spec: ReminderSpec): string {
	switch (spec.kind) {
		case "none":
			return "none";
		case "absolute":
			return spec.at;
		case "offset": {
			const minutes = spec.minutes;
			if (minutes === 0) {
				return "0";
			}
			if (minutes % 10080 === 0) {
				return `${String(minutes / 10080)}w`;
			}
			if (minutes % 1440 === 0) {
				return `${String(minutes / 1440)}d`;
			}
			if (minutes % 60 === 0) {
				return `${String(minutes / 60)}h`;
			}
			return `${String(minutes)}m`;
		}
		default: {
			const exhaustive: never = spec;
			return exhaustive;
		}
	}
}

export type ReminderAnchorKind = "scheduled" | "due";

/** `scheduled` if present, else `due` — the REVERSE of `transitions.ts#anchorOf` (see DOMAIN-MODEL.md#reminders). */
export function reminderAnchor(task: Task): { readonly kind: ReminderAnchorKind; readonly at: TaskDate } | undefined {
	if (task.scheduled !== undefined) {
		return { kind: "scheduled", at: task.scheduled };
	}
	if (task.due !== undefined) {
		return { kind: "due", at: task.due };
	}
	return undefined;
}

export interface ReminderDefaults {
	readonly remindByDefault: boolean;
	readonly timeOfDay: string /* "HH:mm" */;
}

export const DEFAULT_REMINDER_DEFAULTS: ReminderDefaults = {
	remindByDefault: true,
	timeOfDay: "09:00",
};

export type ReminderId = Brand<string, "ReminderId">;

/** Deterministic id (`isotask-<hex djb2a>`) so re-scheduling the same reminder produces the same id; ntfy replaces and cancels by it. */
export function reminderId(path: TaskPath, anchor: ReminderAnchorKind | "absolute", spec: ReminderSpec): ReminderId {
	const hex = (djb2a(`${path}|${anchor}|${formatReminderSpec(spec)}`) >>> 0).toString(16);
	return `isotask-${hex}` as ReminderId;
}

export interface ReminderInstance {
	readonly id: ReminderId;
	readonly at: IsoDateTime;
	readonly anchor: ReminderAnchorKind | "absolute";
	readonly spec: ReminderSpec;
}

/** A date-only anchor's clock time comes from `timeOfDay`; a datetime anchor keeps its own time. */
function anchorDateTime(anchorAt: TaskDate, timeOfDay: string): IsoDateTime {
	if (isDateTime(anchorAt)) {
		return anchorAt;
	}
	const [hourText, minuteText] = timeOfDay.split(":");
	const base = toJsDate(anchorAt);
	base.setHours(Number(hourText ?? "0"), Number(minuteText ?? "0"), 0, 0);
	return fromJsDateTime(base);
}

function instanceFor(
	path: TaskPath,
	spec: ReminderSpec,
	anchor: { readonly kind: ReminderAnchorKind; readonly at: TaskDate } | undefined,
	defaults: ReminderDefaults,
): ReminderInstance | undefined {
	switch (spec.kind) {
		case "none":
			// Unreachable in practice: a `remind` naming "none" resolves to `[none]` and
			// `reminderTimes` returns `[]` before ever calling this; kept for exhaustiveness.
			return undefined;
		case "absolute":
			return { id: reminderId(path, "absolute", spec), at: spec.at, anchor: "absolute", spec };
		case "offset": {
			if (anchor === undefined) {
				return undefined;
			}
			const at = addMinutes(anchorDateTime(anchor.at, defaults.timeOfDay), -spec.minutes) as IsoDateTime;
			return { id: reminderId(path, anchor.kind, spec), at, anchor: anchor.kind, spec };
		}
		default: {
			const exhaustive: never = spec;
			return exhaustive;
		}
	}
}

/**
 * Every reminder instance a task fires, sorted by `at` and deduplicated by id. `[]` for a closed
 * task, a `remind` naming `none`, or an offset with no anchor to subtract from.
 */
export function reminderTimes(task: Task, defaults: ReminderDefaults, isOpen: boolean): readonly ReminderInstance[] {
	if (!isOpen) {
		return [];
	}

	const remind = task.remind;
	if (remind?.some((spec) => spec.kind === "none") === true) {
		return [];
	}

	const specs: readonly ReminderSpec[] = remind ?? (defaults.remindByDefault ? [{ kind: "offset", minutes: 0 }] : []);
	if (specs.length === 0) {
		return [];
	}

	const anchor = reminderAnchor(task);

	const seen = new Set<ReminderId>();
	const instances: ReminderInstance[] = [];
	for (const spec of specs) {
		const instance = instanceFor(task.path, spec, anchor, defaults);
		if (instance === undefined || seen.has(instance.id)) {
			continue;
		}
		seen.add(instance.id);
		instances.push(instance);
	}

	return [...instances].sort((a, b) => compareTaskDate(a.at, b.at));
}
