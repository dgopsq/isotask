import { describe, expect, it } from "vitest";

import {
	applyFrontmatterPatch,
	extractBody,
	lookupFrontmatter,
	recentWrite,
	rememberWrite,
	setAllFrontmatterValues,
	shouldDropOverlayEntry,
} from "@/adapters/obsidian/task-store-helpers";
import type { RecentWrite } from "@/adapters/obsidian/task-store-helpers";

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

describe("rememberWrite / recentWrite", () => {
	it("returns the overlaid frontmatter when the write is within the TTL", () => {
		const writes = new Map<string, RecentWrite>();
		rememberWrite(writes, "Tasks/A.md", { status: "done" }, 1000, 15_000);
		expect(recentWrite(writes, "Tasks/A.md", 1000 + 5000, 15_000)).toEqual({ status: "done" });
	});

	it("returns undefined once the write is older than the TTL", () => {
		const writes = new Map<string, RecentWrite>();
		rememberWrite(writes, "Tasks/A.md", { status: "done" }, 1000, 15_000);
		expect(recentWrite(writes, "Tasks/A.md", 1000 + 15_001, 15_000)).toBeUndefined();
	});

	it("returns undefined for a path that was never written", () => {
		const writes = new Map<string, RecentWrite>();
		expect(recentWrite(writes, "Tasks/Other.md", 1000, 15_000)).toBeUndefined();
	});

	it("prunes expired entries on write", () => {
		const writes = new Map<string, RecentWrite>();
		rememberWrite(writes, "Tasks/A.md", { status: "done" }, 1000, 15_000);
		rememberWrite(writes, "Tasks/B.md", { status: "todo" }, 1000 + 15_001, 15_000);
		expect(writes.has("Tasks/A.md")).toBe(false);
		expect(writes.has("Tasks/B.md")).toBe(true);
	});
});

describe("lookupFrontmatter", () => {
	it("prefers an unexpired recent write over a defined-but-stale cache value", () => {
		const writes = new Map<string, RecentWrite>();
		rememberWrite(writes, "Tasks/A.md", { status: "done" }, 1000, 15_000);
		const cacheFrontmatter = { status: "todo" };
		expect(lookupFrontmatter(cacheFrontmatter, writes, "Tasks/A.md", 1000 + 5000, 15_000)).toEqual({
			status: "done",
		});
	});

	it("falls back to the cache value once the recent write has expired", () => {
		const writes = new Map<string, RecentWrite>();
		rememberWrite(writes, "Tasks/A.md", { status: "done" }, 1000, 15_000);
		const cacheFrontmatter = { status: "todo" };
		expect(lookupFrontmatter(cacheFrontmatter, writes, "Tasks/A.md", 1000 + 15_001, 15_000)).toEqual(
			cacheFrontmatter,
		);
	});
});

describe("shouldDropOverlayEntry", () => {
	it("drops the overlay once the cache has frontmatter again", () => {
		expect(shouldDropOverlayEntry({ status: "done" })).toBe(true);
	});

	it("keeps the overlay while the cache still has none", () => {
		expect(shouldDropOverlayEntry(undefined)).toBe(false);
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
