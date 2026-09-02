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
	'filters:\n  and:\n    - type == "task"\n    - status != "done"\nviews:\n' +
	"  - type: obtask-feed\n    name: Feed\n    newItemFolder: Tasks\n    order:\n      - file.name\n      - status\n      - due\n      - scheduled\n      - priority\n      - project\n      - tags\n" +
	"  - type: obtask-calendar\n    name: Calendar\n    newItemFolder: Tasks\n  - type: table\n" +
	"    name: All tasks\n    order:\n      - file.name\n      - status\n      - priority\n      - due\n      - scheduled\n";

const viewTypes = { feed: "obtask-feed", calendar: "obtask-calendar" };

describe("renderTasksBase", () => {
	it("matches e2e/vault/Tasks.base byte for byte with the default settings", () => {
		const actual = renderTasksBase(DEFAULT_PROPERTY_KEYS, DEFAULT_STATUSES, viewTypes, "Tasks");
		expect(actual).toBe(EXPECTED_DEFAULT_BASE);
	});

	it("emits one exclusion filter per done-kind status, in configured order", () => {
		const statuses: readonly StatusConfig[] = [
			{ id: "todo" as StatusId, label: "To do", kind: "open" },
			{ id: "waiting" as StatusId, label: "Waiting", kind: "open" },
			{ id: "archived" as StatusId, label: "Archived", kind: "done" },
		];
		const result = renderTasksBase(DEFAULT_PROPERTY_KEYS, statuses, viewTypes, "Tasks");
		expect(result).toContain('    - status != "archived"');
		expect(result).not.toContain('status != "todo"');
		expect(result).not.toContain('status != "waiting"');
	});

	it("uses the configured property keys throughout", () => {
		const keys = { ...DEFAULT_PROPERTY_KEYS, markerKey: "kind", markerValue: "action-item", status: "state" };
		const result = renderTasksBase(keys, DEFAULT_STATUSES, viewTypes, "Tasks");
		expect(result).toContain('kind == "action-item"');
		expect(result).toContain('state != "done"');
		expect(result).toContain("      - state");
	});

	it("Feed view's order: block uses defaultFeedOrderYaml", () => {
		const keys = { ...DEFAULT_PROPERTY_KEYS, due: "deadline" };
		const result = renderTasksBase(keys, DEFAULT_STATUSES, viewTypes, "Tasks");
		expect(result).toContain(
			"  - type: obtask-feed\n    name: Feed\n    newItemFolder: Tasks\n    order:\n      - file.name\n      - status\n      - deadline\n      - scheduled\n      - priority\n      - project\n      - tags\n",
		);
	});

	it("emits newItemFolder on both the feed and calendar views", () => {
		const result = renderTasksBase(DEFAULT_PROPERTY_KEYS, DEFAULT_STATUSES, viewTypes, "Tasks");
		expect(result.match(/newItemFolder: Tasks/g)).toHaveLength(2);
	});

	it("quotes newItemFolder when the folder name needs it", () => {
		const result = renderTasksBase(DEFAULT_PROPERTY_KEYS, DEFAULT_STATUSES, viewTypes, "My Tasks");
		expect(result).toContain('newItemFolder: "My Tasks"');
	});

	it("omits newItemFolder when taskFolder is empty", () => {
		const result = renderTasksBase(DEFAULT_PROPERTY_KEYS, DEFAULT_STATUSES, viewTypes, "");
		expect(result).not.toContain("newItemFolder");
	});
});
