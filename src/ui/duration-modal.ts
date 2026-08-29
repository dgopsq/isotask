import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";

import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";
import type { Minutes } from "@/domain/task";
import { cssClass } from "@/plugin-id";
import { renderSaveClearCancel, resolveThenClose } from "@/ui/single-field-modal";

export interface DurationModalDeps {
	readonly initial: Option<Minutes>;
	readonly onSave: (value: Option<Minutes>) => void | Promise<void>;
}

/** Sets or clears a task's `duration`, in minutes — same single-field/Save-Clear-Cancel shape as `DateModal`. */
export class DurationModal extends Modal {
	private readonly deps: DurationModalDeps;
	private value: string;

	constructor(app: App, deps: DurationModalDeps) {
		super(app);
		this.deps = deps;
		this.value = deps.initial.some ? String(deps.initial.value) : "";
	}

	override onOpen(): void {
		this.setTitle("Set duration");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass(cssClass("duration-modal"));

		new Setting(contentEl)
			.setName("Duration (minutes)")
			.setDesc("Length of the scheduled block.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.setValue(this.value).onChange((value) => {
					this.value = value;
				});
			});

		renderSaveClearCancel(contentEl, {
			onSave: () => {
				this.save();
			},
			onClear: () => {
				resolveThenClose(() => this.deps.onSave(none()), this.close.bind(this));
			},
			onCancel: () => {
				this.close();
			},
		});
	}

	private save(): void {
		const trimmed = this.value.trim();
		if (trimmed.length === 0) {
			resolveThenClose(() => this.deps.onSave(none()), this.close.bind(this));
			return;
		}
		const parsed = Number(trimmed);
		if (!Number.isFinite(parsed) || parsed < 0) {
			return;
		}
		resolveThenClose(() => this.deps.onSave(some(parsed as Minutes)), this.close.bind(this));
	}
}
