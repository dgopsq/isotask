import { describe, expect, it, vi } from "vitest";

// Same idiom as haptics.test.ts: only `parseOpenParams` is exercised, which never
// touches the obsidian runtime, so the mock's shape doesn't matter.
vi.mock("obsidian", () => ({ normalizePath: (path: string) => path, Notice: vi.fn() }));

import { parseOpenParams, parseSnoozeParams } from "@/adapters/obsidian/protocol-handler";

describe("parseOpenParams", () => {
	it("returns the path when present", () => {
		expect(parseOpenParams({ path: "Tasks/Foo.md" })).toEqual({ path: "Tasks/Foo.md" });
	});

	it("returns undefined when path is missing", () => {
		expect(parseOpenParams({})).toBeUndefined();
	});

	it("returns undefined when path is empty", () => {
		expect(parseOpenParams({ path: "" })).toBeUndefined();
	});

	it("ignores other params", () => {
		expect(parseOpenParams({ vault: "My Vault", path: "Tasks/Foo.md", rid: "isotask-abc" })).toEqual({ path: "Tasks/Foo.md" });
	});
});

describe("parseSnoozeParams", () => {
	it("returns path and minutes for a valid for token", () => {
		expect(parseSnoozeParams({ path: "Tasks/Foo.md", for: "1h" })).toEqual({ path: "Tasks/Foo.md", minutes: 60 });
	});

	it("accepts other offset units", () => {
		expect(parseSnoozeParams({ path: "Tasks/Foo.md", for: "30m" })).toEqual({ path: "Tasks/Foo.md", minutes: 30 });
		expect(parseSnoozeParams({ path: "Tasks/Foo.md", for: "1d" })).toEqual({ path: "Tasks/Foo.md", minutes: 1440 });
	});

	it("returns undefined when path is missing", () => {
		expect(parseSnoozeParams({ for: "1h" })).toBeUndefined();
	});

	it("returns undefined when for is missing", () => {
		expect(parseSnoozeParams({ path: "Tasks/Foo.md" })).toBeUndefined();
	});

	it("rejects 0", () => {
		expect(parseSnoozeParams({ path: "Tasks/Foo.md", for: "0" })).toBeUndefined();
	});

	it("rejects a negative amount", () => {
		expect(parseSnoozeParams({ path: "Tasks/Foo.md", for: "-1h" })).toBeUndefined();
	});

	it("rejects garbage", () => {
		expect(parseSnoozeParams({ path: "Tasks/Foo.md", for: "soon" })).toBeUndefined();
	});
});
