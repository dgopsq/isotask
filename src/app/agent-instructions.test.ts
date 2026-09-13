import { describe, expect, it } from "vitest";

import { renderAgentInstructions } from "@/app/agent-instructions";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import type { IsotaskSettings } from "@/domain/settings";
import type { StatusId } from "@/domain/task";

const GUIDE_URL = "https://example.com/guide";

describe("renderAgentInstructions", () => {
	it("renders the marker line, default keys, both status ids, and the guide URL", () => {
		const text = renderAgentInstructions(DEFAULT_SETTINGS, GUIDE_URL);

		expect(text).toContain("type: task");
		expect(text).toContain(GUIDE_URL);
		expect(text).toContain("`todo`");
		expect(text).toContain("`done`");
		for (const key of Object.values(DEFAULT_SETTINGS.propertyKeys)) {
			expect(text).toContain(key);
		}
		expect(text).toContain(DEFAULT_SETTINGS.taskFolder);
		expect(text).toContain(DEFAULT_SETTINGS.tasksBasePath);
		expect(text).toContain(DEFAULT_SETTINGS.spawnFilenameTemplate);
	});

	it("renders renamed property keys instead of the defaults", () => {
		const settings: IsotaskSettings = {
			...DEFAULT_SETTINGS,
			propertyKeys: {
				...DEFAULT_SETTINGS.propertyKeys,
				markerKey: "kind",
				markerValue: "todo-item",
				status: "state",
			},
		};

		const text = renderAgentInstructions(settings, GUIDE_URL);

		expect(text).toContain("kind: todo-item");
		expect(text).toContain("`state`");
		expect(text).not.toContain("type: task");
		expect(text).not.toContain("`status`:");
	});

	it("renders custom statuses instead of the defaults", () => {
		const settings: IsotaskSettings = {
			...DEFAULT_SETTINGS,
			statuses: [
				{ id: "backlog" as StatusId, label: "Backlog", kind: "open" },
				{ id: "shipped" as StatusId, label: "Shipped", kind: "done" },
			],
		};

		const text = renderAgentInstructions(settings, GUIDE_URL);

		expect(text).toContain("`backlog`");
		expect(text).toContain("Backlog");
		expect(text).toContain("`shipped`");
		expect(text).toContain("Shipped");
		expect(text).not.toContain("`todo`");
		expect(text).not.toContain("`done`");
	});

	it("renders '(vault root)' for an empty task folder instead of the default folder", () => {
		const settings: IsotaskSettings = { ...DEFAULT_SETTINGS, taskFolder: "" };

		const text = renderAgentInstructions(settings, GUIDE_URL);

		expect(text).toContain("(vault root)");
		expect(text).not.toContain(`\`${DEFAULT_SETTINGS.taskFolder}\` folder`);
	});
});
