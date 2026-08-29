import { endOfWeek as dateFnsEndOfWeek, startOfWeek as dateFnsStartOfWeek } from "date-fns";

import type { Brand } from "@/domain/brand";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";

/**
 * Domain dates are branded ISO 8601 strings, local wall-clock, no timezone
 * suffix (ADR 0008). `IsoDate` is `YYYY-MM-DD`; `IsoDateTime` is
 * `YYYY-MM-DDTHH:mm`. `TaskDate` is either.
 */
export type IsoDate = Brand<string, "IsoDate">;
export type IsoDateTime = Brand<string, "IsoDateTime">;
export type TaskDate = IsoDate | IsoDateTime;

export type DateParseError =
	| { readonly kind: "empty" }
	| { readonly kind: "bad-format"; readonly value: string }
	| { readonly kind: "invalid-calendar-date"; readonly value: string };

/** 0 = Monday .. 6 = Sunday (Monday-first, matching the week-start setting). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

interface DateComponents {
	readonly year: number;
	readonly month: number; // 1-12
	readonly day: number;
	readonly hour: number;
	readonly minute: number;
	readonly second: number;
	readonly hasTime: boolean;
}

function group(match: RegExpExecArray, index: number): string {
	return match[index] ?? "";
}

function matchComponents(value: string): DateComponents | undefined {
	const dateTimeMatch = DATE_TIME_RE.exec(value);
	if (dateTimeMatch !== null) {
		const secondsGroup: string | undefined = dateTimeMatch[6];
		return {
			year: Number(group(dateTimeMatch, 1)),
			month: Number(group(dateTimeMatch, 2)),
			day: Number(group(dateTimeMatch, 3)),
			hour: Number(group(dateTimeMatch, 4)),
			minute: Number(group(dateTimeMatch, 5)),
			second: secondsGroup === undefined ? 0 : Number(secondsGroup),
			hasTime: true,
		};
	}
	const dateMatch = DATE_ONLY_RE.exec(value);
	if (dateMatch !== null) {
		return {
			year: Number(group(dateMatch, 1)),
			month: Number(group(dateMatch, 2)),
			day: Number(group(dateMatch, 3)),
			hour: 0,
			minute: 0,
			second: 0,
			hasTime: false,
		};
	}
	return undefined;
}

/** Naive-UTC epoch: treats the wall-clock digits as UTC so arithmetic never crosses a real DST boundary. */
function toEpochMs(components: DateComponents): number {
	return Date.UTC(components.year, components.month - 1, components.day, components.hour, components.minute, components.second);
}

function fromEpochMs(ms: number, hasTime: boolean): DateComponents {
	const d = new Date(ms);
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		hour: d.getUTCHours(),
		minute: d.getUTCMinutes(),
		second: d.getUTCSeconds(),
		hasTime,
	};
}

function isValidCalendarDate(components: DateComponents): boolean {
	const roundTrip = fromEpochMs(toEpochMs(components), components.hasTime);
	return (
		roundTrip.year === components.year &&
		roundTrip.month === components.month &&
		roundTrip.day === components.day &&
		roundTrip.hour === components.hour &&
		roundTrip.minute === components.minute &&
		roundTrip.second === components.second
	);
}

function pad(value: number, width = 2): string {
	return String(value).padStart(width, "0");
}

function formatDateOnly(components: DateComponents): IsoDate {
	return `${pad(components.year, 4)}-${pad(components.month)}-${pad(components.day)}` as IsoDate;
}

function formatDateTime(components: DateComponents): IsoDateTime {
	return `${pad(components.year, 4)}-${pad(components.month)}-${pad(components.day)}T${pad(components.hour)}:${pad(
		components.minute,
	)}` as IsoDateTime;
}

/**
 * A `TaskDate` is only ever produced by `parseTaskDate`, `fromJsDate` or
 * `fromJsDateTime`, all of which emit well-formed strings — this fallback is
 * unreachable in practice and exists only so arithmetic helpers never throw.
 */
function componentsOf(date: TaskDate): DateComponents {
	return matchComponents(date) ?? { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, hasTime: false };
}

/**
 * Parses `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm[:ss]`. Rejects anything else,
 * including timezone-suffixed values (`Z`, `+01:00`, ...) — those simply
 * don't match either pattern.
 */
export function parseTaskDate(value: string): Result<TaskDate, DateParseError> {
	if (value.length === 0) {
		return err({ kind: "empty" });
	}
	const components = matchComponents(value);
	if (components === undefined) {
		return err({ kind: "bad-format", value });
	}
	if (!isValidCalendarDate(components)) {
		return err({ kind: "invalid-calendar-date", value });
	}
	return ok(value as TaskDate);
}

export function isDateTime(date: TaskDate): date is IsoDateTime {
	return date.includes("T");
}

/**
 * Zero-padded 24h `HH:mm` time-of-day. Only meaningful for an
 * `IsoDateTime` — a date-only `TaskDate` has no time component (this still
 * returns `00:00` for one rather than throwing; callers that care should
 * check `isDateTime` first, as `event-calendar-mapping.ts` does before
 * prefixing an all-day chip's title with it).
 */
export function formatTime(date: TaskDate): string {
	const c = componentsOf(date);
	return `${pad(c.hour)}:${pad(c.minute)}`;
}

export function toDateOnly(date: TaskDate): IsoDate {
	return isDateTime(date) ? formatDateOnly(componentsOf(date)) : date;
}

/** Builds a genuine local `Date` (real system-timezone semantics) for boundaries that need one (rrule, the calendar widget). */
export function toJsDate(date: TaskDate): Date {
	const c = componentsOf(date);
	return new Date(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
}

export function fromJsDate(date: Date): IsoDate {
	return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` as IsoDate;
}

export function fromJsDateTime(date: Date): IsoDateTime {
	return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
		date.getMinutes(),
	)}` as IsoDateTime;
}

/** Adds whole minutes of wall-clock time, immune to real DST (naive-UTC arithmetic). Preserves date-vs-datetime kind. */
export function addMinutes(date: TaskDate, minutes: number): TaskDate {
	const c = componentsOf(date);
	const shifted = fromEpochMs(toEpochMs(c) + minutes * 60_000, c.hasTime);
	return c.hasTime ? formatDateTime(shifted) : formatDateOnly(shifted);
}

/** Shifts by an exact millisecond delta (naive-UTC arithmetic), preserving date-vs-datetime kind and wall-clock time. */
export function shiftBy(date: TaskDate, deltaMs: number): TaskDate {
	const c = componentsOf(date);
	const shifted = fromEpochMs(toEpochMs(c) + deltaMs, c.hasTime);
	return c.hasTime ? formatDateTime(shifted) : formatDateOnly(shifted);
}

export function compareTaskDate(a: TaskDate, b: TaskDate): number {
	return toEpochMs(componentsOf(a)) - toEpochMs(componentsOf(b));
}

/**
 * Builds a "floating" (timezone-less) `Date` whose UTC fields carry the
 * wall-clock digits — the representation `rrule` needs to evaluate
 * recurrence without picking up the executing machine's real DST rules
 * (see ADR 0005/0008). Pairs with `fromFloatingDate`.
 */
export function toFloatingDate(date: TaskDate): Date {
	return new Date(toEpochMs(componentsOf(date)));
}

export function fromFloatingDate(date: Date, hasTime: boolean): TaskDate {
	const components: DateComponents = {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
		hour: date.getUTCHours(),
		minute: date.getUTCMinutes(),
		second: date.getUTCSeconds(),
		hasTime,
	};
	return hasTime ? formatDateTime(components) : formatDateOnly(components);
}

/**
 * Monday-first `Weekday` (0..6) -> Sunday-first 0..6, i.e. JS `Date#getDay()`
 * order. `date-fns`'s `weekStartsOn` uses this convention; so does
 * `@event-calendar/core`'s `firstDay` option (see
 * `src/adapters/calendar/event-calendar/event-calendar-mapping.ts`), which
 * is why this is exported under a generic name rather than kept private.
 */
export function toSundayFirstWeekday(firstDay: Weekday): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
	if (firstDay === 6) {
		return 0;
	}
	return (firstDay + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

export function startOfWeek(date: TaskDate, firstDay: Weekday): IsoDate {
	return fromJsDate(dateFnsStartOfWeek(toJsDate(date), { weekStartsOn: toSundayFirstWeekday(firstDay) }));
}

export function endOfWeek(date: TaskDate, firstDay: Weekday): IsoDate {
	return fromJsDate(dateFnsEndOfWeek(toJsDate(date), { weekStartsOn: toSundayFirstWeekday(firstDay) }));
}
