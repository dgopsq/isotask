import type { BasesEntry } from "obsidian";

import { parseTask } from "@/domain/frontmatter";
import type { PropertyKeys } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import type { Task, TaskParseError, TaskPath } from "@/domain/task";

export interface InvalidTaskEntry {
	readonly path: TaskPath;
	readonly errors: readonly TaskParseError[];
}

/** A parsed task paired with the Bases entry it came from — the entry is kept only as a display-only source for properties `Task` doesn't model (see `renderGenericChip` in `feed-view.ts`), never re-parsed. */
export interface TaskWithEntry {
	readonly task: Task;
	readonly entry: BasesEntry;
}

export interface BasesEntriesResult {
	readonly tasks: readonly TaskWithEntry[];
	readonly invalid: readonly InvalidTaskEntry[];
	/** Paths whose `metadataCache` entry doesn't exist yet — not yet parsed at all, distinct from `invalid` (parsed and rejected). See `refreshWhenCached` in `views/bases/refresh-after-resolved.ts`. */
	readonly uncached: readonly TaskPath[];
}

/**
 * Maps the entries a Bases view was handed into parsed tasks (each paired
 * with the `BasesEntry` it came from), using `peekFrontmatter` (metadata
 * cache, else the store's own recent write — see `ports/task-store.ts`) as
 * the source of raw frontmatter for `domain/frontmatter.ts`. Entries whose
 * note isn't a task at all (marker mismatch) are silently skipped; entries
 * that look like a task but fail to parse are reported as `invalid` per
 * `docs/DOMAIN-MODEL.md`'s parse-error policy. Entries `peekFrontmatter`
 * has nothing for yet are reported as `uncached` instead of being parsed
 * against an empty frontmatter and misread as a mismatch.
 *
 * `BasesEntry.getValue()` was considered as an alternative source (it can't
 * be stale the way `metadataCache` momentarily can be, right after a vault
 * loads) but its `Value` wrapper only exposes `toString()`/`isTruthy()` —
 * no accessor round-trips a property back to the string/number/boolean/array
 * shapes `parseTask` needs — so `peekFrontmatter` stays the source of truth;
 * the views self-heal the rare staleness window instead (see
 * `docs/ARCHITECTURE.md`). The entry is still handed back alongside the
 * parsed task, display-only, so the feed view can render Bases toolbar
 * "Properties" this plugin doesn't model as first-class `Task` fields
 * (`feed-row.ts#feedRowColumns`'s `generic` column).
 */
export function tasksFromBasesEntries(
	peekFrontmatter: (path: TaskPath) => Readonly<Record<string, unknown>> | undefined,
	entries: readonly BasesEntry[],
	keys: PropertyKeys,
	statuses: readonly StatusConfig[],
): BasesEntriesResult {
	const tasks: TaskWithEntry[] = [];
	const invalid: InvalidTaskEntry[] = [];
	const uncached: TaskPath[] = [];

	for (const entry of entries) {
		const file = entry.file;
		const path = file.path as TaskPath;
		const frontmatter = peekFrontmatter(path);
		if (frontmatter === undefined) {
			uncached.push(path);
			continue;
		}
		const result = parseTask(path, file.basename, frontmatter, keys, statuses);

		if (result.ok) {
			tasks.push({ task: result.value, entry });
			continue;
		}

		const isMarkerMismatch = result.error.length === 1 && result.error[0]?.kind === "not-a-task";
		if (!isMarkerMismatch) {
			invalid.push({ path, errors: result.error });
		}
	}

	return { tasks, invalid, uncached };
}
