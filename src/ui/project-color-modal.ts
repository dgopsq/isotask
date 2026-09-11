import type { App, TFile } from "obsidian";
import { Modal, Notice, Setting, setTooltip } from "obsidian";

import type { PaletteName, ProjectColor } from "@/domain/project-color";
import { PALETTE, parseProjectColor, paletteColorClass, serializeProjectColor } from "@/domain/project-color";
import { cssClass } from "@/plugin-id";

/** `"red"` -> `"Red"` — the swatch tooltip/aria-label text, sentence case per `AGENTS.md`. */
function sentenceCase(name: string): string {
	return name.length === 0 ? name : `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Sets or clears a project note's own `color` frontmatter — the value
 * `domain/project-color.ts#resolveDotColor` reads for every task naming
 * this project (falling back to the hashed palette color when it's absent
 * or invalid). A palette swatch grid, an "Automatic" clear (deletes the
 * key), and a custom-hex field, each writing directly through
 * `app.fileManager.processFrontMatter` — `color` is a project-note
 * property, not one of the task `PropertyKeys` (`domain/property-keys.ts`
 * never lists it), so there's no `app`-layer use-case to go through; this
 * modal is the entire imperative shell for the write.
 *
 * Three entry points open this: the feed's project-link context menu
 * (`views/bases/feed/feed-view.ts`), the task panel's project field
 * (`views/task-panel/task-panel-view.ts`), and the "Set project color"
 * command (`commands/register-commands.ts`). All three already resolve
 * the project note to a `TFile` before opening it.
 */
export class ProjectColorModal extends Modal {
	private readonly projectFile: TFile;
	private readonly onDone: (() => void) | undefined;
	private readonly current: ProjectColor | undefined;
	private hexValue: string;
	private hexError: string | null = null;
	// Created once per `render()` pass and updated in place for every error
	// transition afterwards (`setHexError`) — a `processFrontMatter` failure
	// or a validation error must never trigger a second `render()`, which
	// would drop focus out of the hex field mid-edit (`AGENTS.md`/finding on
	// this modal). `undefined` only ever between constructions of `render()`.
	private errorEl: HTMLElement | undefined;

	constructor(app: App, projectFile: TFile, onDone?: () => void) {
		super(app);
		this.projectFile = projectFile;
		this.onDone = onDone;
		this.current = this.readCurrent();
		this.hexValue = this.current?.kind === "hex" ? this.current.value : "";
	}

	override onOpen(): void {
		this.setTitle("Set project color");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private readCurrent(): ProjectColor | undefined {
		const raw: unknown = this.app.metadataCache.getFileCache(this.projectFile)?.frontmatter?.["color"];
		return parseProjectColor(raw);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass(cssClass("project-color-modal"));

		new Setting(contentEl).setName("Palette").setHeading();

		const row = contentEl.createDiv({ cls: cssClass("swatch-row") });
		for (const name of PALETTE) {
			this.renderSwatch(row, name);
		}

		new Setting(contentEl)
			.setName("Automatic")
			.setDesc("Removes the color property; a consistent color is derived from the project name instead.")
			.addButton((button) =>
				button.setButtonText("Use automatic").onClick(() => {
					void this.applyAutomatic();
				}),
			);

		new Setting(contentEl)
			.setName("Custom")
			.setDesc("Hex color, for example #a1b2c3")
			.addText((text) =>
				text
					.setPlaceholder("Hex color")
					.setValue(this.hexValue)
					.onChange((value) => {
						this.hexValue = value;
						this.setHexError(null);
					}),
			)
			.addButton((button) =>
				button.setButtonText("Use custom").onClick(() => {
					void this.applyCustom();
				}),
			);

		// Persistent and always mounted (even with nothing to show) so a later
		// error transition can update it in place via `setHexError` instead of
		// calling `render()` again — see `errorEl`'s doc comment.
		this.errorEl = contentEl.createDiv({ cls: cssClass("project-color-modal-error") });
		this.syncErrorEl();

		new Setting(contentEl).addButton((button) =>
			button.setButtonText("Cancel").onClick(() => {
				this.close();
			}),
		);
	}

	/** Reflects `this.hexError` onto the persistent `errorEl` — text plus a `--hidden` modifier class (`calendar.css`-style theme-only CSS, `isotask.css`) rather than an inline style. */
	private syncErrorEl(): void {
		if (this.errorEl === undefined) {
			return;
		}
		this.errorEl.setText(this.hexError ?? "");
		this.errorEl.toggleClass(cssClass("project-color-modal-error--hidden"), this.hexError === null);
	}

	/** Sets or clears the hex-field validation error without a full `render()` — see `errorEl`'s doc comment for why. */
	private setHexError(message: string | null): void {
		if (this.hexError === message) {
			return;
		}
		this.hexError = message;
		this.syncErrorEl();
	}

	private renderSwatch(row: HTMLElement, name: PaletteName): void {
		const label = sentenceCase(name);
		const swatch = row.createEl("button", {
			cls: [cssClass("swatch"), cssClass(paletteColorClass(name))],
			attr: { type: "button", "aria-label": label },
		});
		setTooltip(swatch, label);
		if (this.current?.kind === "palette" && this.current.name === name) {
			swatch.addClass(cssClass("swatch--selected"));
		}
		swatch.addEventListener("click", () => {
			void this.applyPalette(name);
		});
	}

	private async applyPalette(name: PaletteName): Promise<void> {
		if (
			await this.writeColor((frontmatter) => {
				frontmatter["color"] = name;
			})
		) {
			this.finish();
		}
	}

	private async applyAutomatic(): Promise<void> {
		if (
			await this.writeColor((frontmatter) => {
				delete frontmatter["color"];
			})
		) {
			this.finish();
		}
	}

	private async applyCustom(): Promise<void> {
		const parsed = parseProjectColor(this.hexValue);
		if (parsed?.kind !== "hex") {
			this.setHexError("Enter a valid hex color, e.g. #a1b2c3 or #abc.");
			return;
		}
		const value = serializeProjectColor(parsed);
		if (
			await this.writeColor((frontmatter) => {
				frontmatter["color"] = value;
			})
		) {
			this.finish();
		}
	}

	/**
	 * Runs `processFrontMatter` on the project note, returning whether it
	 * succeeded. A deleted or otherwise unprocessable project note (the
	 * user removed/moved it while this modal was open) would otherwise
	 * reject unhandled and leave the modal stuck with no feedback — caught
	 * here, surfaced as a `Notice` (mirrors `adapters/obsidian/task-store.ts`'s
	 * `updateProperties`, which reports the same failure through the
	 * `TaskStore` port instead, since this write has no use-case of its own
	 * to go through), and the modal stays open so the user can retry or
	 * cancel rather than the write silently vanishing.
	 */
	private async writeColor(mutate: (frontmatter: Record<string, unknown>) => void): Promise<boolean> {
		try {
			await this.app.fileManager.processFrontMatter(this.projectFile, mutate);
			return true;
		} catch {
			new Notice("Could not update the project color.");
			return false;
		}
	}

	private finish(): void {
		this.onDone?.();
		this.close();
	}
}
