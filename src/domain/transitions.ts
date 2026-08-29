import type { IsoDateTime, TaskDate } from "@/domain/dates";
import { shiftBy, toDateOnly, toFloatingDate } from "@/domain/dates";
import type { FrontmatterPatch, FrontmatterValue } from "@/domain/frontmatter";
import type { PropertyKeys } from "@/domain/property-keys";
import { nextOccurrence } from "@/domain/recurrence";
import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import { findStatus, firstOpenStatus, isTerminal } from "@/domain/status";
import type { Task } from "@/domain/task";

const TRAILING_DATE_RE = / \d{4}-\d{2}-\d{2}$/;

/** Strips one trailing ` YYYY-MM-DD` from a basename, so a spawned occurrence's title doesn't accumulate dates across the series. */
export function seriesTitle(basename: string): string {
	return basename.replace(TRAILING_DATE_RE, "");
}

/** Expands `{{title}}` and `{{due}}` (date part only, even when `due` carries a time) in a spawn filename template. */
export function spawnBasename(template: string, title: string, due: TaskDate): string {
	return template.replaceAll("{{title}}", title).replaceAll("{{due}}", toDateOnly(due));
}

export interface SpawnPlan {
	readonly basename: string;
	readonly frontmatter: Readonly<Record<string, FrontmatterValue>>;
	readonly nextDue: Option<TaskDate>;
	readonly nextScheduled: Option<TaskDate>;
}

export interface StatusChangeResult {
	readonly patch: FrontmatterPatch;
	readonly spawn: Option<SpawnPlan>;
}

export interface StatusChangeInput {
	readonly task: Task;
	readonly raw: Readonly<Record<string, FrontmatterValue>>;
	readonly basename: string;
	readonly to: StatusConfig;
	readonly statuses: readonly StatusConfig[];
	readonly keys: PropertyKeys;
	readonly now: IsoDateTime;
	readonly spawnTemplate: string;
}

/** The anchor rrule evaluates against: `due` if present, else `scheduled` (see `docs/DOMAIN-MODEL.md#recurrence-semantics`). */
function anchorOf(task: Task): TaskDate | undefined {
	return task.due ?? task.scheduled;
}

function planSpawn(input: StatusChangeInput): Option<SpawnPlan> {
	const { task, raw, basename, statuses, keys, now, spawnTemplate } = input;

	const anchor = anchorOf(task);
	if (anchor === undefined || task.repeat === undefined) {
		return none();
	}

	const next = nextOccurrence(task.repeat, anchor);
	if (!next.some) {
		return none();
	}

	const openStatus = firstOpenStatus(statuses);
	if (!openStatus.some) {
		return none();
	}

	const deltaMs = toFloatingDate(next.value).getTime() - toFloatingDate(anchor).getTime();
	const nextDue: Option<TaskDate> = task.due !== undefined ? some(shiftBy(task.due, deltaMs)) : none();
	const nextScheduled: Option<TaskDate> = task.scheduled !== undefined ? some(shiftBy(task.scheduled, deltaMs)) : none();

	const carried = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== keys.completed));
	const frontmatter: Readonly<Record<string, FrontmatterValue>> = {
		...carried,
		[keys.status]: openStatus.value.id,
		[keys.created]: now,
		...(nextDue.some ? { [keys.due]: nextDue.value } : {}),
		...(nextScheduled.some ? { [keys.scheduled]: nextScheduled.value } : {}),
	};

	return some({
		basename: spawnBasename(spawnTemplate, seriesTitle(basename), next.value),
		frontmatter,
		nextDue,
		nextScheduled,
	});
}

/**
 * Computes the frontmatter patch and (optional) spawned-occurrence plan for
 * a status transition, per `docs/DOMAIN-MODEL.md#statuses` and
 * `#recurrence-semantics`. Pure: identical input always yields an identical
 * `StatusChangeResult` (idempotent — re-running a completion produces the
 * same spawn plan; it's the caller's job not to write it twice).
 */
export function applyStatusChange(input: StatusChangeInput): StatusChangeResult {
	const { task, to, statuses } = input;

	if (task.status === to.id) {
		return { patch: {}, spawn: none() };
	}

	const from = findStatus(statuses, task.status);
	const wasTerminal = from.some && isTerminal(from.value.kind);
	const enteringTerminal = isTerminal(to.kind);

	const patch: FrontmatterPatch = {
		[input.keys.status]: to.id,
		...(enteringTerminal
			? { [input.keys.completed]: input.now }
			: wasTerminal
				? { [input.keys.completed]: null }
				: {}),
	};

	// Only entering a `done`-kind status spawns; `cancelled` ends the series.
	const spawn = to.kind === "done" ? planSpawn(input) : none();

	return { patch, spawn };
}
