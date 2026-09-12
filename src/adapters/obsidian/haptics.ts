import { Platform } from "obsidian";

import type { Haptics, HapticKind } from "@/ports/haptics";

/** Minimal shape of Capacitor's Haptics plugin — only the two calls this adapter uses. */
interface CapacitorHapticsPlugin {
	impact(options: { style: string }): unknown;
	notification(options: { type: string }): unknown;
}

/** Minimal shape of the `window.Capacitor` global Obsidian mobile may register. */
interface CapacitorGlobal {
	Plugins?: Record<string, unknown>;
	isPluginAvailable?: (name: string) => boolean;
	registerPlugin?: (name: string) => unknown;
}

function isCapacitorHapticsPlugin(value: unknown): value is CapacitorHapticsPlugin {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Record<string, unknown>)["impact"] === "function" &&
		typeof (value as Record<string, unknown>)["notification"] === "function"
	);
}

function isCapacitorGlobal(value: unknown): value is CapacitorGlobal {
	return typeof value === "object" && value !== null;
}

/** Resolves the Haptics plugin off `global.Capacitor`, trying the registered-plugins map before `registerPlugin` — `undefined` if neither exists. */
function resolveHapticsPlugin(global: unknown): CapacitorHapticsPlugin | undefined {
	if (!isCapacitorGlobal(global)) {
		return undefined;
	}
	const capacitor = (global as Record<string, unknown>)["Capacitor"];
	if (!isCapacitorGlobal(capacitor)) {
		return undefined;
	}
	const fromPlugins = capacitor.Plugins?.["Haptics"];
	if (isCapacitorHapticsPlugin(fromPlugins)) {
		return fromPlugins;
	}
	if (capacitor.isPluginAvailable?.("Haptics") === true && capacitor.registerPlugin) {
		try {
			const registered = capacitor.registerPlugin("Haptics");
			if (isCapacitorHapticsPlugin(registered)) {
				return registered;
			}
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/**
 * iOS-only: WKWebView has no `navigator.vibrate`; the only path is Capacitor's Haptics plugin via `window.Capacitor`.
 */
export function createObsidianHaptics(deps: {
	readonly isEnabled: () => boolean;
	readonly platform?: { readonly isIosApp: boolean };
	readonly global?: unknown;
}): Haptics {
	const platform = deps.platform ?? Platform;
	const global = deps.global ?? window;
	let plugin: CapacitorHapticsPlugin | undefined;

	// Only a found plugin is cached: a miss retries, since Obsidian may register Capacitor plugins after our onload.
	function getPlugin(): CapacitorHapticsPlugin | undefined {
		plugin ??= resolveHapticsPlugin(global);
		return plugin;
	}

	return {
		trigger: (kind: HapticKind): void => {
			if (!platform.isIosApp || !deps.isEnabled()) {
				return;
			}
			const haptics = getPlugin();
			if (haptics === undefined) {
				return;
			}
			try {
				const result =
					kind === "light"
						? haptics.impact({ style: "LIGHT" })
						: kind === "medium"
							? haptics.impact({ style: "MEDIUM" })
							: kind === "success"
								? haptics.notification({ type: "SUCCESS" })
								: haptics.notification({ type: "ERROR" });
				// Haptics must never throw into a gesture handler — a rejected promise is swallowed the same as a thrown error.
				void Promise.resolve(result).catch(() => undefined);
			} catch {
				return;
			}
		},
	};
}
