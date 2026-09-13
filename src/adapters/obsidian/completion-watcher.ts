import type { Plugin } from "obsidian";

import type { AppDeps } from "@/app/deps";
import { describeAppError } from "@/app/errors";
import { makeReconcileCompletion } from "@/app/reconcile-completion";
import { isTaskNote } from "@/domain/frontmatter";
import type { TaskPath } from "@/domain/task";

// `resolved` fires in waves during indexing; a late-discovered pre-existing done task can land
// in a later wave than the first, so the gate opens on a quiet period, not the first firing.
const RESOLUTION_QUIET_MS = 1000;

/**
 * Reconciles `completed` with `status` on any frontmatter edit, not just the plugin's own toggle.
 * Only reconciles live edits: one made while Obsidian is closed is not caught up at next startup.
 */
export function registerCompletionWatcher(plugin: Plugin, deps: AppDeps): void {
	const reconcile = makeReconcileCompletion(deps);
	// Our own write re-fires `changed` for the same path before this resolves; guards against racing that.
	const inFlight = new Set<TaskPath>();

	let gateOpen = false;
	let quietTimer: number | undefined;
	plugin.registerEvent(
		plugin.app.metadataCache.on("resolved", () => {
			if (quietTimer !== undefined) {
				window.clearTimeout(quietTimer);
			}
			quietTimer = window.setTimeout(() => {
				gateOpen = true;
			}, RESOLUTION_QUIET_MS);
		}),
	);
	plugin.register(() => {
		if (quietTimer !== undefined) {
			window.clearTimeout(quietTimer);
		}
	});

	plugin.registerEvent(
		plugin.app.metadataCache.on("changed", (file, _data, cache) => {
			if (!gateOpen || file.extension !== "md" || !isTaskNote(cache.frontmatter ?? {}, deps.settings().propertyKeys)) {
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
