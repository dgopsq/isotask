import type { App } from "obsidian";
import { Modal, Notice, Setting } from "obsidian";

import type { TaskDraft } from "@/app/create-task";
import type { AppError } from "@/app/errors";
import { describeAppError } from "@/app/errors";
import type { TaskDate } from "@/domain/dates";
import { isDateTime, parseTaskDate } from "@/domain/dates";
import { projectFromWikilink } from "@/domain/frontmatter";
import { describeRRule, parseRRule, RECURRENCE_PRESETS } from "@/domain/recurrence";
import type { Result } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import type { Minutes, Priority, RRuleString, StatusId, TaskPath } from "@/domain/task";
import { PRIORITIES } from "@/domain/task";
import { cssClass } from "@/plugin-id";

export interface CreateTaskModalDeps {
	readonly app: App;
	readonly createTask: (draft: TaskDraft) => Promise<Result<TaskPath, AppError>>;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getDefaultFolder: () => string;
	/** Prefill (M4's calendar "click empty slot" flow passes a clicked date this way). */
	readonly initial?: Partial<TaskDraft>;
}

const PRIORITY_LABELS: Readonly<Record<Priority, string>> = {
	low: "Low",
	normal: "Normal",
	high: "High",
	urgent: "Urgent",
};

const NO_REPEAT_ID = "none";
const CUSTOM_REPEAT_ID = "custom";

interface DateFieldState {
	readonly value: string;
	readonly hasTime: boolean;
}

function dateFieldFrom(initial: TaskDate | undefined): DateFieldState {
	return initial === undefined ? { value: "", hasTime: false } : { value: initial, hasTime: isDateTime(initial) };
}

function repeatSelectionFrom(initial: RRuleString | undefined): { readonly id: string; readonly custom: string } {
	if (initial === undefined) {
		return { id: NO_REPEAT_ID, custom: "" };
	}
	const preset = RECURRENCE_PRESETS.find((p) => p.rule === initial);
	return preset !== undefined ? { id: preset.id, custom: "" } : { id: CUSTOM_REPEAT_ID, custom: initial };
}

/** Parses a `DateFieldState`'s raw text into `TaskDate | undefined`, or `"invalid"` for an unparsable non-empty value. */
function parseDateField(field: DateFieldState): TaskDate | undefined | "invalid" {
	const trimmed = field.value.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	const parsed = parseTaskDate(trimmed);
	return parsed.ok ? parsed.value : "invalid";
}

/**
 * Create-task modal. State lives on instance fields; the modal only does a
 * full re-render on a structural change (a dropdown that reveals/hides a
 * field, or a date/time toggle) — plain text fields update state in
 * `onChange` without re-rendering, so typing never loses focus.
 */
export class CreateTaskModal extends Modal {
	private readonly deps: CreateTaskModalDeps;

	private title: string;
	private folder: string;
	private statusId: StatusId | undefined;
	private priority: Priority;
	private due: DateFieldState;
	private scheduled: DateFieldState;
	private durationText: string;
	private repeatId: string;
	private repeatCustom: string;
	private project: string;
	private tagsText: string;
	private submitting = false;

	constructor(app: App, deps: CreateTaskModalDeps) {
		super(app);
		this.deps = deps;

		const initial = deps.initial ?? {};
		this.title = initial.title ?? "";
		this.folder = initial.folder ?? deps.getDefaultFolder();
		this.statusId = initial.status;
		this.priority = initial.priority ?? "normal";
		this.due = dateFieldFrom(initial.due);
		this.scheduled = dateFieldFrom(initial.scheduled);
		this.durationText = initial.duration !== undefined ? String(initial.duration) : "";
		const repeat = repeatSelectionFrom(initial.repeat);
		this.repeatId = repeat.id;
		this.repeatCustom = repeat.custom;
		this.project = initial.project ?? "";
		this.tagsText = initial.tags !== undefined ? initial.tags.join(", ") : "";
	}

	override onOpen(): void {
		this.setTitle("Create task");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass(cssClass("create-task-modal"));

		this.renderTitleField(contentEl);

		new Setting(contentEl).setName("Folder").addText((text) =>
			text.setValue(this.folder).onChange((value) => {
				this.folder = value;
			}),
		);

		this.renderStatusField(contentEl);
		this.renderPriorityField(contentEl);

		this.renderDateField(contentEl, "Due", this.due, (next) => {
			this.due = next;
		});
		this.renderDateField(contentEl, "Scheduled", this.scheduled, (next) => {
			this.scheduled = next;
		});

		new Setting(contentEl).setName("Duration (minutes)").addText((text) => {
			text.inputEl.type = "number";
			text.setValue(this.durationText).onChange((value) => {
				this.durationText = value;
			});
		});

		this.renderRepeatField(contentEl);

		new Setting(contentEl).setName("Project").addText((text) =>
			text
				.setPlaceholder("Project name or [[link]]")
				.setValue(this.project)
				.onChange((value) => {
					this.project = value;
				}),
		);

		new Setting(contentEl).setName("Tags").addText((text) =>
			text
				.setPlaceholder("Comma-separated tags")
				.setValue(this.tagsText)
				.onChange((value) => {
					this.tagsText = value;
				}),
		);

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("Create")
					.setCta()
					.onClick(() => {
						void this.submit();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			);
	}

	private renderTitleField(container: HTMLElement): void {
		let inputEl: HTMLInputElement | undefined;
		new Setting(container).setName("Title").addText((text) => {
			inputEl = text.inputEl;
			text.setValue(this.title).onChange((value) => {
				this.title = value;
			});
		});
		if (inputEl === undefined) {
			return;
		}
		inputEl.focus();
		inputEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void this.submit();
			}
		});
	}

	private renderStatusField(container: HTMLElement): void {
		const statuses = this.deps.getStatuses();
		const options: Record<string, string> = {};
		for (const status of statuses) {
			options[status.id] = status.label;
		}
		const firstStatusId = statuses[0]?.id;
		new Setting(container).setName("Status").addDropdown((dropdown) =>
			dropdown
				.addOptions(options)
				.setValue(this.statusId ?? firstStatusId ?? "")
				.onChange((value) => {
					this.statusId = value as StatusId;
				}),
		);
	}

	private renderPriorityField(container: HTMLElement): void {
		const options: Record<string, string> = {};
		for (const priority of PRIORITIES) {
			options[priority] = PRIORITY_LABELS[priority];
		}
		new Setting(container).setName("Priority").addDropdown((dropdown) =>
			dropdown
				.addOptions(options)
				.setValue(this.priority)
				.onChange((value) => {
					this.priority = value as Priority;
				}),
		);
	}

	private renderDateField(container: HTMLElement, label: string, field: DateFieldState, onChange: (next: DateFieldState) => void): void {
		new Setting(container).setName(field.hasTime ? `${label} & time` : label).addText((text) => {
			text.inputEl.type = field.hasTime ? "datetime-local" : "date";
			text.setValue(field.value).onChange((value) => {
				onChange({ value, hasTime: field.hasTime });
			});
		});

		new Setting(container).setName(`${label}: include time`).addToggle((toggle) =>
			toggle.setValue(field.hasTime).onChange((checked) => {
				onChange({ value: checked ? field.value : field.value.slice(0, 10), hasTime: checked });
				this.render();
			}),
		);
	}

	private renderRepeatField(container: HTMLElement): void {
		const options: Record<string, string> = { [NO_REPEAT_ID]: "None" };
		for (const preset of RECURRENCE_PRESETS) {
			options[preset.id] = preset.label;
		}
		options[CUSTOM_REPEAT_ID] = "Custom…";

		new Setting(container).setName("Repeat").addDropdown((dropdown) =>
			dropdown
				.addOptions(options)
				.setValue(this.repeatId)
				.onChange((value) => {
					this.repeatId = value;
					this.render();
				}),
		);

		if (this.repeatId === CUSTOM_REPEAT_ID) {
			new Setting(container).setName("RRULE").addText((text) =>
				text
					.setPlaceholder("`FREQ=WEEKLY;BYDAY=MO`")
					.setValue(this.repeatCustom)
					.onChange((value) => {
						this.repeatCustom = value;
					}),
			);
		}

		const rule = this.resolveRepeatRule();
		if (rule !== undefined) {
			const parsed = parseRRule(rule);
			container.createEl("p", {
				text: parsed.ok ? describeRRule(parsed.value) : "Invalid recurrence rule.",
				cls: cssClass("create-task-modal-repeat-description"),
			});
		}
	}

	private resolveRepeatRule(): string | undefined {
		if (this.repeatId === NO_REPEAT_ID) {
			return undefined;
		}
		if (this.repeatId === CUSTOM_REPEAT_ID) {
			return this.repeatCustom.trim().length === 0 ? undefined : this.repeatCustom;
		}
		return RECURRENCE_PRESETS.find((p) => p.id === this.repeatId)?.rule;
	}

	private async submit(): Promise<void> {
		if (this.submitting) {
			return;
		}

		const trimmedTitle = this.title.trim();
		if (trimmedTitle.length === 0) {
			new Notice("Enter a title.");
			return;
		}

		const due = parseDateField(this.due);
		if (due === "invalid") {
			new Notice("Invalid due date.");
			return;
		}
		const scheduled = parseDateField(this.scheduled);
		if (scheduled === "invalid") {
			new Notice("Invalid scheduled date.");
			return;
		}

		let duration: Minutes | undefined;
		const durationTrimmed = this.durationText.trim();
		if (durationTrimmed.length > 0) {
			const parsedDuration = Number(durationTrimmed);
			if (!Number.isFinite(parsedDuration) || parsedDuration < 0) {
				new Notice("Invalid duration.");
				return;
			}
			duration = parsedDuration as Minutes;
		}

		let repeat: RRuleString | undefined;
		const repeatRule = this.resolveRepeatRule();
		if (repeatRule !== undefined) {
			const parsedRule = parseRRule(repeatRule);
			if (!parsedRule.ok) {
				new Notice("Invalid recurrence rule.");
				return;
			}
			repeat = parsedRule.value;
		}

		const trimmedProject = this.project.trim();
		const project = trimmedProject.length === 0 ? undefined : projectFromWikilink(trimmedProject);

		const tags = this.tagsText
			.split(",")
			.map((tag) => tag.trim())
			.filter((tag) => tag.length > 0);

		const trimmedFolder = this.folder.trim();

		const draft: TaskDraft = {
			title: trimmedTitle,
			priority: this.priority,
			...(trimmedFolder.length > 0 ? { folder: trimmedFolder } : {}),
			...(this.statusId !== undefined ? { status: this.statusId } : {}),
			...(due !== undefined ? { due } : {}),
			...(scheduled !== undefined ? { scheduled } : {}),
			...(duration !== undefined ? { duration } : {}),
			...(repeat !== undefined ? { repeat } : {}),
			...(project !== undefined ? { project } : {}),
			...(tags.length > 0 ? { tags } : {}),
		};

		this.submitting = true;
		const result = await this.deps.createTask(draft);
		this.submitting = false;

		if (!result.ok) {
			new Notice(describeAppError(result.error));
			return;
		}

		this.close();
		const file = this.deps.app.vault.getFileByPath(result.value);
		if (file !== null) {
			await this.deps.app.workspace.getLeaf().openFile(file);
		}
	}
}
