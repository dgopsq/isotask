import { describe, expect, it } from "vitest";

import { makeNavigationMemory } from "@/adapters/navigation/navigation-memory";
import type { CalendarNavigationState } from "@/domain/calendar-navigation";
import type { IsoDate, IsoDateTime } from "@/domain/dates";

function state(): CalendarNavigationState {
	return { view: "week", date: "2026-09-13" as IsoDate, scrollTop: 42, savedAt: "2026-09-13T09:00" as IsoDateTime };
}

describe("makeNavigationMemory", () => {
	it("returns undefined for a key never set", () => {
		expect(makeNavigationMemory().get("missing")).toBeUndefined();
	});

	it("returns what was set under the same key", () => {
		const memory = makeNavigationMemory();
		memory.set("k", state());
		expect(memory.get("k")).toEqual(state());
	});

	it("overwrites a previous value for the same key", () => {
		const memory = makeNavigationMemory();
		memory.set("k", state());
		const next = { ...state(), view: "day" as const };
		memory.set("k", next);
		expect(memory.get("k")).toEqual(next);
	});

	it("keeps different keys independent", () => {
		const memory = makeNavigationMemory();
		memory.set("a", state());
		expect(memory.get("b")).toBeUndefined();
	});
});
