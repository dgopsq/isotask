import manifest from "../manifest.json";

/**
 * Single source of truth for every code-level use of the plugin's identity
 * (view type ids, CSS class prefix, display name). Derived from
 * `manifest.json` so a rename only ever needs the checklist in
 * `docs/CONVENTIONS.md` — never a source-wide string search.
 *
 * No `obsidian` import here, so this module may be imported from any layer
 * (`domain`, `app`, `ports`, `adapters`, `views`, `ui`, `settings`, `main.ts`).
 */
export const PLUGIN_ID: string = manifest.id;
export const PLUGIN_NAME: string = manifest.name;

export const VIEW_TYPE_FEED = `${PLUGIN_ID}-feed`;
export const VIEW_TYPE_CALENDAR = `${PLUGIN_ID}-calendar`;
export const VIEW_TYPE_TASK_PANEL = `${PLUGIN_ID}-task-panel`;

/** Prefix every plugin-defined CSS class must use (see `src/styles/isotask.css`). */
export const CSS_PREFIX: string = PLUGIN_ID;

/** Builds a prefixed CSS class name, e.g. `cssClass("feed")` -> `"isotask-feed"`. */
export function cssClass(name: string): string {
	return `${CSS_PREFIX}-${name}`;
}
