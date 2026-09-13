import type { Plugin } from "obsidian";

import type { AppDeps } from "@/app/deps";
import { describeAppError } from "@/app/errors";
import { makeReconcileCompletion } from "@/app/reconcile-completion";
import { isTaskNote } from "@/domain/frontmatter";
import type { TaskPath } from "@/domain/task";

/**
 * Reconciles `completed` with `status` on every `metadataCache` `changed`
 * event for a task note, so an edit made outside the plugin's own
 * `app/set-status.ts` (Properties view, an external editor, a script) still
 * gets `completed` written/cleared and, on completion, a recurrence spawn.
 * Only reacts while Obsidian is running — no vault scan on startup, per
 * `docs/adr/0018-reconcile-completed-with-status.md`.
 */
export function registerCompletionWatcher(plugin: Plugin, deps: AppDeps): void {
	const reconcile = makeReconcileCompletion(deps);
	// `reconcile`'s own frontmatter write re-fires `changed` for the same
	// path before the first call resolves; without this guard that re-entrant
	// event would race the first call's read/write against its own patch.
	const inFlight = new Set<TaskPath>();

	plugin.registerEvent(
		plugin.app.metadataCache.on("changed", (file, _data, cache) => {
			if (file.extension !== "md" || !isTaskNote(cache.frontmatter ?? {}, deps.settings().propertyKeys)) {
				return;
			}

			const path = file.path as TaskPath;
			if (inFlight.has(path)) {
				return;
			}

			inFlight.add(path);
			void reconcile(path)
				.then((result) => {
					if (!result.ok) {
						deps.notifier.error(describeAppError(result.error));
					}
				})
				.finally(() => {
					inFlight.delete(path);
				});
		}),
	);
}
