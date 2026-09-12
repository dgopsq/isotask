import { describe, expect, it, vi } from "vitest";

// "obsidian" ships types only, no runtime module — every test below passes
// its own `platform`/`global`, so the mock's shape doesn't matter.
vi.mock("obsidian", () => ({ Platform: { isIosApp: false } }));

import { createObsidianHaptics } from "@/adapters/obsidian/haptics";

const IOS = { isIosApp: true };
const NOT_IOS = { isIosApp: false };

function fakeHapticsGlobal(plugin: { impact: ReturnType<typeof vi.fn>; notification: ReturnType<typeof vi.fn> }) {
	return { Capacitor: { Plugins: { Haptics: plugin } } };
}

describe("createObsidianHaptics", () => {
	it("is a no-op when not on iOS", () => {
		const plugin = { impact: vi.fn(), notification: vi.fn() };
		const haptics = createObsidianHaptics({ isEnabled: () => true, platform: NOT_IOS, global: fakeHapticsGlobal(plugin) });
		haptics.trigger("light");
		expect(plugin.impact).not.toHaveBeenCalled();
	});

	it("is a no-op when disabled", () => {
		const plugin = { impact: vi.fn(), notification: vi.fn() };
		const haptics = createObsidianHaptics({ isEnabled: () => false, platform: IOS, global: fakeHapticsGlobal(plugin) });
		haptics.trigger("light");
		expect(plugin.impact).not.toHaveBeenCalled();
	});

	it("is a no-op when there is no Capacitor global", () => {
		const haptics = createObsidianHaptics({ isEnabled: () => true, platform: IOS, global: {} });
		expect(() => {
			haptics.trigger("light");
		}).not.toThrow();
	});

	it("maps each kind to the right plugin call via Plugins.Haptics", () => {
		const plugin = { impact: vi.fn(), notification: vi.fn() };
		const haptics = createObsidianHaptics({ isEnabled: () => true, platform: IOS, global: fakeHapticsGlobal(plugin) });

		haptics.trigger("light");
		expect(plugin.impact).toHaveBeenCalledWith({ style: "LIGHT" });

		haptics.trigger("medium");
		expect(plugin.impact).toHaveBeenCalledWith({ style: "MEDIUM" });

		haptics.trigger("success");
		expect(plugin.notification).toHaveBeenCalledWith({ type: "SUCCESS" });

		haptics.trigger("error");
		expect(plugin.notification).toHaveBeenCalledWith({ type: "ERROR" });
	});

	it("falls back to registerPlugin when Plugins.Haptics is absent", () => {
		const plugin = { impact: vi.fn(), notification: vi.fn() };
		const global = {
			Capacitor: {
				Plugins: {},
				isPluginAvailable: (name: string) => name === "Haptics",
				registerPlugin: (name: string) => (name === "Haptics" ? plugin : undefined),
			},
		};
		const haptics = createObsidianHaptics({ isEnabled: () => true, platform: IOS, global });
		haptics.trigger("light");
		expect(plugin.impact).toHaveBeenCalledWith({ style: "LIGHT" });
	});

	it("swallows a rejected promise", async () => {
		const plugin = { impact: vi.fn().mockReturnValue(Promise.reject(new Error("boom"))), notification: vi.fn() };
		const haptics = createObsidianHaptics({ isEnabled: () => true, platform: IOS, global: fakeHapticsGlobal(plugin) });
		expect(() => {
			haptics.trigger("light");
		}).not.toThrow();
		// Let the rejection's catch handler (queued as a microtask) run before the test exits, so an unhandled rejection can't leak into a later test.
		await new Promise((resolve) => {
			queueMicrotask(() => {
				resolve(undefined);
			});
		});
	});
});
