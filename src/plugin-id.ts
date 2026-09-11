import manifest from "../manifest.json";

/**
 * Single source of truth for the plugin's identity (view type ids, CSS
 * prefix, display name). `scripts/link-vault.mjs` reads `manifest.json`
 * directly; everything else should import from here.
 */
// Directory-registered id; also the install folder, so it cannot follow the brand.
export const PLUGIN_ID: string = manifest.id;
export const PLUGIN_NAME: string = manifest.name;

// View type ids are persisted in users' .base files and CSS is literal, so they stay pinned to the brand.
export const BRAND = "isotask";

export const VIEW_TYPE_FEED = `${BRAND}-feed`;
export const VIEW_TYPE_CALENDAR = `${BRAND}-calendar`;
export const VIEW_TYPE_TASK_PANEL = `${BRAND}-task-panel`;

export const CSS_PREFIX: string = BRAND;

/** Builds a prefixed CSS class name, e.g. `cssClass("feed")` -> `"isotask-feed"`. */
export function cssClass(name: string): string {
	return `${CSS_PREFIX}-${name}`;
}
