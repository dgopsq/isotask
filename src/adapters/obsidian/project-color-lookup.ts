import type { App } from "obsidian";

/**
 * Reads a project note's raw `color` frontmatter value, given the task's
 * own `project` frontmatter string and the task note's own path (as the
 * link-resolution source, matching an unresolved/relative project link).
 * Same resolution semantics as the feed's own project link
 * (`views/bases/feed/feed-view.ts#renderProjectLink`): `getFirstLinkpathDest`
 * against the task's own path, `undefined`/`null` (project doesn't resolve
 * to a note) folds to `undefined`.
 *
 * Returns `unknown` on purpose — frontmatter values are untyped YAML
 * scalars, and validating/normalising `color` is `domain/project-color.ts
 * #parseProjectColor`'s job, not this adapter's.
 */
export function projectRawColor(app: App, project: string, sourcePath: string): unknown {
	const dest = app.metadataCache.getFirstLinkpathDest(project, sourcePath);
	if (dest === null) {
		return undefined;
	}
	return app.metadataCache.getFileCache(dest)?.frontmatter?.["color"];
}

/**
 * The project note's own path, if `project` resolves to one — used by the
 * feed/calendar views to track which project notes the last render's dots
 * depended on (`lastProjectPaths`), so a `metadataCache` `changed` on one of
 * them can trigger a re-render (`docs/DOMAIN-MODEL.md`).
 */
export function projectFilePath(app: App, project: string, sourcePath: string): string | undefined {
	return app.metadataCache.getFirstLinkpathDest(project, sourcePath)?.path;
}
