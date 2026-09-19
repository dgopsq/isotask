import type { App } from "obsidian";
import { Modal, Notice, Setting } from "obsidian";

import type { TaskDate } from "@/domain/dates";
import { isDateTime, parseTaskDate } from "@/domain/dates";
import type { OffsetUnit } from "@/domain/reminder-presets";
import { describeReminders, matchReminderPreset, offsetMinutes, offsetParts, REMINDER_PRESETS } from "@/domain/reminder-presets";
import type { ReminderDefaults, ReminderSpec } from "@/domain/reminders";
import { defaultReminderSpecs } from "@/domain/reminders";
import { cssClass } from "@/plugin-id";
import { resolveThenClose } from "@/ui/single-field-modal";

export interface ReminderModalDeps {
	readonly initial: readonly ReminderSpec[] | undefined;
	readonly anchor: TaskDate | undefined;
	readonly defaults: ReminderDefaults;
	/** `undefined` removes the `remind` property (falls back to the vault default). */
	readonly onSave: (specs: readonly ReminderSpec[] | undefined) => void | Promise<void>;
}

const CURRENT_OPTION_ID = "current";
const CUSTOM_OPTION_ID = "custom";
const ABSOLUTE_OPTION_ID = "absolute";

const UNIT_OPTIONS: Record<string, string> = { m: "Minutes", h: "Hours", d: "Days", w: "Weeks" };

interface Selection {
	readonly id: string;
	readonly customAmount: string;
	readonly customUnit: OffsetUnit;
	readonly absoluteValue: string;
}

/** `initial` with more than one spec can't map to a single preset/custom/absolute field, so it gets its own "current" option instead. */
function initialSelection(initial: readonly ReminderSpec[] | undefined, defaults: ReminderDefaults): Selection {
	const blank = { customAmount: "", customUnit: "m" as OffsetUnit, absoluteValue: "" };

	if (initial !== undefined && initial.length > 1) {
		return { id: CURRENT_OPTION_ID, ...blank };
	}
	if (initial === undefined) {
		const preset = matchReminderPreset(defaultReminderSpecs(defaults));
		return { id: preset?.id ?? "none", ...blank };
	}

	const preset = matchReminderPreset(initial);
	if (preset !== undefined) {
		return { id: preset.id, ...blank };
	}

	const spec = initial[0];
	if (spec?.kind === "offset") {
		const { amount, unit } = offsetParts(spec.minutes);
		return { id: CUSTOM_OPTION_ID, customAmount: String(amount), customUnit: unit, absoluteValue: "" };
	}
	if (spec?.kind === "absolute") {
		return { id: ABSOLUTE_OPTION_ID, ...blank, absoluteValue: spec.at };
	}
	return { id: CUSTOM_OPTION_ID, ...blank };
}

type SpecsOrError = { readonly specs: readonly ReminderSpec[] } | { readonly error: string };

/** "Use default" removes `remind` instead of writing the matching spec, so the task keeps following the vault default if it changes. */
export class ReminderModal extends Modal {
	private readonly deps: ReminderModalDeps;
	private readonly hasCurrentOption: boolean;
	private selectedId: string;
	private customAmount: string;
	private customUnit: OffsetUnit;
	private absoluteValue: string;
	private descEl: HTMLParagraphElement | undefined;

	constructor(app: App, deps: ReminderModalDeps) {
		super(app);
		this.deps = deps;
		this.hasCurrentOption = deps.initial !== undefined && deps.initial.length > 1;
		const selection = initialSelection(deps.initial, deps.defaults);
		this.selectedId = selection.id;
		this.customAmount = selection.customAmount;
		this.customUnit = selection.customUnit;
		this.absoluteValue = selection.absoluteValue;
	}

	override onOpen(): void {
		this.setTitle("Set reminder");
		// Only from a text field: a scope-wide Enter would also fire on a focused Cancel button.
		this.scope.register([], "Enter", (evt) => {
			if (!(evt.target instanceof HTMLInputElement)) {
				return true;
			}
			this.save();
			return false;
		});
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass(cssClass("reminder-modal"));

		const options: Record<string, string> = {};
		if (this.hasCurrentOption) {
			options[CURRENT_OPTION_ID] = describeReminders(this.deps.initial ?? [], this.deps.anchor);
		}
		for (const preset of REMINDER_PRESETS) {
			options[preset.id] = preset.label;
		}
		options[CUSTOM_OPTION_ID] = "Custom offset…";
		options[ABSOLUTE_OPTION_ID] = "At a specific time…";

		new Setting(contentEl)
			.setName("Reminder")
			.setDesc("Before the scheduled date, or the due date if there is none.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(options)
					.setValue(this.selectedId)
					.onChange((value) => {
						this.selectedId = value;
						this.render();
					}),
			);

		if (this.selectedId === CUSTOM_OPTION_ID) {
			this.renderCustomRow(contentEl);
		}
		if (this.selectedId === ABSOLUTE_OPTION_ID) {
			this.renderAbsoluteRow(contentEl);
		}

		this.descEl = contentEl.createEl("p", {
			text: this.describeCurrent(),
			cls: cssClass("reminder-modal-description"),
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
				button.setButtonText("Use default").onClick(() => {
					resolveThenClose(() => this.deps.onSave(undefined), this.close.bind(this));
				}),
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			);
	}

	private renderCustomRow(container: HTMLElement): void {
		new Setting(container)
			.setName("Offset")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.inputMode = "numeric";
				text.setValue(this.customAmount).onChange((value) => {
					this.customAmount = value;
					this.updateDescription();
				});
			})
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(UNIT_OPTIONS)
					.setValue(this.customUnit)
					.onChange((value) => {
						this.customUnit = value as OffsetUnit;
						this.render();
					}),
			);
	}

	private renderAbsoluteRow(container: HTMLElement): void {
		new Setting(container).setName("Date & time").addText((text) => {
			text.inputEl.type = "datetime-local";
			text.setValue(this.absoluteValue).onChange((value) => {
				this.absoluteValue = value;
				this.updateDescription();
			});
		});
	}

	/** Updates the description text in place, not a full `render()` — a re-render on every keystroke would drop focus from the field being typed into. */
	private updateDescription(): void {
		this.descEl?.setText(this.describeCurrent());
	}

	private currentSpecsOrError(): SpecsOrError {
		if (this.selectedId === CURRENT_OPTION_ID) {
			return { specs: this.deps.initial ?? [] };
		}
		const preset = REMINDER_PRESETS.find((p) => p.id === this.selectedId);
		if (preset !== undefined) {
			return { specs: preset.specs };
		}
		if (this.selectedId === CUSTOM_OPTION_ID) {
			const amount = Number(this.customAmount.trim());
			if (!Number.isSafeInteger(amount) || amount <= 0) {
				return { error: "Enter an offset." };
			}
			return { specs: [{ kind: "offset", minutes: offsetMinutes(amount, this.customUnit) }] };
		}
		if (this.selectedId === ABSOLUTE_OPTION_ID) {
			const trimmed = this.absoluteValue.trim();
			const parsed = trimmed.length > 0 ? parseTaskDate(trimmed) : undefined;
			if (parsed === undefined || !parsed.ok || !isDateTime(parsed.value)) {
				return { error: "Enter a date and time." };
			}
			return { specs: [{ kind: "absolute", at: parsed.value }] };
		}
		return { error: "Select a reminder." };
	}

	private describeCurrent(): string {
		const result = this.currentSpecsOrError();
		return "error" in result ? result.error : describeReminders(result.specs, this.deps.anchor);
	}

	private save(): void {
		const result = this.currentSpecsOrError();
		if ("error" in result) {
			new Notice(result.error);
			return;
		}
		resolveThenClose(() => this.deps.onSave(result.specs), this.close.bind(this));
	}
}
