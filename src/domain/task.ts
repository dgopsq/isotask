import type { Brand } from "@/domain/brand";
import type { TaskDate } from "@/domain/dates";

/** Vault-relative path to a task note, e.g. `Tasks/Buy milk.md`. */
export type TaskPath = Brand<string, "TaskPath">;

/** The id of a configured status (see `domain/status.ts`), e.g. `todo`. */
export type StatusId = Brand<string, "StatusId">;

export type Priority = "low" | "normal" | "high" | "urgent";

export const PRIORITIES: readonly Priority[] = ["low", "normal", "high", "urgent"];

/** Ordering helper: higher rank sorts later/more-urgent. Used to sort buckets priority-desc. */
export function priorityRank(priority: Priority): number {
	switch (priority) {
		case "low":
			return 0;
		case "normal":
			return 1;
		case "high":
			return 2;
		case "urgent":
			return 3;
		default: {
			const exhaustive: never = priority;
			return exhaustive;
		}
	}
}

/**
 * CSS class suffix for a priority chip, e.g. `"priority-urgent"` — callers
 * prefix it (`cssClass(priorityChipClass(priority))` -> `"obtask-priority-urgent"`).
 * One class per `Priority` value so a stylesheet can map each to a theme
 * colour variable; kept here (not scattered in DOM code) so the feed row and
 * the M3 calendar can share the same mapping.
 */
export function priorityChipClass(priority: Priority): string {
	return `priority-${priority}`;
}

const PRIORITY_LABELS: Readonly<Record<Priority, string>> = {
	low: "Low",
	normal: "Normal",
	high: "High",
	urgent: "Urgent",
};

/** Human-readable label for a priority, e.g. `"high"` -> `"High"`. Shared by the create-task modal, the feed row's priority control and `ui/priority-menu.ts`. */
export function priorityLabel(priority: Priority): string {
	return PRIORITY_LABELS[priority];
}

export type Minutes = Brand<number, "Minutes">;

/** An RFC 5545 RRULE body only, no `DTSTART` (e.g. `FREQ=WEEKLY;BYDAY=MO`). */
export type RRuleString = Brand<string, "RRuleString">;

export interface Task {
	readonly path: TaskPath;
	readonly title: string;
	readonly status: StatusId;
	readonly priority: Priority;
	readonly due?: TaskDate;
	readonly scheduled?: TaskDate;
	readonly duration?: Minutes;
	readonly repeat?: RRuleString;
	readonly project?: string;
	readonly tags: readonly string[];
	readonly created?: TaskDate;
	readonly completed?: TaskDate;
}

export type TaskParseError =
	| { readonly kind: "not-a-task" }
	| { readonly kind: "missing-status" }
	| { readonly kind: "unknown-status"; readonly value: string; readonly allowed: readonly string[] }
	| { readonly kind: "invalid-priority"; readonly value: string; readonly allowed: readonly string[] }
	| { readonly kind: "invalid-date"; readonly property: string; readonly value: string }
	| { readonly kind: "invalid-duration"; readonly value: string }
	| { readonly kind: "invalid-tags"; readonly value: string }
	| { readonly kind: "invalid-project"; readonly value: string }
	/** Warning, not fatal: `repeat` set without a usable anchor (`due`/`scheduled`). */
	| { readonly kind: "recurrence-without-anchor" };
