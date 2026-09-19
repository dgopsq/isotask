import type { DateSource } from "@/domain/buckets";
import type { TaskDate } from "@/domain/dates";
import { compareTaskDate } from "@/domain/dates";
import type { PropertyKeys } from "@/domain/property-keys";
import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";
import type { Task } from "@/domain/task";

/** Which frontmatter property supplied a feed row's anchor date, and its value. */
export interface FeedRowAnchor {
	readonly field: "due" | "scheduled";
	readonly value: TaskDate;
}

/**
 * Which field a date-chip click should edit when the row has no anchor date
 * yet (`feedRowAnchor` returned `none`) — `due` for the `due` and `earliest`
 * sources, `scheduled` for the `scheduled` source.
 */
export function feedRowDefaultDateField(source: DateSource): FeedRowAnchor["field"] {
	return source === "scheduled" ? "scheduled" : "due";
}

/**
 * Resolves the feed row's anchor date for the configured date source, same
 * due/scheduled/earliest precedence as `buckets.ts#taskAnchorDate` (earliest
 * tie -> due) — but also reports which property won, so a row's date-chip
 * click knows which field to edit.
 */
export function feedRowAnchor(task: Task, source: DateSource): Option<FeedRowAnchor> {
	switch (source) {
		case "due":
			return task.due === undefined ? none() : some({ field: "due", value: task.due });
		case "scheduled":
			return task.scheduled === undefined ? none() : some({ field: "scheduled", value: task.scheduled });
		case "earliest": {
			if (task.due !== undefined && task.scheduled !== undefined) {
				return compareTaskDate(task.due, task.scheduled) <= 0
					? some({ field: "due", value: task.due })
					: some({ field: "scheduled", value: task.scheduled });
			}
			if (task.due !== undefined) {
				return some({ field: "due", value: task.due });
			}
			if (task.scheduled !== undefined) {
				return some({ field: "scheduled", value: task.scheduled });
			}
			return none();
		}
		default: {
			const exhaustive: never = source;
			return exhaustive;
		}
	}
}

/**
 * One extra column a feed row renders after status/title, derived from the
 * Bases toolbar's "Properties" menu (`BasesViewConfig.getOrder()`). See
 * `feedRowColumns`'s doc comment for the mapping rules.
 */
export type FeedColumn =
	| { readonly kind: "date" }
	| { readonly kind: "priority" }
	| { readonly kind: "project" }
	| { readonly kind: "tags" }
	/** Bell chip for an explicit `remind`; opt-in via the Properties menu, unlike the always-shown date/priority chips. */
	| { readonly kind: "remind" }
	| { readonly kind: "generic"; readonly propertyId: string };

/**
 * Maps the Bases toolbar's Properties order (`BasesPropertyId[]`, e.g.
 * `file.name`, `note.due`, `formula.effort`) to the columns a feed row
 * renders after its always-on status control and title link, preserving
 * `order`'s left-to-right position. This is also what makes the toolbar's
 * Search useful for the feed — Bases only searches properties in `getOrder()`.
 *
 * Rules, walking `order` left to right:
 * - `file.name` and `note.<keys.status>` contribute nothing (title and
 *   status are always rendered first, regardless of the menu).
 * - `note.<keys.due>` or `note.<keys.scheduled>` contribute a single `date`
 *   column, positioned at the FIRST of the two that appears in `order`; the
 *   second (if present) is ignored — a row shows one date chip, not two.
 * - `note.<keys.priority>` -> `priority`; `note.<keys.project>` -> `project`;
 *   `note.<keys.tags>` or `file.tags` -> `tags` (whichever appears first;
 *   the second is ignored, same dedupe as the date columns above).
 * - `note.<keys.markerKey>` contributes nothing (the task marker is noise
 *   in a feed row).
 * - `note.<keys.remind>` -> `remind` (at most once, same dedupe as above).
 * - Anything else (`note.*`, `file.*`, `formula.*`) becomes a `generic`
 *   column carrying its raw property id, rendered as a label/value chip
 *   (`feed-view.ts#renderGenericChip`).
 */
export function feedRowColumns(order: readonly string[], keys: PropertyKeys): readonly FeedColumn[] {
	const notedId = (key: string): string => `note.${key}`;

	const columns: FeedColumn[] = [];
	let dateAdded = false;
	let tagsAdded = false;
	let remindAdded = false;

	for (const id of order) {
		if (id === "file.name" || id === notedId(keys.status) || id === notedId(keys.markerKey)) {
			continue;
		}
		if (id === notedId(keys.due) || id === notedId(keys.scheduled)) {
			if (!dateAdded) {
				columns.push({ kind: "date" });
				dateAdded = true;
			}
			continue;
		}
		if (id === notedId(keys.priority)) {
			columns.push({ kind: "priority" });
			continue;
		}
		if (id === notedId(keys.project)) {
			columns.push({ kind: "project" });
			continue;
		}
		if (id === notedId(keys.tags) || id === "file.tags") {
			if (!tagsAdded) {
				columns.push({ kind: "tags" });
				tagsAdded = true;
			}
			continue;
		}
		if (id === notedId(keys.remind)) {
			if (!remindAdded) {
				columns.push({ kind: "remind" });
				remindAdded = true;
			}
			continue;
		}
		columns.push({ kind: "generic", propertyId: id });
	}

	return columns;
}

/**
 * Default `order:` block for a generated `.base` file's Feed view, in the
 * bare YAML property names Bases' own `order:` syntax expects (not
 * `BasesPropertyId`s — Bases prefixes bare `note.*` properties itself when
 * it loads the file). Used by `app/generate-base.ts#renderTasksBase`.
 */
export function defaultFeedOrderYaml(keys: PropertyKeys): readonly string[] {
	return ["file.name", keys.status, keys.due, keys.scheduled, keys.priority, keys.project, keys.tags];
}
