import { describe, expect, it } from "vitest";

import { renderTasksBase } from "@/app/generate-base";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";
import type { StatusId } from "@/domain/task";

/**
 * Kept as a literal (rather than reading `e2e/vault/Tasks.base` from disk)
 * because `src/**` typechecks without Node types (the plugin bundle targets
 * the Obsidian sandbox) — a `node:fs` import there would fail `tsc`. Keep
 * this in sync with that fixture file if either changes; it's the syntax
 * verified there to actually load in Obsidian (see AGENTS.md).
 */
const EXPECTED_DEFAULT_BASE =
	'filters:\n  and:\n    - type == "task"\n    - status != "done"\n    - status != "cancelled"\nviews:\n' +
	"  - type: obtask-feed\n    name: Feed\n  - type: obtask-calendar\n    name: Calendar\n  - type: table\n" +
	"    name: All tasks\n    order:\n      - file.name\n      - status\n      - priority\n      - due\n      - scheduled\n";

describe("renderTasksBase", () => {
	it("matches e2e/vault/Tasks.base byte for byte with the default settings", () => {
		const actual = renderTasksBase(DEFAULT_PROPERTY_KEYS, DEFAULT_STATUSES, { feed: "obtask-feed", calendar: "obtask-calendar" });
		expect(actual).toBe(EXPECTED_DEFAULT_BASE);
	});

	it("emits one exclusion filter per terminal-kind status, in configured order", () => {
		const statuses: readonly StatusConfig[] = [
			{ id: "todo" as StatusId, label: "To do", kind: "open" },
			{ id: "archived" as StatusId, label: "Archived", kind: "done" },
			{ id: "dropped" as StatusId, label: "Dropped", kind: "cancelled" },
		];
		const result = renderTasksBase(DEFAULT_PROPERTY_KEYS, statuses, { feed: "obtask-feed", calendar: "obtask-calendar" });
		expect(result).toContain('    - status != "archived"');
		expect(result).toContain('    - status != "dropped"');
		expect(result).not.toContain('status != "todo"');
	});

	it("uses the configured property keys throughout", () => {
		const keys = { ...DEFAULT_PROPERTY_KEYS, markerKey: "kind", markerValue: "action-item", status: "state" };
		const result = renderTasksBase(keys, DEFAULT_STATUSES, { feed: "obtask-feed", calendar: "obtask-calendar" });
		expect(result).toContain('kind == "action-item"');
		expect(result).toContain('state != "done"');
		expect(result).toContain("      - state");
	});
});
