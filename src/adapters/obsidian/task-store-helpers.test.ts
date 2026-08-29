import { describe, expect, it } from "vitest";

import { applyFrontmatterPatch, extractBody, setAllFrontmatterValues } from "@/adapters/obsidian/task-store-helpers";

describe("applyFrontmatterPatch", () => {
	it("sets keys present in the patch", () => {
		const fm: Record<string, unknown> = { status: "todo" };
		applyFrontmatterPatch(fm, { status: "done", priority: "high" });
		expect(fm).toEqual({ status: "done", priority: "high" });
	});

	it("deletes a key when the patch value is null", () => {
		const fm: Record<string, unknown> = { status: "todo", due: "2026-08-29" };
		applyFrontmatterPatch(fm, { due: null });
		expect(fm).toEqual({ status: "todo" });
	});

	it("never touches keys absent from the patch", () => {
		const fm: Record<string, unknown> = { status: "todo", project: "[[Work]]", tags: ["a"] };
		applyFrontmatterPatch(fm, { status: "done" });
		expect(fm).toEqual({ status: "done", project: "[[Work]]", tags: ["a"] });
	});

	it("applies an empty patch as a no-op", () => {
		const fm: Record<string, unknown> = { status: "todo" };
		applyFrontmatterPatch(fm, {});
		expect(fm).toEqual({ status: "todo" });
	});
});

describe("setAllFrontmatterValues", () => {
	it("sets every key, including literal null values", () => {
		const fm: Record<string, unknown> = {};
		setAllFrontmatterValues(fm, { type: "task", status: "todo", due: null });
		expect(fm).toEqual({ type: "task", status: "todo", due: null });
	});

	it("overwrites existing keys", () => {
		const fm: Record<string, unknown> = { status: "todo" };
		setAllFrontmatterValues(fm, { status: "done" });
		expect(fm).toEqual({ status: "done" });
	});
});

describe("extractBody", () => {
	it("returns the content unchanged when there is no frontmatter block", () => {
		expect(extractBody("Just a note.", false, 0)).toBe("Just a note.");
	});

	it("slices off the frontmatter block using the given offset", () => {
		const content = "---\nstatus: todo\n---\nBody text.";
		const contentStart = content.indexOf("Body text.");
		expect(extractBody(content, true, contentStart)).toBe("Body text.");
	});

	it("returns an empty string for a frontmatter-only note", () => {
		const content = "---\nstatus: todo\n---\n";
		expect(extractBody(content, true, content.length)).toBe("");
	});
});
