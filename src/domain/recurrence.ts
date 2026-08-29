import type { Options as RRuleOptions } from "rrule";
import { RRule } from "rrule";

import type { TaskDate } from "@/domain/dates";
import { fromFloatingDate, isDateTime, toFloatingDate } from "@/domain/dates";
import type { Option, Result } from "@/domain/result";
import { err, none, ok, some } from "@/domain/result";
import type { RRuleString } from "@/domain/task";

export type RecurrenceError =
	| { readonly kind: "empty" }
	| { readonly kind: "contains-dtstart" }
	| { readonly kind: "unparsable"; readonly value: string; readonly reason: string };

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Validates and normalises an RRULE *body* (e.g. `FREQ=WEEKLY;BYDAY=MO`) — no
 * `DTSTART`, that's supplied separately as the task's anchor (see
 * `docs/DOMAIN-MODEL.md#recurrence-semantics`). Normalisation is uppercase +
 * trim, which also sidesteps `rrule`'s case-sensitive `BYDAY` value parsing
 * (`Days["mo"]` is `undefined`, `Days["MO"]` is not).
 */
export function parseRRule(body: string): Result<RRuleString, RecurrenceError> {
	const trimmed = body.trim();
	if (trimmed.length === 0) {
		return err({ kind: "empty" });
	}
	const normalized = trimmed.toUpperCase();
	if (normalized.includes("DTSTART")) {
		return err({ kind: "contains-dtstart" });
	}
	try {
		const parsed: Partial<RRuleOptions> = RRule.parseString(normalized);
		// RFC 5545 requires FREQ; `rrule` itself silently defaults a missing one
		// to YEARLY instead of rejecting it, so that has to be checked explicitly.
		if (parsed.freq === undefined) {
			return err({ kind: "unparsable", value: trimmed, reason: "missing FREQ" });
		}
		// Constructed only to validate: `parseOptions` throws on an invalid freq/attribute value.
		new RRule(parsed);
	} catch (error) {
		return err({ kind: "unparsable", value: trimmed, reason: describeError(error) });
	}
	return ok(normalized as RRuleString);
}

/**
 * First occurrence strictly after `anchor`, evaluated in wall-clock local
 * time. `rrule` treats every `Date` it's given as a "floating" time with the
 * UTC field accessors standing in for wall-clock ones (see its README,
 * "Important: Use UTC dates") — real timezone/DST rules never enter the
 * computation, so `dtstart` and the returned occurrence are built with
 * `toFloatingDate`/`fromFloatingDate` rather than `toJsDate` (which uses the
 * *actual* system timezone and would drift across a DST transition).
 * The result keeps the anchor's kind: a date-only anchor yields a date-only
 * result, a datetime anchor yields a datetime with the same time-of-day.
 */
export function nextOccurrence(rule: RRuleString, anchor: TaskDate): Option<TaskDate> {
	const hasTime = isDateTime(anchor);
	const dtstart = toFloatingDate(anchor);

	let parsed: Partial<RRuleOptions>;
	try {
		parsed = RRule.parseString(rule);
	} catch {
		return none();
	}

	let next: Date | null;
	try {
		const rrule = new RRule({ ...parsed, dtstart });
		next = rrule.after(dtstart, false);
	} catch {
		return none();
	}

	return next === null ? none() : some(fromFloatingDate(next, hasTime));
}

/** Human-readable description via `rrule`'s `toText()`, falling back to the raw body if it can't render one. */
export function describeRRule(rule: RRuleString): string {
	try {
		const parsed: Partial<RRuleOptions> = RRule.parseString(rule);
		const rrule = new RRule(parsed);
		return rrule.toText();
	} catch {
		return rule;
	}
}

export interface RecurrencePreset {
	readonly id: string;
	readonly label: string;
	readonly rule: RRuleString;
}

/** Trusted literal RRULE bodies known-valid at compile time (see the equivalent `statusId` pattern in `domain/status.ts`). */
function presetRule(body: string): RRuleString {
	return body as RRuleString;
}

/**
 * `weekly` and `monthly` carry no `BYDAY`/`BYMONTHDAY`: per RFC 5545, an
 * `RRule` without those falls back to the anchor's (`dtstart`'s) weekday /
 * day-of-month, so "weekly" means "weekly on the anchor's weekday", not a
 * fixed day.
 */
export const RECURRENCE_PRESETS: readonly RecurrencePreset[] = [
	{ id: "daily", label: "Daily", rule: presetRule("FREQ=DAILY") },
	{ id: "weekdays", label: "Weekdays", rule: presetRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") },
	{ id: "weekly", label: "Weekly", rule: presetRule("FREQ=WEEKLY") },
	{ id: "every-2-weeks", label: "Every 2 weeks", rule: presetRule("FREQ=WEEKLY;INTERVAL=2") },
	{ id: "monthly", label: "Monthly", rule: presetRule("FREQ=MONTHLY") },
	{ id: "yearly", label: "Yearly", rule: presetRule("FREQ=YEARLY") },
];
