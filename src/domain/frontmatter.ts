import * as v from "valibot";

import { canonicalizeFrontmatter } from "@/domain/canonicalize";
import type { TaskDate } from "@/domain/dates";
import { parseTaskDate } from "@/domain/dates";
import type { PropertyKeys } from "@/domain/property-keys";
import type { ReminderSpec } from "@/domain/reminders";
import { formatReminderSpec, parseRemind } from "@/domain/reminders";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import { findStatus, firstOpenStatus } from "@/domain/status";
import type { Minutes, Priority, RRuleString, StatusId, Task, TaskParseError, TaskPath } from "@/domain/task";
import { PRIORITIES } from "@/domain/task";

/** The shape of a value Obsidian can store in frontmatter. */
export type FrontmatterValue = string | number | boolean | null | readonly FrontmatterValue[];

/** A partial frontmatter write: `null` removes the key, everything else sets it. */
export type FrontmatterPatch = Readonly<Record<string, FrontmatterValue | null>>;

const PrioritySchema = v.picklist(PRIORITIES);
const TagsSchema = v.union([v.string(), v.array(v.string())]);
const DurationSchema = v.pipe(v.number(), v.minValue(0));
const NonEmptyStringSchema = v.pipe(v.string(), v.minLength(1));

const WIKILINK_RE = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

/** Renders an arbitrary frontmatter value for an error message without risking "[object Object]". */
function describeValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value === null) {
		return "null";
	}
	if (value === undefined) {
		return "undefined";
	}
	try {
		return JSON.stringify(value);
	} catch {
		return Object.prototype.toString.call(value);
	}
}

/** Extracts the link target from `[[Project note]]` or `[[Project note|alias]]`; returns the input unchanged if it isn't a wikilink. */
export function projectFromWikilink(value: string): string {
	const match = WIKILINK_RE.exec(value);
	if (match === null) {
		return value;
	}
	const target: string | undefined = match[1];
	return target === undefined ? value : target.trim();
}

export function toWikilink(project: string): string {
	return `[[${project}]]`;
}

export function isTaskNote(raw: Readonly<Record<string, unknown>>, keys: PropertyKeys): boolean {
	return raw[keys.markerKey] === keys.markerValue;
}

/**
 * A missing/empty `status` (ADR 0012 — the Bases toolbar "New" button can't
 * be made to write one) defaults to the first configured `open`-kind status,
 * same lenient-parse spirit as ADR 0010's other folds. Only when no `open`
 * status is configured at all does this still fail to parse.
 */
function parseStatus(value: unknown, statuses: readonly StatusConfig[]): Result<StatusId, TaskParseError> {
	const parsed = v.safeParse(NonEmptyStringSchema, value);
	if (!parsed.success) {
		const openStatus = firstOpenStatus(statuses);
		return openStatus.some ? ok(openStatus.value.id) : err({ kind: "no-open-status" });
	}
	const id = parsed.output as StatusId;
	return findStatus(statuses, id).some
		? ok(id)
		: err({ kind: "unknown-status", value: parsed.output, allowed: statuses.map((status) => status.id) });
}

function parsePriority(value: unknown): Result<Priority, TaskParseError> {
	if (value === undefined || value === null) {
		return ok("normal");
	}
	const parsed = v.safeParse(PrioritySchema, value);
	return parsed.success ? ok(parsed.output) : err({ kind: "invalid-priority", value: describeValue(value), allowed: PRIORITIES });
}

function parseOptionalDate(value: unknown, property: string): Result<TaskDate | undefined, TaskParseError> {
	if (value === undefined || value === null || value === "") {
		return ok(undefined);
	}
	const stringResult = v.safeParse(v.string(), value);
	if (!stringResult.success) {
		return err({ kind: "invalid-date", property, value: describeValue(value) });
	}
	const parsed = parseTaskDate(stringResult.output);
	return parsed.ok ? ok(parsed.value) : err({ kind: "invalid-date", property, value: stringResult.output });
}

function parseOptionalDuration(value: unknown): Result<Minutes | undefined, TaskParseError> {
	if (value === undefined || value === null) {
		return ok(undefined);
	}
	const parsed = v.safeParse(DurationSchema, value);
	return parsed.success ? ok(parsed.output as Minutes) : err({ kind: "invalid-duration", value: describeValue(value) });
}

/** RRULE syntax itself is validated by `domain/recurrence.ts`; here, any non-empty string is accepted and non-strings are treated as absent. */
function parseOptionalRepeat(value: unknown): Result<RRuleString | undefined, TaskParseError> {
	if (value === undefined || value === null) {
		return ok(undefined);
	}
	const parsed = v.safeParse(NonEmptyStringSchema, value);
	return ok(parsed.success ? (parsed.output as RRuleString) : undefined);
}

function parseOptionalProject(value: unknown): Result<string | undefined, TaskParseError> {
	if (value === undefined || value === null) {
		return ok(undefined);
	}
	const parsed = v.safeParse(NonEmptyStringSchema, value);
	return parsed.success ? ok(projectFromWikilink(parsed.output)) : err({ kind: "invalid-project", value: describeValue(value) });
}

function parseTags(value: unknown): Result<readonly string[], TaskParseError> {
	if (value === undefined || value === null) {
		return ok([]);
	}
	const parsed = v.safeParse(TagsSchema, value);
	if (!parsed.success) {
		return err({ kind: "invalid-tags", value: describeValue(value) });
	}
	return ok(typeof parsed.output === "string" ? (parsed.output.length === 0 ? [] : [parsed.output]) : parsed.output);
}

function isFrontmatterValue(value: unknown): value is FrontmatterValue {
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return true;
	}
	return Array.isArray(value) && value.every(isFrontmatterValue);
}

/**
 * An invalid `remind` value is a parse warning, not a hard error (same spirit as
 * `recurrence-without-anchor`): the token is dropped and the task still parses.
 */
function parseOptionalRemind(value: unknown): readonly ReminderSpec[] {
	if (!isFrontmatterValue(value)) {
		return [];
	}
	const parsed = parseRemind(value);
	return parsed.ok ? parsed.value : [];
}

/**
 * Parses raw frontmatter into a `Task`. Tolerant per `docs/DOMAIN-MODEL.md`:
 * missing `priority` defaults to `normal`, `tags` accepts a string or array,
 * `project` accepts a plain string or a `[[wikilink]]`. Everything else that
 * fails to validate is collected and returned together rather than failing
 * fast on the first problem.
 */
export function parseTask(
	path: TaskPath,
	title: string,
	raw: Readonly<Record<string, unknown>>,
	keys: PropertyKeys,
	statuses: readonly StatusConfig[],
): Result<Task, readonly TaskParseError[]> {
	if (!isTaskNote(raw, keys)) {
		return err([{ kind: "not-a-task" }]);
	}

	// Lenient parse, canonical write (ADR 0010): unambiguous variants (whitespace,
	// status-label vs. id, numeric-string duration, ...) are folded to their
	// canonical form before validation, so only genuinely invalid values fail below.
	const { frontmatter } = canonicalizeFrontmatter(raw, keys, statuses);

	const status = parseStatus(frontmatter[keys.status], statuses);
	const priority = parsePriority(frontmatter[keys.priority]);
	const due = parseOptionalDate(frontmatter[keys.due], keys.due);
	const scheduled = parseOptionalDate(frontmatter[keys.scheduled], keys.scheduled);
	const duration = parseOptionalDuration(frontmatter[keys.duration]);
	const repeat = parseOptionalRepeat(frontmatter[keys.repeat]);
	const project = parseOptionalProject(frontmatter[keys.project]);
	const tags = parseTags(frontmatter[keys.tags]);
	const created = parseOptionalDate(frontmatter[keys.created], keys.created);
	const completed = parseOptionalDate(frontmatter[keys.completed], keys.completed);
	const remind = parseOptionalRemind(frontmatter[keys.remind]);

	const results: readonly Result<unknown, TaskParseError>[] = [
		status,
		priority,
		due,
		scheduled,
		duration,
		repeat,
		project,
		tags,
		created,
		completed,
	];
	const errors = results.filter((r): r is { readonly ok: false; readonly error: TaskParseError } => !r.ok).map((r) => r.error);

	if (
		errors.length > 0 ||
		!status.ok ||
		!priority.ok ||
		!due.ok ||
		!scheduled.ok ||
		!duration.ok ||
		!repeat.ok ||
		!project.ok ||
		!tags.ok ||
		!created.ok ||
		!completed.ok
	) {
		return err(errors);
	}

	const task: Task = {
		path,
		title,
		status: status.value,
		priority: priority.value,
		tags: tags.value,
		...(due.value !== undefined ? { due: due.value } : {}),
		...(scheduled.value !== undefined ? { scheduled: scheduled.value } : {}),
		...(duration.value !== undefined ? { duration: duration.value } : {}),
		...(repeat.value !== undefined ? { repeat: repeat.value } : {}),
		...(project.value !== undefined ? { project: project.value } : {}),
		...(created.value !== undefined ? { created: created.value } : {}),
		...(completed.value !== undefined ? { completed: completed.value } : {}),
		...(remind.length > 0 ? { remind } : {}),
	};

	return ok(task);
}

/** Renders a `Task` back into a full frontmatter patch (used to seed a spawned recurrence occurrence). */
export function taskToPatch(task: Task, keys: PropertyKeys): FrontmatterPatch {
	return {
		[keys.markerKey]: keys.markerValue,
		[keys.status]: task.status,
		[keys.priority]: task.priority,
		[keys.tags]: task.tags,
		...(task.due !== undefined ? { [keys.due]: task.due } : {}),
		...(task.scheduled !== undefined ? { [keys.scheduled]: task.scheduled } : {}),
		...(task.duration !== undefined ? { [keys.duration]: task.duration } : {}),
		...(task.repeat !== undefined ? { [keys.repeat]: task.repeat } : {}),
		...(task.project !== undefined ? { [keys.project]: toWikilink(task.project) } : {}),
		...(task.created !== undefined ? { [keys.created]: task.created } : {}),
		...(task.completed !== undefined ? { [keys.completed]: task.completed } : {}),
		...(task.remind !== undefined && task.remind.length > 0 ? { [keys.remind]: task.remind.map(formatReminderSpec) } : {}),
	};
}
