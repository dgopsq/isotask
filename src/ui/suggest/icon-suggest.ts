import type { App } from "obsidian";
import { AbstractInputSuggest, getIconIds, setIcon } from "obsidian";

import { cssClass } from "@/plugin-id";

import { matchesQuery } from "./match";

const MAX_SUGGESTIONS = 50;

/** Suggests Obsidian's built-in icon ids for a text input (the status Icon field), previewing the icon beside each id. */
export class IconSuggest extends AbstractInputSuggest<string> {
	private readonly targetInputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.targetInputEl = inputEl;
		this.limit = MAX_SUGGESTIONS;
	}

	protected override getSuggestions(query: string): string[] {
		const matched = getIconIds().filter((id) => matchesQuery(id, query));
		return matched.slice(0, MAX_SUGGESTIONS);
	}

	override renderSuggestion(id: string, el: HTMLElement): void {
		const iconEl = el.createSpan({ cls: cssClass("suggest-icon") });
		setIcon(iconEl, id);
		el.createSpan({ text: id });
	}

	override selectSuggestion(id: string): void {
		this.setValue(id);
		this.targetInputEl.dispatchEvent(new Event("input"));
		this.close();
	}
}
