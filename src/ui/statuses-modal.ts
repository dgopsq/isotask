import type { App } from "obsidian";
import { Modal, Notice, Setting, setIcon } from "obsidian";

import type { StatusConfig, StatusKind } from "@/domain/status";
import type { StatusId } from "@/domain/task";
import { cssClass } from "@/plugin-id";

export interface StatusesModalDeps {
	readonly getStatuses: () => readonly StatusConfig[];
	readonly setStatuses: (statuses: readonly StatusConfig[]) => void | Promise<void>;
}

const STATUS_KIND_OPTIONS: Record<string, string> = {
	open: "Open",
	active: "Active",
	done: "Done",
	cancelled: "Cancelled",
};

function toStatusId(value: string): StatusId {
	return value as StatusId;
}

function statusWithIcon(status: StatusConfig, icon: string): StatusConfig {
	const trimmed = icon.trim();
	const base: StatusConfig = { id: status.id, label: status.label, kind: status.kind };
	return trimmed.length === 0 ? base : { ...base, icon: trimmed };
}

function validateStatuses(statuses: readonly StatusConfig[]): string | null {
	if (statuses.length === 0) {
		return "Add at least one status.";
	}
	if (statuses.some((status) => status.id.trim().length === 0)) {
		return "Every status needs a non-empty id.";
	}
	if (statuses.some((status) => status.label.trim().length === 0)) {
		return "Every status needs a non-empty label.";
	}
	const ids = statuses.map((status) => status.id.trim());
	if (new Set(ids).size !== ids.length) {
		return "Status ids must be unique.";
	}
	if (!statuses.some((status) => status.kind === "open")) {
		return 'At least one status must have kind "Open".';
	}
	if (!statuses.some((status) => status.kind === "done")) {
		return 'At least one status must have kind "Done".';
	}
	return null;
}

/**
 * Add/edit/reorder/delete the configured statuses. Edits a draft copy and
 * only calls `deps.setStatuses` on "Save", after `validateStatuses` passes.
 */
export class StatusesModal extends Modal {
	private readonly deps: StatusesModalDeps;
	private draft: readonly StatusConfig[];

	constructor(app: App, deps: StatusesModalDeps) {
		super(app);
		this.deps = deps;
		this.draft = deps.getStatuses().map((status) => ({ ...status }));
	}

	override onOpen(): void {
		this.setTitle("Manage statuses");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass(cssClass("statuses-modal"));

		this.draft.forEach((status, index) => {
			this.renderStatusRow(contentEl, status, index);
		});

		new Setting(contentEl).addButton((button) =>
			button.setButtonText("Add status").onClick(() => {
				this.draft = [...this.draft, { id: toStatusId(""), label: "", kind: "open" }];
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
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			);
	}

	private renderStatusRow(container: HTMLElement, status: StatusConfig, index: number): void {
		const setting = new Setting(container).setClass(cssClass("statuses-modal-row"));

		setting.addText((text) =>
			text
				.setPlaceholder("Label")
				.setValue(status.label)
				.onChange((value) => {
					this.updateDraft(index, (s) => ({ ...s, label: value }));
				}),
		);

		setting.addText((text) =>
			text
				.setPlaceholder("ID")
				.setValue(status.id)
				.onChange((value) => {
					this.updateDraft(index, (s) => ({ ...s, id: toStatusId(value) }));
				}),
		);

		setting.addDropdown((dropdown) =>
			dropdown
				.addOptions(STATUS_KIND_OPTIONS)
				.setValue(status.kind)
				.onChange((value) => {
					this.updateDraft(index, (s) => ({ ...s, kind: value as StatusKind }));
				}),
		);

		setting.addText((text) =>
			text
				.setPlaceholder("Icon (optional)")
				.setValue(status.icon ?? "")
				.onChange((value) => {
					this.updateDraft(index, (s) => statusWithIcon(s, value));
				}),
		);

		if (status.icon !== undefined && status.icon.length > 0) {
			const preview = setting.controlEl.createSpan({ cls: cssClass("statuses-modal-icon-preview") });
			setIcon(preview, status.icon);
		}

		setting.addExtraButton((button) =>
			button
				.setIcon("arrow-up")
				.setTooltip("Move up")
				.setDisabled(index === 0)
				.onClick(() => {
					this.moveStatus(index, index - 1);
				}),
		);

		setting.addExtraButton((button) =>
			button
				.setIcon("arrow-down")
				.setTooltip("Move down")
				.setDisabled(index === this.draft.length - 1)
				.onClick(() => {
					this.moveStatus(index, index + 1);
				}),
		);

		setting.addExtraButton((button) =>
			button
				.setIcon("trash")
				.setTooltip("Delete")
				.onClick(() => {
					this.draft = this.draft.filter((_status, i) => i !== index);
					this.render();
				}),
		);
	}

	private updateDraft(index: number, update: (status: StatusConfig) => StatusConfig): void {
		this.draft = this.draft.map((status, i) => (i === index ? update(status) : status));
	}

	private moveStatus(from: number, to: number): void {
		if (to < 0 || to >= this.draft.length) {
			return;
		}
		const next = [...this.draft];
		const moved = next[from];
		if (moved === undefined) {
			return;
		}
		next.splice(from, 1);
		next.splice(to, 0, moved);
		this.draft = next;
		this.render();
	}

	private save(): void {
		const trimmed = this.draft.map((status) => ({
			...status,
			id: toStatusId(status.id.trim()),
			label: status.label.trim(),
		}));
		const validationError = validateStatuses(trimmed);
		if (validationError !== null) {
			new Notice(validationError);
			return;
		}
		void Promise.resolve(this.deps.setStatuses(trimmed)).then(() => {
			this.close();
		});
	}
}
