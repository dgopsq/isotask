import { Notice } from "obsidian";

import type { Notifier } from "@/ports/notifier";

export function createObsidianNotifier(): Notifier {
	return {
		info: (message: string): void => {
			new Notice(message);
		},
		error: (message: string): void => {
			new Notice(message);
		},
	};
}
