import { describe, expect, it, vi } from "vitest";

// Same idiom as haptics.test.ts: only `parseOpenParams` is exercised, which never
// touches the obsidian runtime, so the mock's shape doesn't matter.
vi.mock("obsidian", () => ({ normalizePath: (path: string) => path, Notice: vi.fn() }));

import { parseOpenParams } from "@/adapters/obsidian/protocol-handler";

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
