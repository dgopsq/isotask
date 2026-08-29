import type { App, BasesEntry } from "obsidian";

import { parseTask } from "@/domain/frontmatter";
import type { PropertyKeys } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import type { Task, TaskParseError, TaskPath } from "@/domain/task";

export interface InvalidTaskEntry {
	readonly path: TaskPath;
	readonly errors: readonly TaskParseError[];
}

export interface BasesEntriesResult {
	readonly tasks: readonly Task[];
	readonly invalid: readonly InvalidTaskEntry[];
}

/**
 * Maps the entries a Bases view was handed into parsed tasks, using
 * `app.metadataCache.getFileCache(file)?.frontmatter` (never re-reading the
 * file body) as the source of raw frontmatter for `domain/frontmatter.ts`.
 * Entries whose note isn't a task at all (marker mismatch) are silently
 * skipped; entries that look like a task but fail to parse are reported as
 * `invalid` per `docs/DOMAIN-MODEL.md`'s parse-error policy.
 *
 * `BasesEntry.getValue()` was considered as an alternative source (it can't
 * be stale the way `metadataCache` momentarily can be, right after a vault
 * loads) but its `Value` wrapper only exposes `toString()`/`isTruthy()` —
 * no accessor round-trips a property back to the string/number/boolean/array
 * shapes `parseTask` needs — so `metadataCache` stays the source of truth;
 * the views self-heal the rare staleness window instead (see
 * `docs/ARCHITECTURE.md`).
 */
export function tasksFromBasesEntries(
	app: App,
	entries: readonly BasesEntry[],
	keys: PropertyKeys,
	statuses: readonly StatusConfig[],
): BasesEntriesResult {
	const tasks: Task[] = [];
	const invalid: InvalidTaskEntry[] = [];

	for (const entry of entries) {
		const file = entry.file;
		const path = file.path as TaskPath;
		const raw = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const result = parseTask(path, file.basename, raw, keys, statuses);

		if (result.ok) {
			tasks.push(result.value);
			continue;
		}

		const isMarkerMismatch = result.error.length === 1 && result.error[0]?.kind === "not-a-task";
		if (!isMarkerMismatch) {
			invalid.push({ path, errors: result.error });
		}
	}

	return { tasks, invalid };
}
