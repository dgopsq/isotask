import type { App, TFile } from "obsidian";
import { AbstractInputSuggest } from "obsidian";

import { cssClass } from "@/plugin-id";

import { matchesQuery } from "./match";

const MAX_SUGGESTIONS = 50;

/**
 * Suggests vault markdown notes for a text input (the Project field),
 * matching on basename and full path, and writes the selected note's
 * **basename** into the input on select. Deliberately not a wikilink: the
 * modal's `submit()` already runs the raw project text through
 * `projectFromWikilink` (identity on a bare title) before the frontmatter
 * writer wraps it back via `toWikilink`, so a plain basename round-trips
 * exactly like a hand-typed one did.
 */
export class NoteSuggest extends AbstractInputSuggest<TFile> {
	private readonly targetInputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.targetInputEl = inputEl;
		this.limit = MAX_SUGGESTIONS;
	}

	protected override getSuggestions(query: string): TFile[] {
		const files = this.app.vault.getMarkdownFiles();
		const matched = files.filter((file) => matchesQuery(file.basename, query) || matchesQuery(file.path, query));
		return matched.slice(0, MAX_SUGGESTIONS);
	}

	override renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createDiv({ text: file.basename });
		if (file.path !== `${file.basename}.md`) {
			el.createDiv({ text: file.path, cls: cssClass("suggest-path") });
		}
	}

	override selectSuggestion(file: TFile): void {
		this.setValue(file.basename);
		this.targetInputEl.dispatchEvent(new Event("input"));
		this.close();
	}
}
