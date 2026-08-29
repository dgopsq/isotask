import type { App } from "obsidian";
import { Modal, Notice, Setting } from "obsidian";

import { describeRRule, parseRRule, RECURRENCE_PRESETS } from "@/domain/recurrence";
import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";
import type { RRuleString } from "@/domain/task";
import { cssClass } from "@/plugin-id";

export interface RecurrenceModalDeps {
	readonly initial: Option<RRuleString>;
	/** `none` clears the recurrence (also what "Remove recurrence" sends). */
	readonly onSave: (rule: Option<string>) => void | Promise<void>;
}

const CUSTOM_OPTION_ID = "custom";

function initialSelection(initial: Option<RRuleString>): { readonly id: string; readonly custom: string } {
	if (!initial.some) {
		return { id: CUSTOM_OPTION_ID, custom: "" };
	}
	const preset = RECURRENCE_PRESETS.find((p) => p.rule === initial.value);
	return preset !== undefined ? { id: preset.id, custom: "" } : { id: CUSTOM_OPTION_ID, custom: initial.value };
}

/** Presets (`domain/recurrence.ts#RECURRENCE_PRESETS`) plus a raw-RRULE custom field, with a live human-readable description. */
export class RecurrenceModal extends Modal {
	private readonly deps: RecurrenceModalDeps;
	private selectedId: string;
	private customValue: string;

	constructor(app: App, deps: RecurrenceModalDeps) {
		super(app);
		this.deps = deps;
		const selection = initialSelection(deps.initial);
		this.selectedId = selection.id;
		this.customValue = selection.custom;
	}

	override onOpen(): void {
		this.setTitle("Set recurrence");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private currentRule(): string | undefined {
		if (this.selectedId === CUSTOM_OPTION_ID) {
			return this.customValue;
		}
		return RECURRENCE_PRESETS.find((p) => p.id === this.selectedId)?.rule;
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass(cssClass("recurrence-modal"));

		const options: Record<string, string> = {};
		for (const preset of RECURRENCE_PRESETS) {
			options[preset.id] = preset.label;
		}
		options[CUSTOM_OPTION_ID] = "Custom…";

		new Setting(contentEl).setName("Repeat").addDropdown((dropdown) =>
			dropdown
				.addOptions(options)
				.setValue(this.selectedId)
				.onChange((value) => {
					this.selectedId = value;
					this.render();
				}),
		);

		if (this.selectedId === CUSTOM_OPTION_ID) {
			new Setting(contentEl).setName("RRULE").addText((text) =>
				text
					.setPlaceholder("`FREQ=WEEKLY;BYDAY=MO`")
					.setValue(this.customValue)
					.onChange((value) => {
						this.customValue = value;
					}),
			);
		}

		contentEl.createEl("p", {
			text: this.describeCurrentRule(),
			cls: cssClass("recurrence-modal-description"),
		});

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						this.save();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Remove recurrence").onClick(() => {
					void Promise.resolve(this.deps.onSave(none())).then(() => {
						this.close();
					});
				}),
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			);
	}

	private describeCurrentRule(): string {
		const rule = this.currentRule();
		if (rule === undefined || rule.trim().length === 0) {
			return "Enter a recurrence rule.";
		}
		const parsed = parseRRule(rule);
		return parsed.ok ? describeRRule(parsed.value) : "Invalid recurrence rule.";
	}

	private save(): void {
		const rule = this.currentRule();
		if (rule === undefined || rule.trim().length === 0) {
			new Notice("Enter a recurrence rule.");
			return;
		}
		const parsed = parseRRule(rule);
		if (!parsed.ok) {
			new Notice("Invalid recurrence rule.");
			return;
		}
		void Promise.resolve(this.deps.onSave(some(parsed.value))).then(() => {
			this.close();
		});
	}
}
