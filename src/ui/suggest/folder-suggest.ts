import type { App, TFolder } from "obsidian";
import { AbstractInputSuggest } from "obsidian";

import { matchesQuery } from "./match";

const MAX_SUGGESTIONS = 50;

/** Suggests vault folders for a text input (the Folder field), writing the selected folder's path on select. */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private readonly targetInputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.targetInputEl = inputEl;
		this.limit = MAX_SUGGESTIONS;
	}

	protected override getSuggestions(query: string): TFolder[] {
		const folders = this.app.vault.getAllFolders(true);
		const matched = folders.filter((folder) => matchesQuery(folder.path, query));
		return matched.slice(0, MAX_SUGGESTIONS);
	}

	override renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.createDiv({ text: folder.isRoot() ? "/" : folder.path });
	}

	override selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.targetInputEl.dispatchEvent(new Event("input"));
		this.close();
	}
}
