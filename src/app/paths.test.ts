import { describe, expect, it } from "vitest";

import { joinTaskPath, splitTaskPath } from "@/app/paths";
import type { TaskPath } from "@/domain/task";

function path(value: string): TaskPath {
	return value as TaskPath;
}

describe("splitTaskPath", () => {
	it("splits a folder + basename path", () => {
		expect(splitTaskPath(path("Tasks/Buy milk.md"))).toEqual({ folder: "Tasks", basename: "Buy milk" });
	});

	it("splits a nested folder", () => {
		expect(splitTaskPath(path("Tasks/Work/Report.md"))).toEqual({ folder: "Tasks/Work", basename: "Report" });
	});

	it("handles a vault-root path (no folder)", () => {
		expect(splitTaskPath(path("Buy milk.md"))).toEqual({ folder: "", basename: "Buy milk" });
	});

	it("handles a path without a .md extension", () => {
		expect(splitTaskPath(path("Tasks/Buy milk"))).toEqual({ folder: "Tasks", basename: "Buy milk" });
	});
});

describe("joinTaskPath", () => {
	it("joins a folder and basename", () => {
		expect(joinTaskPath("Tasks", "Buy milk")).toBe("Tasks/Buy milk.md");
	});

	it("joins with an empty folder (vault root)", () => {
		expect(joinTaskPath("", "Buy milk")).toBe("Buy milk.md");
	});

	it("trims surrounding whitespace from the folder", () => {
		expect(joinTaskPath("  Tasks  ", "Buy milk")).toBe("Tasks/Buy milk.md");
	});

	it("round-trips with splitTaskPath", () => {
		const original = path("Tasks/Work/Report.md");
		const split = splitTaskPath(original);
		expect(joinTaskPath(split.folder, split.basename)).toBe(original);
	});
});
