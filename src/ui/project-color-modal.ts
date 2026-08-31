import type { App, TFile } from "obsidian";
import { Modal, Setting, setTooltip } from "obsidian";

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
						if (this.hexError !== null) {
							this.hexError = null;
							this.render();
						}
					}),
			)
			.addButton((button) =>
				button.setButtonText("Use custom").onClick(() => {
					void this.applyCustom();
				}),
			);

		if (this.hexError !== null) {
			contentEl.createDiv({ text: this.hexError, cls: cssClass("project-color-modal-error") });
		}

		new Setting(contentEl).addButton((button) =>
			button.setButtonText("Cancel").onClick(() => {
				this.close();
			}),
		);
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
		await this.app.fileManager.processFrontMatter(this.projectFile, (frontmatter: Record<string, unknown>) => {
			frontmatter["color"] = name;
		});
		this.finish();
	}

	private async applyAutomatic(): Promise<void> {
		await this.app.fileManager.processFrontMatter(this.projectFile, (frontmatter: Record<string, unknown>) => {
			delete frontmatter["color"];
		});
		this.finish();
	}

	private async applyCustom(): Promise<void> {
		const parsed = parseProjectColor(this.hexValue);
		if (parsed?.kind !== "hex") {
			this.hexError = "Enter a valid hex color, e.g. #a1b2c3 or #abc.";
			this.render();
			return;
		}
		const value = serializeProjectColor(parsed);
		await this.app.fileManager.processFrontMatter(this.projectFile, (frontmatter: Record<string, unknown>) => {
			frontmatter["color"] = value;
		});
		this.finish();
	}

	private finish(): void {
		this.onDone?.();
		this.close();
	}
}
