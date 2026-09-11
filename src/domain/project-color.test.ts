import { describe, expect, it } from "vitest";

import type { DotColor, PaletteName } from "@/domain/project-color";
import { dotColorClasses, hashPaletteColor, paletteColorClass, parseProjectColor, resolveDotColor, serializeProjectColor } from "@/domain/project-color";

describe("parseProjectColor", () => {
	it.each(["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const)(
		"accepts the palette name %s",
		(name) => {
			expect(parseProjectColor(name)).toEqual({ kind: "palette", name });
		},
	);

	it("is case-insensitive for palette names", () => {
		expect(parseProjectColor("RED")).toEqual({ kind: "palette", name: "red" });
		expect(parseProjectColor("ReD")).toEqual({ kind: "palette", name: "red" });
	});

	it("trims surrounding whitespace before matching a palette name", () => {
		expect(parseProjectColor("  blue  ")).toEqual({ kind: "palette", name: "blue" });
	});

	it("accepts a 6-digit hex string and normalises it to lowercase", () => {
		expect(parseProjectColor("#A1B2C3")).toEqual({ kind: "hex", value: "#a1b2c3" });
	});

	it("accepts a 3-digit hex string and normalises it to lowercase", () => {
		expect(parseProjectColor("#ABC")).toEqual({ kind: "hex", value: "#abc" });
	});

	it("trims surrounding whitespace before matching a hex string", () => {
		expect(parseProjectColor("  #abc123  ")).toEqual({ kind: "hex", value: "#abc123" });
	});

	it.each([
		"scarlet",
		"#gggggg",
		"#12345",
		"#1234567",
		"abc123",
		"",
		"   ",
		"#",
		"reddish",
	])("rejects invalid string %p", (value) => {
		expect(parseProjectColor(value)).toBeUndefined();
	});

	it.each([undefined, null, 42, true, {}, [], ["red"]])("rejects non-string value %p", (value) => {
		expect(parseProjectColor(value)).toBeUndefined();
	});
});

describe("hashPaletteColor", () => {
	// Locks in the exact djb2a output for a handful of fixed names — the
	// algorithm is frozen (see the doc comment on `hashPaletteColor`), so
	// these assertions must never be "fixed" to match a changed
	// implementation; a failure here means the algorithm changed, which is
	// the thing this test exists to catch.
	it.each([
		["Work", "cyan"],
		["Home Renovation", "pink"],
		["Zzz Project", "yellow"],
		["", "blue"],
	] as const satisfies readonly (readonly [string, PaletteName])[])("hashes %p to %s", (name, expected) => {
		expect(hashPaletteColor(name)).toBe(expected);
	});

	it("is deterministic for the same name", () => {
		expect(hashPaletteColor("Consistency")).toBe(hashPaletteColor("Consistency"));
	});

	it("is case-sensitive (different-case names may hash differently)", () => {
		// Not asserting a specific relationship — just that this is plain
		// string hashing, with no case-folding step of its own (unlike
		// `parseProjectColor`, which lower-cases before matching).
		expect(typeof hashPaletteColor("Project")).toBe("string");
		expect(typeof hashPaletteColor("PROJECT")).toBe("string");
	});

	it("always returns one of the 8 palette names for arbitrary input", () => {
		const palette = new Set(["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"]);
		for (const name of ["a", "bb", "ccc", "dddd", "eeeee", "Task Project 42", "🎯 emoji project"]) {
			expect(palette.has(hashPaletteColor(name))).toBe(true);
		}
	});
});

describe("resolveDotColor", () => {
	it("returns neutral when the task has no project", () => {
		expect(resolveDotColor("red", undefined)).toEqual({ kind: "neutral" });
		expect(resolveDotColor(undefined, undefined)).toEqual({ kind: "neutral" });
	});

	it("returns the parsed project color when the raw color is valid", () => {
		expect(resolveDotColor("purple", "Work")).toEqual({ kind: "palette", name: "purple" });
		expect(resolveDotColor("#123456", "Work")).toEqual({ kind: "hex", value: "#123456" });
	});

	it("falls back to the hashed palette color when the raw color is missing", () => {
		expect(resolveDotColor(undefined, "Work")).toEqual({ kind: "palette", name: hashPaletteColor("Work") });
	});

	it("falls back to the hashed palette color when the raw color is invalid", () => {
		expect(resolveDotColor("not-a-color", "Work")).toEqual({ kind: "palette", name: hashPaletteColor("Work") });
		expect(resolveDotColor(42, "Work")).toEqual({ kind: "palette", name: hashPaletteColor("Work") });
	});

	it("the hashed fallback follows the project's own name", () => {
		expect(resolveDotColor(undefined, "Home Renovation")).toEqual({ kind: "palette", name: "pink" });
	});
});

describe("paletteColorClass", () => {
	it.each(["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const)(
		"maps %s to color-%s",
		(name) => {
			expect(paletteColorClass(name)).toBe(`color-${name}`);
		},
	);
});

describe("dotColorClasses", () => {
	it("maps a palette DotColor to one isotask-color-<name> class", () => {
		const dotColor: DotColor = { kind: "palette", name: "green" };
		expect(dotColorClasses(dotColor)).toEqual(["isotask-color-green"]);
	});

	it("maps a hex DotColor to no classes (applied directly as a custom property instead — see the doc comment)", () => {
		const dotColor: DotColor = { kind: "hex", value: "#a1b2c3" };
		expect(dotColorClasses(dotColor)).toEqual([]);
	});

	it("maps neutral to no classes", () => {
		const dotColor: DotColor = { kind: "neutral" };
		expect(dotColorClasses(dotColor)).toEqual([]);
	});
});

describe("serializeProjectColor", () => {
	it("serializes a palette color to its bare name", () => {
		expect(serializeProjectColor({ kind: "palette", name: "cyan" })).toBe("cyan");
	});

	it("serializes a hex color to its (already-normalised) value", () => {
		expect(serializeProjectColor({ kind: "hex", value: "#a1b2c3" })).toBe("#a1b2c3");
	});

	it("round-trips through parseProjectColor", () => {
		const parsed = parseProjectColor("#ABC");
		expect(parsed).not.toBeUndefined();
		if (parsed !== undefined) {
			expect(serializeProjectColor(parsed)).toBe("#abc");
		}
	});
});
