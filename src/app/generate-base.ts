import { defaultFeedOrderYaml } from "@/domain/feed-row";
import type { PropertyKeys } from "@/domain/property-keys";
import { isTerminal } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";

/** The two Bases view type ids the generated `.base` file references, passed in rather than imported (keeps this module free of `@/plugin-id`). */
export interface BaseViewTypes {
	readonly feed: string;
	readonly calendar: string;
}

function yamlQuote(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Characters/shapes that aren't safe as an unquoted plain YAML scalar (whitespace, YAML-significant punctuation, or empty). */
const YAML_NEEDS_QUOTING_RE = /[\s:#{}[\],&*!|>'"%@`]/;

/** `name:`/`newItemFolder:`-style plain string values: only quoted (via `yamlQuote`) when the raw value wouldn't be a safe plain YAML scalar. Matches how the other plain-string values in this file (e.g. `name: Feed`) are written unquoted. */
function yamlPlainOrQuoted(value: string): string {
	return YAML_NEEDS_QUOTING_RE.test(value) || value.length === 0 ? yamlQuote(value) : value;
}

function filterLines(keys: PropertyKeys, statuses: readonly StatusConfig[]): readonly string[] {
	const markerFilter = `${keys.markerKey} == ${yamlQuote(keys.markerValue)}`;
	const terminalFilters = statuses.filter((status) => isTerminal(status.kind)).map((status) => `${keys.status} != ${yamlQuote(status.id)}`);
	return [markerFilter, ...terminalFilters];
}

/**
 * Renders the `.base` file the "Create tasks base" command writes: a filter
 * excluding terminal-kind statuses (see `docs/DOMAIN-MODEL.md#statuses`),
 * and Feed / Calendar / "All tasks" table views. Pure string building (no
 * YAML library) — the shape is fixed and small enough to keep exact,
 * matching `e2e/vault/Tasks.base`.
 *
 * The Feed view's `order:` block (`defaultFeedOrderYaml`) matters beyond
 * cosmetics: the toolbar's "Properties" menu drives which chips a feed row
 * shows (`domain/feed-row.ts#feedRowColumns`), and its `order:` is also
 * what the toolbar's own Search matches against — an empty `order:` would
 * strip every chip and break Search for a freshly generated base.
 *
 * The Feed and Calendar views also get `newItemFolder: <taskFolder>` (a
 * plain Bases view config string, not YAML-list syntax) so the toolbar's
 * `+ New` button creates its note inside the configured task folder instead
 * of falling back to the active file's folder / Obsidian's default location
 * (see `docs/DOMAIN-MODEL.md`'s "New (Bases toolbar)" section and ADR 0012
 * for what that note's frontmatter ends up looking like). Omitted when
 * `taskFolder` is empty (vault-root task notes).
 */
export function renderTasksBase(
	keys: PropertyKeys,
	statuses: readonly StatusConfig[],
	viewTypes: BaseViewTypes,
	taskFolder: string,
): string {
	const newItemFolderLine = taskFolder.length > 0 ? [`    newItemFolder: ${yamlPlainOrQuoted(taskFolder)}`] : [];
	const lines: string[] = [
		"filters:",
		"  and:",
		...filterLines(keys, statuses).map((line) => `    - ${line}`),
		"views:",
		`  - type: ${viewTypes.feed}`,
		"    name: Feed",
		...newItemFolderLine,
		"    order:",
		...defaultFeedOrderYaml(keys).map((id) => `      - ${id}`),
		`  - type: ${viewTypes.calendar}`,
		"    name: Calendar",
		...newItemFolderLine,
		"  - type: table",
		"    name: All tasks",
		"    order:",
		"      - file.name",
		`      - ${keys.status}`,
		`      - ${keys.priority}`,
		`      - ${keys.due}`,
		`      - ${keys.scheduled}`,
	];
	return `${lines.join("\n")}\n`;
}
