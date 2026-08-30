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
 */
export function renderTasksBase(keys: PropertyKeys, statuses: readonly StatusConfig[], viewTypes: BaseViewTypes): string {
	const lines: string[] = [
		"filters:",
		"  and:",
		...filterLines(keys, statuses).map((line) => `    - ${line}`),
		"views:",
		`  - type: ${viewTypes.feed}`,
		"    name: Feed",
		"    order:",
		...defaultFeedOrderYaml(keys).map((id) => `      - ${id}`),
		`  - type: ${viewTypes.calendar}`,
		"    name: Calendar",
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
