import type { App, BasesQueryResult, BasesView } from "obsidian";

/**
 * Re-run a Bases view's `onDataUpdated()` once the `metadataCache` finishes
 * its initial indexing pass.
 *
 * On the very first render after a vault loads, Bases can hand a view
 * entries whose `metadataCache.getFileCache(file)?.frontmatter` is still
 * empty or stale because the file hasn't been indexed yet. `resolved` fires
 * once that pass settles, so one refresh there closes the race.
 *
 * Fires once only: `resolved` also fires after every later modification
 * batch, and Bases already re-queries on those, so listening for longer
 * would just double every render. Skips the refresh if Bases hasn't
 * delivered a query result yet — `BasesView.data` is typed non-optional but
 * is unset until the first `onDataUpdated()`.
 */
export function refreshAfterMetadataResolved(view: BasesView, app: App): void {
	const ref = app.metadataCache.on("resolved", () => {
		app.metadataCache.offref(ref);
		const data: BasesQueryResult | undefined = (view as { data?: BasesQueryResult }).data;
		if (data !== undefined) {
			view.onDataUpdated();
		}
	});
	view.registerEvent(ref);
}
