import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";

import type { TaskDate } from "@/domain/dates";
import { isDateTime, parseTaskDate } from "@/domain/dates";
import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";
import { cssClass } from "@/plugin-id";

export interface DateModalDeps {
	readonly title: string;
	readonly initial: Option<TaskDate>;
	readonly onSave: (value: Option<TaskDate>) => void | Promise<void>;
}

/**
 * Sets or clears a task's `due`/`scheduled` date. A date/datetime toggle
 * swaps the input's `type` between `date` and `datetime-local` — both HTML
 * input value formats already match `IsoDate`/`IsoDateTime`
 * (`YYYY-MM-DD`/`YYYY-MM-DDTHH:mm`), so the field's raw string value can be
 * handed to `parseTaskDate` unconverted.
 */
export class DateModal extends Modal {
	private readonly deps: DateModalDeps;
	private hasTime: boolean;
	private value: string;

	constructor(app: App, deps: DateModalDeps) {
		super(app);
		this.deps = deps;
		this.hasTime = deps.initial.some && isDateTime(deps.initial.value);
		this.value = deps.initial.some ? deps.initial.value : "";
	}

	override onOpen(): void {
		this.setTitle(this.deps.title);
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass(cssClass("date-modal"));

		const desc = this.deps.title.toLowerCase().includes("scheduled")
			? "When you plan to work on it. Shown on the calendar."
			: "When the task must be done.";

		new Setting(contentEl)
			.setName(this.hasTime ? "Date & time" : "Date")
			.setDesc(desc)
			.addText((text) => {
				text.inputEl.type = this.hasTime ? "datetime-local" : "date";
				text.setValue(this.value).onChange((value) => {
					this.value = value;
				});
			});

		new Setting(contentEl)
			.setName("Include time")
			.setDesc("Adds a time of day to the date.")
			.addToggle((toggle) =>
				toggle.setValue(this.hasTime).onChange((checked) => {
					// Truncate to the date part when turning time off, so the input
					// doesn't carry a stale time-of-day the user can no longer see.
					this.value = checked ? this.value : this.value.slice(0, 10);
					this.hasTime = checked;
					this.render();
				}),
			);

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
				button.setButtonText("Clear").onClick(() => {
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

	private save(): void {
		const trimmed = this.value.trim();
		if (trimmed.length === 0) {
			void Promise.resolve(this.deps.onSave(none())).then(() => {
				this.close();
			});
			return;
		}

		const parsed = parseTaskDate(trimmed);
		if (!parsed.ok) {
			return;
		}
		void Promise.resolve(this.deps.onSave(some(parsed.value))).then(() => {
			this.close();
		});
	}
}
