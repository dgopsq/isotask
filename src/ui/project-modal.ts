import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";

import { projectFromWikilink } from "@/domain/frontmatter";
import { cssClass } from "@/plugin-id";
import { renderSaveClearCancel, resolveThenClose } from "@/ui/single-field-modal";
import { NoteSuggest } from "@/ui/suggest/note-suggest";

export interface ProjectModalDeps {
	readonly initial: string | null;
	readonly onSave: (project: string | null) => void | Promise<void>;
}

/**
 * Sets or clears a task's `project`. A single text field with `NoteSuggest`
 * (the field stores a bare title; `projectFromWikilink` is identity on one,
 * so pasting a `[[wikilink]]` in also round-trips correctly — same
 * convention as the create-task modal's Project field).
 */
export class ProjectModal extends Modal {
	private readonly deps: ProjectModalDeps;
	private value: string;

	constructor(app: App, deps: ProjectModalDeps) {
		super(app);
		this.deps = deps;
		this.value = deps.initial ?? "";
	}

	override onOpen(): void {
		this.setTitle("Set project");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass(cssClass("project-modal"));

		new Setting(contentEl)
			.setName("Project")
			.setDesc("Project note, e.g. `[[Launch]]`.")
			.addText((text) => {
				text
					.setPlaceholder("Project name or [[link]]")
					.setValue(this.value)
					.onChange((value) => {
						this.value = value;
					});
				new NoteSuggest(this.app, text.inputEl);
			});

		renderSaveClearCancel(contentEl, {
			onSave: () => {
				this.save();
			},
			onClear: () => {
				resolveThenClose(() => this.deps.onSave(null), this.close.bind(this));
			},
			onCancel: () => {
				this.close();
			},
		});
	}

	private save(): void {
		const trimmed = this.value.trim();
		if (trimmed.length === 0) {
			resolveThenClose(() => this.deps.onSave(null), this.close.bind(this));
			return;
		}
		resolveThenClose(() => this.deps.onSave(projectFromWikilink(trimmed)), this.close.bind(this));
	}
}
