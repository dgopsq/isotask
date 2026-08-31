import type { App, TFile } from "obsidian";
import { FuzzySuggestModal } from "obsidian";

/**
 * Fuzzy-picks any vault markdown note, e.g. for the "Set project color…"
 * command — unlike `ui/suggest/note-suggest.ts` (an `AbstractInputSuggest`
 * bound to one text field, matching on basename/path), this is a
 * standalone full-screen picker for commands that have no field of their
 * own to attach a suggest to. Same shape as `PrioritySuggestModal`/
 * `StatusSuggestModal`.
 */
export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	private readonly onPick: (file: TFile) => void;

	constructor(app: App, onPick: (file: TFile) => void) {
		super(app);
		this.onPick = onPick;
		this.setPlaceholder("Choose a note…");
	}

	override getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	override getItemText(item: TFile): string {
		return item.path;
	}

	override onChooseItem(item: TFile): void {
		this.onPick(item);
	}
}
