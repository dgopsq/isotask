import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";

import { cssClass } from "@/plugin-id";
import { renderSaveClearCancel, resolveThenClose } from "@/ui/single-field-modal";
import { TagSuggest } from "@/ui/suggest/tag-suggest";

export interface TagsModalDeps {
	readonly initial: readonly string[];
	readonly onSave: (tags: readonly string[]) => void | Promise<void>;
}

/** Sets a task's `tags` via a comma-separated field with `TagSuggest`, same convention as the create-task modal's Tags field. */
export class TagsModal extends Modal {
	private readonly deps: TagsModalDeps;
	private value: string;

	constructor(app: App, deps: TagsModalDeps) {
		super(app);
		this.deps = deps;
		this.value = deps.initial.join(", ");
	}

	override onOpen(): void {
		this.setTitle("Set tags");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass(cssClass("tags-modal"));

		new Setting(contentEl)
			.setName("Tags")
			.setDesc("Comma-separated, without #.")
			.addText((text) => {
				text
					.setPlaceholder("Comma-separated tags")
					.setValue(this.value)
					.onChange((value) => {
						this.value = value;
					});
				new TagSuggest(this.app, text.inputEl);
			});

		renderSaveClearCancel(contentEl, {
			onSave: () => {
				this.save();
			},
			onClear: () => {
				resolveThenClose(() => this.deps.onSave([]), this.close.bind(this));
			},
			onCancel: () => {
				this.close();
			},
		});
	}

	private save(): void {
		const tags = this.value
			.split(",")
			.map((tag) => tag.trim())
			.filter((tag) => tag.length > 0);
		resolveThenClose(() => this.deps.onSave(tags), this.close.bind(this));
	}
}
