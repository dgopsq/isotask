import { Platform } from "obsidian";

import type { AppBadge } from "@/ports/app-badge";

interface BadgingNavigator {
	readonly setAppBadge: (count?: number) => Promise<void>;
	readonly clearAppBadge: () => Promise<void>;
}

function hasBadging(value: Navigator): value is Navigator & BadgingNavigator {
	return "setAppBadge" in value && typeof value.setAppBadge === "function" && "clearAppBadge" in value && typeof value.clearAppBadge === "function";
}

/** Web Badging API, desktop only — Electron's renderer exposes it, mobile Obsidian does not. */
export function createAppBadge(): AppBadge {
	function swallow(result: Promise<void>): void {
		result.catch(() => undefined);
	}

	return {
		isAvailable: (): boolean => Platform.isDesktopApp && hasBadging(navigator),

		// setAppBadge(0) is rejected by Electron, so zero clears instead.
		set: (count: number): void => {
			if (!hasBadging(navigator)) {
				return;
			}
			swallow(count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge());
		},

		clear: (): void => {
			if (hasBadging(navigator)) {
				swallow(navigator.clearAppBadge());
			}
		},
	};
}
