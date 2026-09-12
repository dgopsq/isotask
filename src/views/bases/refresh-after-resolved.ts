import type { App, BasesQueryResult, BasesView, EventRef } from "obsidian";

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

interface PendingCacheRefresh {
	ref: EventRef | undefined;
	timeoutId: number | undefined;
	/** Paths the 1500ms fallback has already fired for once, ever, this view's lifetime — see `refreshWhenCached`. */
	readonly firedOnce: Set<string>;
}

/** Per-view watch state for `refreshWhenCached`, keyed by view instance so the helper needs no field on `BasesView` itself. */
const pendingCacheRefreshes = new WeakMap<BasesView, PendingCacheRefresh>();

/**
 * Re-runs `onDataUpdated()` once every path in `paths` gets a `metadataCache`
 * entry — the fix for `tasksFromBasesEntries`' `uncached` list (a note whose
 * cache isn't indexed yet, e.g. just created or just rewritten on iOS/iCloud).
 *
 * The `changed` listener is re-armed on every call for the full current
 * `paths` list — it only fires on a real cache change, so it can never loop.
 * The 1500ms timeout fallback is the one that can: a note that genuinely has
 * no frontmatter is `uncached` forever (see `bases-entries.ts`), and would
 * otherwise re-arm a fresh timeout on every render, refreshing every 1500ms
 * indefinitely. `firedOnce` bounds that to a single extra render per path per
 * view lifetime — once a path's fallback has fired, only the listener (which
 * costs nothing while idle) still watches it.
 */
export function refreshWhenCached(view: BasesView, app: App, paths: readonly string[]): void {
	let state = pendingCacheRefreshes.get(view);
	if (state === undefined) {
		state = { ref: undefined, timeoutId: undefined, firedOnce: new Set<string>() };
		pendingCacheRefreshes.set(view, state);
	}

	if (state.ref !== undefined) {
		app.metadataCache.offref(state.ref);
		state.ref = undefined;
	}
	if (state.timeoutId !== undefined) {
		window.clearTimeout(state.timeoutId);
		state.timeoutId = undefined;
	}

	if (paths.length === 0) {
		return;
	}

	const pathSet = new Set(paths);

	const refresh = (): void => {
		if (state.ref !== undefined) {
			app.metadataCache.offref(state.ref);
			state.ref = undefined;
		}
		if (state.timeoutId !== undefined) {
			window.clearTimeout(state.timeoutId);
			state.timeoutId = undefined;
		}
		const data: BasesQueryResult | undefined = (view as { data?: BasesQueryResult }).data;
		if (data !== undefined) {
			view.onDataUpdated();
		}
	};

	const ref = app.metadataCache.on("changed", (file) => {
		if (pathSet.has(file.path)) {
			refresh();
		}
	});
	view.registerEvent(ref);
	state.ref = ref;

	const needsTimeout = paths.some((path) => !state.firedOnce.has(path));
	if (needsTimeout) {
		const timeoutId = window.setTimeout(() => {
			for (const path of pathSet) {
				state.firedOnce.add(path);
			}
			refresh();
		}, 1500);
		state.timeoutId = timeoutId;
		// Cancels the fallback if the view is torn down before it fires —
		// `refresh` would otherwise call `onDataUpdated()` on an unloaded view.
		view.register(() => {
			window.clearTimeout(timeoutId);
		});
	}
}
