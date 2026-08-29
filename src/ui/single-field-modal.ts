import { Setting } from "obsidian";

/**
 * Awaits `action` (an `onSave` callback may be sync or async) and then runs
 * `close`. Every single-field modal (`ProjectModal`, `TagsModal`,
 * `DurationModal`, `DateModal`) resolves its `deps.onSave` call this way,
 * on both Save and Clear.
 */
export function resolveThenClose<T>(action: () => T | Promise<T>, close: () => void): void {
	void Promise.resolve(action()).then(() => {
		close();
	});
}

export interface SaveClearCancelHandlers {
	readonly onSave: () => void;
	readonly onClear: () => void;
	readonly onCancel: () => void;
}

/**
 * Renders the Save (CTA) / Clear / Cancel button row shared by every
 * single-field modal (`ProjectModal`, `TagsModal`, `DurationModal`,
 * `DateModal`). Callers own validation and closing — only this trailing
 * button row is common; the field(s) above it stay modal-specific.
 */
export function renderSaveClearCancel(contentEl: HTMLElement, handlers: SaveClearCancelHandlers): Setting {
	return new Setting(contentEl)
		.addButton((button) =>
			button
				.setButtonText("Save")
				.setCta()
				.onClick(() => {
					handlers.onSave();
				}),
		)
		.addButton((button) =>
			button.setButtonText("Clear").onClick(() => {
				handlers.onClear();
			}),
		)
		.addButton((button) =>
			button.setButtonText("Cancel").onClick(() => {
				handlers.onCancel();
			}),
		);
}
