import type { App } from "obsidian";
import { AbstractInputSuggest, getAllTags } from "obsidian";

import { matchesQuery } from "./match";

const MAX_SUGGESTIONS = 50;

interface TokenSplit {
	/** Everything up to and including the last comma, unchanged. */
	readonly prefix: string;
	/** The in-progress token after the last comma (or the whole value, if there is no comma yet). */
	readonly last: string;
}

/** Splits a comma-separated "Tags" input into its completed prefix and the token currently being typed. */
function splitLastToken(value: string): TokenSplit {
	const lastComma = value.lastIndexOf(",");
	return lastComma === -1
		? { prefix: "", last: value }
		: { prefix: value.slice(0, lastComma + 1), last: value.slice(lastComma + 1) };
}

/**
 * Suggests vault tags (without the leading `#`) for the comma-separated Tags
 * field. Only the token after the final comma is matched/completed; earlier
 * tokens are preserved verbatim. There's no `app.metadataCache.getTags()` in
 * this Obsidian API version's types, so the tag set is built from every
 * markdown file's cache via the typed top-level `getAllTags`.
 */
export class TagSuggest extends AbstractInputSuggest<string> {
	private readonly targetInputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.targetInputEl = inputEl;
		this.limit = MAX_SUGGESTIONS;
	}

	protected override getSuggestions(query: string): string[] {
		const { last } = splitLastToken(query);
		const matched = this.allTags().filter((tag) => matchesQuery(tag, last));
		return matched.slice(0, MAX_SUGGESTIONS);
	}

	override renderSuggestion(tag: string, el: HTMLElement): void {
		el.createDiv({ text: tag });
	}

	override selectSuggestion(tag: string): void {
		const { prefix } = splitLastToken(this.getValue());
		this.setValue(`${prefix}${prefix.length > 0 ? " " : ""}${tag}, `);
		this.targetInputEl.dispatchEvent(new Event("input"));
		this.close();
	}

	private allTags(): string[] {
		const tags = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			const fileTags = cache === null ? null : getAllTags(cache);
			for (const tag of fileTags ?? []) {
				tags.add(tag.startsWith("#") ? tag.slice(1) : tag);
			}
		}
		return [...tags].sort();
	}
}
