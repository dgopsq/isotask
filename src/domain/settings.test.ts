import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, parseSettings } from "@/domain/settings";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import { DEFAULT_STATUSES } from "@/domain/status";

describe("parseSettings", () => {
	it("returns defaults for undefined/non-object input", () => {
		expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings("nope")).toEqual(DEFAULT_SETTINGS);
	});

	it("returns defaults for an empty object", () => {
		expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps valid fields and falls back only the invalid one", () => {
		const result = parseSettings({
			taskFolder: "Work/Tasks",
			weekStart: 3,
			propertyKeys: 42, // invalid: not an object
		});
		expect(result.taskFolder).toBe("Work/Tasks");
		expect(result.weekStart).toBe(3);
		expect(result.propertyKeys).toEqual(DEFAULT_PROPERTY_KEYS);
	});

	it("falls back individual propertyKeys entries", () => {
		const result = parseSettings({
			propertyKeys: { ...DEFAULT_PROPERTY_KEYS, status: 7, due: "deadline" },
		});
		expect(result.propertyKeys.status).toBe(DEFAULT_PROPERTY_KEYS.status);
		expect(result.propertyKeys.due).toBe("deadline");
	});

	it("accepts a valid custom status list", () => {
		const statuses = [
			{ id: "backlog", label: "Backlog", kind: "open" },
			{ id: "shipped", label: "Shipped", kind: "done" },
		];
		const result = parseSettings({ statuses });
		expect(result.statuses).toEqual(statuses);
	});

	it("falls back the whole statuses list when ids are not unique", () => {
		const statuses = [
			{ id: "todo", label: "To do", kind: "open" },
			{ id: "todo", label: "Duplicate", kind: "done" },
		];
		expect(parseSettings({ statuses }).statuses).toEqual(DEFAULT_STATUSES);
	});

	it("falls back the whole statuses list when there is no open status", () => {
		const statuses = [{ id: "done", label: "Done", kind: "done" }];
		expect(parseSettings({ statuses }).statuses).toEqual(DEFAULT_STATUSES);
	});

	it("falls back the whole statuses list when there is no done status", () => {
		const statuses = [{ id: "todo", label: "To do", kind: "open" }];
		expect(parseSettings({ statuses }).statuses).toEqual(DEFAULT_STATUSES);
	});

	it("falls back the whole statuses list on an unknown kind", () => {
		const statuses = [
			{ id: "todo", label: "To do", kind: "open" },
			{ id: "done", label: "Done", kind: "finished" },
		];
		expect(parseSettings({ statuses }).statuses).toEqual(DEFAULT_STATUSES);
	});

	it("keeps an optional status icon when present", () => {
		const statuses = [
			{ id: "todo", label: "To do", kind: "open", icon: "circle" },
			{ id: "done", label: "Done", kind: "done" },
		];
		expect(parseSettings({ statuses }).statuses).toEqual(statuses);
	});

	it("falls back taskFolder, tasksBasePath and filename templates individually", () => {
		const result = parseSettings({
			taskFolder: 1,
			tasksBasePath: "Areas/Tasks.base",
			newTaskFilenameTemplate: 2,
			spawnFilenameTemplate: "{{title}} ({{due}})",
		});
		expect(result.taskFolder).toBe(DEFAULT_SETTINGS.taskFolder);
		expect(result.tasksBasePath).toBe("Areas/Tasks.base");
		expect(result.newTaskFilenameTemplate).toBe(DEFAULT_SETTINGS.newTaskFilenameTemplate);
		expect(result.spawnFilenameTemplate).toBe("{{title}} ({{due}})");
	});

	it("falls back weekStart when out of range", () => {
		expect(parseSettings({ weekStart: 9 }).weekStart).toBe(DEFAULT_SETTINGS.weekStart);
	});

	it("keeps a valid taskPanelIntroduced flag and falls back an invalid one", () => {
		expect(parseSettings({ taskPanelIntroduced: true }).taskPanelIntroduced).toBe(true);
		expect(parseSettings({ taskPanelIntroduced: "yes" }).taskPanelIntroduced).toBe(DEFAULT_SETTINGS.taskPanelIntroduced);
	});

	it("falls back version when not literal 1, without touching other fields", () => {
		const result = parseSettings({ version: 2, taskFolder: "Tasks 2" });
		expect(result.version).toBe(1);
		expect(result.taskFolder).toBe("Tasks 2");
	});
});
