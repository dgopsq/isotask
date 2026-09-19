import type { App } from "obsidian";

import type { LocalState } from "@/ports/local-state";

/** `loadLocalStorage` can throw in some Obsidian mobile contexts (private-mode storage); a thrown read is treated the same as "nothing stored" rather than crashing the reminder tick. */
export function createLocalState(app: App): LocalState {
	return {
		get: (key: string): unknown => {
			try {
				const value: unknown = app.loadLocalStorage(key);
				return value === null ? undefined : value;
			} catch {
				return undefined;
			}
		},
		set: (key: string, value: unknown): void => {
			app.saveLocalStorage(key, value);
		},
	};
}
