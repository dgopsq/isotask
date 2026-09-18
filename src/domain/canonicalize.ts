import { fromJsDateTime, isDateTime, parseTaskDate, toJsDate } from "@/domain/dates";
import type { PropertyKeys } from "@/domain/property-keys";
import { formatReminderSpec, parseRemind } from "@/domain/reminders";
import type { StatusConfig } from "@/domain/status";
import type { Priority, StatusId } from "@/domain/task";
import { PRIORITIES } from "@/domain/task";

/** The shape of a value Obsidian can store in frontmatter (mirrors `frontmatter.ts`'s `FrontmatterValue`). */
export type FrontmatterValue = string | number | boolean | null | readonly FrontmatterValue[];

/**
 * Why `canonicalizeFrontmatter` changed a value. `"whitespace"` is the
 * generic case: trimming alone was enough to reach the canonical form for
 * that key. The other reasons fire when something beyond trimming changed
 * (a case fold, a label-to-id lookup, a type change, a format rewrite).
 */
export type CanonicalFixReason =
	| "whitespace"
	| "status-case"
	| "status-label"
	| "priority-case"
	| "priority-alias"
	| "duration-string"
	| "tags-scalar"
	| "date-format"
	| "remind-normalized";

/** One frontmatter key whose raw value differed from its canonical form. */
export interface CanonicalFix {
	readonly key: string;
	readonly from: unknown;
	readonly to: FrontmatterValue;
	readonly reason: CanonicalFixReason;
}

export interface Canonicalized {
	readonly frontmatter: Readonly<Record<string, unknown>>;
	readonly fixes: readonly CanonicalFix[];
}

function isPriority(value: string): value is Priority {
	return (PRIORITIES as readonly string[]).includes(value);
}

interface FieldFix<T extends FrontmatterValue> {
	readonly value: T;
	readonly reason: CanonicalFixReason;
}

/**
 * `status`: trims, then matches case-insensitively against configured status
 * `id`s, then against their `label`s. A genuinely unrecognized value (after
 * trimming) is left untouched — `parseTask` will still reject it, per spec.
 */
function canonicalizeStatusValue(raw: string, statuses: readonly StatusConfig[]): FieldFix<StatusId> | undefined {
	const trimmed = raw.trim();
	const byId = statuses.find((status) => status.id.toLowerCase() === trimmed.toLowerCase());
	if (byId !== undefined) {
		if (raw === byId.id) {
			return undefined;
		}
		return { value: byId.id, reason: trimmed === byId.id ? "whitespace" : "status-case" };
	}
	const byLabel = statuses.find((status) => status.label.toLowerCase() === trimmed.toLowerCase());
	if (byLabel !== undefined) {
		return { value: byLabel.id, reason: "status-label" };
	}
	return undefined;
}

/**
 * Retired priorities aliased onto the current three-level `Priority` set —
 * currently just `"low"` -> `"normal"` (the 4-to-3 collapse). Checked
 * before `isPriority` so an existing note's `priority: low` (or `Low`,
 * `LOW`, etc.) keeps parsing instead of becoming an `invalid-priority`.
 */
const PRIORITY_ALIASES: Readonly<Record<string, Priority>> = {
	low: "normal",
};

/** `priority`: trims, lower-cases, and accepts the result only if it's then a known priority or one of `PRIORITY_ALIASES`. */
function canonicalizePriorityValue(raw: string): FieldFix<Priority> | undefined {
	const trimmed = raw.trim();
	const candidate = trimmed.toLowerCase();
	const aliased = PRIORITY_ALIASES[candidate];
	if (aliased !== undefined) {
		return { value: aliased, reason: "priority-alias" };
	}
	if (!isPriority(candidate) || candidate === raw) {
		return undefined;
	}
	return { value: candidate, reason: trimmed === candidate ? "whitespace" : "priority-case" };
}

const NON_NEGATIVE_INTEGER_RE = /^\d+$/;

/** `duration`: a non-negative-integer string (after trimming) becomes a number. */
function canonicalizeDurationValue(raw: string): FieldFix<number> | undefined {
	const trimmed = raw.trim();
	if (!NON_NEGATIVE_INTEGER_RE.test(trimmed)) {
		return undefined;
	}
	return { value: Number(trimmed), reason: "duration-string" };
}

/** `tags`: a scalar string becomes a one-element list (or `[]` for an empty string), matching `frontmatter.ts`'s existing lenient parse. */
function canonicalizeTagsValue(raw: string): FieldFix<readonly string[]> {
	return { value: raw.length === 0 ? [] : [raw], reason: "tags-scalar" };
}

/**
 * `remind`: any value `parseRemind` accepts is folded to a list of its tokens' canonical text
 * (`formatReminderSpec`) — a scalar becomes a list even when its own text is already canonical,
 * since the stored shape must always be a list (`frontmatter.ts#taskToPatch`). A value
 * `parseRemind` rejects is left untouched, same as an unrecognized status/priority.
 */
/** First-seen order: `["1h", "60m"]` both canonicalize to `"1h"`, and the second is a duplicate, not a second reminder. */
function dedupeTokens(tokens: readonly string[]): readonly string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const token of tokens) {
		if (seen.has(token)) {
			continue;
		}
		seen.add(token);
		deduped.push(token);
	}
	return deduped;
}

function canonicalizeRemindValue(raw: unknown): FieldFix<readonly string[]> | undefined {
	const parsed = parseRemind(raw as FrontmatterValue);
	if (!parsed.ok) {
		return undefined;
	}
	const canonical = dedupeTokens(parsed.value.map(formatReminderSpec));
	const rawList = Array.isArray(raw) ? raw : undefined;
	if (rawList?.length === canonical.length && rawList.every((token, i) => token === canonical[i])) {
		return undefined;
	}
	return { value: canonical, reason: "remind-normalized" };
}

/** Strips seconds from an already-valid `TaskDate` string by round-tripping through a real `Date` (dates.ts helpers only keep hour:minute). */
function toCanonicalDateString(value: string): string | undefined {
	const parsed = parseTaskDate(value);
	if (!parsed.ok) {
		return undefined;
	}
	return isDateTime(parsed.value) ? fromJsDateTime(toJsDate(parsed.value)) : parsed.value;
}

const SPACE_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[ \t]+(\d{2}:\d{2})(?::\d{2})?$/;

/**
 * `due`/`scheduled`/`created`/`completed`: accepts `YYYY-MM-DD HH:mm` and
 * `YYYY-MM-DD HH:mm:ss` (space-separated) and `YYYY-MM-DDTHH:mm:ss`, folding
 * all of them to the canonical `YYYY-MM-DDTHH:mm` (or `YYYY-MM-DD` for a
 * date-only value). Timezone-suffixed values never match and are left
 * untouched, per spec (local wall-clock only).
 */
function canonicalizeDateValue(raw: string): FieldFix<string> | undefined {
	const trimmed = raw.trim();

	const direct = toCanonicalDateString(trimmed);
	if (direct !== undefined) {
		if (direct === raw) {
			return undefined;
		}
		return { value: direct, reason: direct === trimmed ? "whitespace" : "date-format" };
	}

	const spaceMatch = SPACE_DATETIME_RE.exec(trimmed);
	if (spaceMatch !== null) {
		const datePart: string | undefined = spaceMatch[1];
		const timePart: string | undefined = spaceMatch[2];
		if (datePart !== undefined && timePart !== undefined) {
			const candidate = `${datePart}T${timePart}`;
			if (parseTaskDate(candidate).ok) {
				return { value: candidate, reason: "date-format" };
			}
		}
	}

	return undefined;
}

const DATE_KEYS = (keys: PropertyKeys): readonly string[] => [keys.due, keys.scheduled, keys.created, keys.completed];

/**
 * Computes the canonical frontmatter for the configured task keys and the
 * list of fixes that would take the raw frontmatter there. Only the keys
 * covered by the rules below are ever touched; everything else in `raw`
 * passes through unchanged. Applying this to already-canonical frontmatter
 * yields zero fixes (idempotent).
 */
export function canonicalizeFrontmatter(
	raw: Readonly<Record<string, unknown>>,
	keys: PropertyKeys,
	statuses: readonly StatusConfig[],
): Canonicalized {
	const frontmatter: Record<string, unknown> = { ...raw };
	const fixes: CanonicalFix[] = [];

	function applyFix<T extends FrontmatterValue>(key: string, original: unknown, fix: FieldFix<T> | undefined): void {
		if (fix === undefined) {
			return;
		}
		frontmatter[key] = fix.value;
		fixes.push({ key, from: original, to: fix.value, reason: fix.reason });
	}

	const statusValue = raw[keys.status];
	if (typeof statusValue === "string") {
		applyFix(keys.status, statusValue, canonicalizeStatusValue(statusValue, statuses));
	}

	const priorityValue = raw[keys.priority];
	if (typeof priorityValue === "string") {
		applyFix(keys.priority, priorityValue, canonicalizePriorityValue(priorityValue));
	}

	const durationValue = raw[keys.duration];
	if (typeof durationValue === "string") {
		applyFix(keys.duration, durationValue, canonicalizeDurationValue(durationValue));
	}

	const tagsValue = raw[keys.tags];
	if (typeof tagsValue === "string") {
		applyFix(keys.tags, tagsValue, canonicalizeTagsValue(tagsValue));
	}

	for (const dateKey of DATE_KEYS(keys)) {
		const dateValue = raw[dateKey];
		if (typeof dateValue === "string") {
			applyFix(dateKey, dateValue, canonicalizeDateValue(dateValue));
		}
	}

	const remindValue = raw[keys.remind];
	if (typeof remindValue === "string" || typeof remindValue === "number" || Array.isArray(remindValue)) {
		applyFix(keys.remind, remindValue, canonicalizeRemindValue(remindValue));
	}

	return { frontmatter, fixes };
}
