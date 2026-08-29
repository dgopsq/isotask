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
import { FolderSuggest } from "@/ui/suggest/folder-suggest";
import { NoteSuggest } from "@/ui/suggest/note-suggest";
import { TagSuggest } from "@/ui/suggest/tag-suggest";

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

/**
 * "More options" open/closed is remembered for the session (not persisted to
 * disk) so re-opening the modal keeps the user's last choice, per a
 * module-level `let` rather than an instance field.
 */
let sessionMoreOptionsOpen = false;

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

/** Toggles a date field between `date` and `datetime-local`, preserving the date part across the switch. */
function toggleDateFieldTime(field: DateFieldState): DateFieldState {
	const datePart = field.value.slice(0, 10);
	if (field.hasTime) {
		return { value: datePart, hasTime: false };
	}
	return { value: datePart.length === 0 ? "" : `${datePart}T00:00`, hasTime: true };
}

/** Whether `initial` prefills any field that lives under "More options", so the modal should open it automatically. */
function hasMoreOptionsPrefill(initial: Partial<TaskDraft>): boolean {
	return (
		initial.folder !== undefined ||
		initial.status !== undefined ||
		initial.scheduled !== undefined ||
		initial.duration !== undefined ||
		initial.project !== undefined ||
		initial.tags !== undefined
	);
}

/**
 * Create-task modal. State lives on instance fields; the modal only does a
 * full re-render on a structural change (a dropdown that reveals/hides a
 * field, the "More options" toggle, or a date/time toggle) — plain text
 * fields update state in `onChange` without re-rendering, so typing never
 * loses focus.
 *
 * Kept short (default: Title, Due, Priority, Repeat, More options toggle,
 * buttons) so Obsidian doesn't render its full-height scrollbar on a `Modal`
 * taller than the viewport; the rarer fields (Folder, Status, Scheduled,
 * Duration, Project, Tags) live behind "More options".
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
	private moreOptionsOpen: boolean;
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
		this.moreOptionsOpen = sessionMoreOptionsOpen || hasMoreOptionsPrefill(initial);
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

		this.renderDateField(contentEl, "Due", "Deadline. Clock adds a time.", this.due, (next) => {
			this.due = next;
		});

		this.renderPriorityField(contentEl);
		this.renderRepeatField(contentEl);

		new Setting(contentEl)
			.setName("More options")
			.setDesc("Folder, status, schedule, project, tags.")
			.addToggle((toggle) =>
				toggle.setValue(this.moreOptionsOpen).onChange((checked) => {
					this.moreOptionsOpen = checked;
					sessionMoreOptionsOpen = checked;
					this.render();
				}),
			);

		if (this.moreOptionsOpen) {
			this.renderMoreOptions(contentEl);
		}

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

	private renderMoreOptions(container: HTMLElement): void {
		new Setting(container)
			.setName("Folder")
			.setDesc("Where the note is created.")
			.addText((text) => {
				text.setValue(this.folder).onChange((value) => {
					this.folder = value;
				});
				new FolderSuggest(this.deps.app, text.inputEl);
			});

		this.renderStatusField(container);

		this.renderDateField(container, "Scheduled", "When you plan to do it.", this.scheduled, (next) => {
			this.scheduled = next;
		});

		new Setting(container)
			.setName("Duration (minutes)")
			.setDesc("Length of the scheduled block.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.setValue(this.durationText).onChange((value) => {
					this.durationText = value;
				});
			});

		new Setting(container)
			.setName("Project")
			.setDesc("Project note, e.g. `[[Launch]]`.")
			.addText((text) => {
				text
					.setPlaceholder("Project name or [[link]]")
					.setValue(this.project)
					.onChange((value) => {
						this.project = value;
					});
				new NoteSuggest(this.deps.app, text.inputEl);
			});

		new Setting(container)
			.setName("Tags")
			.setDesc("Comma-separated, without #.")
			.addText((text) => {
				text
					.setPlaceholder("Comma-separated tags")
					.setValue(this.tagsText)
					.onChange((value) => {
						this.tagsText = value;
					});
				new TagSuggest(this.deps.app, text.inputEl);
			});
	}

	private renderTitleField(container: HTMLElement): void {
		let inputEl: HTMLInputElement | undefined;
		new Setting(container)
			.setName("Title")
			.setDesc("Used as the note name.")
			.addText((text) => {
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
		new Setting(container)
			.setName("Status")
			.setDesc("Initial status of the task.")
			.addDropdown((dropdown) =>
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
		new Setting(container)
			.setName("Priority")
			.setDesc("Sorts tasks within a feed bucket.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(options)
					.setValue(this.priority)
					.onChange((value) => {
						this.priority = value as Priority;
					}),
			);
	}

	/**
	 * Renders a date row with its "include time" toggle folded into an
	 * extra (icon) button on the row itself, rather than a separate
	 * `Setting`: clicking it switches the text input between `date` and
	 * `datetime-local` (preserving the date part) and re-renders so the
	 * input's `type` picks up the change.
	 */
	private renderDateField(
		container: HTMLElement,
		label: string,
		desc: string,
		field: DateFieldState,
		onChange: (next: DateFieldState) => void,
	): void {
		new Setting(container)
			.setName(label)
			.setDesc(desc)
			.addText((text) => {
				text.inputEl.type = field.hasTime ? "datetime-local" : "date";
				text.setValue(field.value).onChange((value) => {
					onChange({ value, hasTime: field.hasTime });
				});
			})
			.addExtraButton((button) => {
				button
					.setIcon("clock")
					.setTooltip("Include time")
					.onClick(() => {
						onChange(toggleDateFieldTime(field));
						this.render();
					});
				button.extraSettingsEl.toggleClass("is-active", field.hasTime);
			});
	}

	private renderRepeatField(container: HTMLElement): void {
		const options: Record<string, string> = { [NO_REPEAT_ID]: "None" };
		for (const preset of RECURRENCE_PRESETS) {
			options[preset.id] = preset.label;
		}
		options[CUSTOM_REPEAT_ID] = "Custom…";

		new Setting(container)
			.setName("Repeat")
			.setDesc("Next occurrence is created on completion.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(options)
					.setValue(this.repeatId)
					.onChange((value) => {
						this.repeatId = value;
						this.render();
					}),
			);

		if (this.repeatId === CUSTOM_REPEAT_ID) {
			new Setting(container)
				.setName("RRULE")
				.setDesc("RFC 5545 rule body, e.g. `FREQ=WEEKLY;BYDAY=MO`.")
				.addText((text) =>
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
