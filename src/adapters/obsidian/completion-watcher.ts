import type { Plugin } from "obsidian";

import type { AppDeps } from "@/app/deps";
import { describeAppError } from "@/app/errors";
import { makeReconcileCompletion } from "@/app/reconcile-completion";
import { isTaskNote } from "@/domain/frontmatter";
import type { TaskPath } from "@/domain/task";

/**
 * Reconciles `completed` with `status` on any frontmatter edit, not just the plugin's own toggle.
 * Only reacts while Obsidian runs — deliberately no vault scan on startup.
 */
export function registerCompletionWatcher(plugin: Plugin, deps: AppDeps): void {
	const reconcile = makeReconcileCompletion(deps);
	// Our own write re-fires `changed` for the same path before this resolves; guards against racing that.
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
