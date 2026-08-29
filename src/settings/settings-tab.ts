import type { App, Plugin } from "obsidian";
import { PluginSettingTab, Setting } from "obsidian";

import type { Weekday } from "@/domain/dates";
import type { ObtaskSettings } from "@/adapters/obsidian/settings";

const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
	0: "Monday",
	1: "Tuesday",
	2: "Wednesday",
	3: "Thursday",
	4: "Friday",
	5: "Saturday",
	6: "Sunday",
};

export interface SettingsTabDeps {
	readonly getSettings: () => ObtaskSettings;
	readonly setSettings: (settings: ObtaskSettings) => Promise<void>;
}

/**
 * Minimal M0 settings tab: task folder, marker key/value, week start.
 * Everything else (status list editing, other property-key mappings) is
 * TBD (M1) — see `docs/ROADMAP.md`.
 */
export class ObtaskSettingTab extends PluginSettingTab {
	private readonly deps: SettingsTabDeps;

	constructor(app: App, plugin: Plugin, deps: SettingsTabDeps) {
		super(app, plugin);
		this.deps = deps;
	}

	// The declarative `getSettingDefinitions()` API needs Obsidian 1.13.0; manifest.json's
	// `minAppVersion` is 1.10.0 (set by the Bases API), so the imperative `display()` override
	// — deprecated on newer Obsidian but still functional — is the correct choice here. (The
	// repo's lint config forbids disabling this rule, so the resulting warning is expected.)
	override display(): void {
		this.containerEl.empty();
		const settings = this.deps.getSettings();

		new Setting(this.containerEl)
			.setName("Task folder")
			.setDesc("Where new task notes are created.")
			.addText((text) =>
				text.setValue(settings.taskFolder).onChange((value) => {
					void this.deps.setSettings({ ...settings, taskFolder: value });
				}),
			);

		new Setting(this.containerEl)
			.setName("Marker property key")
			.setDesc('The frontmatter key that identifies a task note, e.g. "type".')
			.addText((text) =>
				text.setValue(settings.propertyKeys.markerKey).onChange((value) => {
					void this.deps.setSettings({
						...settings,
						propertyKeys: { ...settings.propertyKeys, markerKey: value },
					});
				}),
			);

		new Setting(this.containerEl)
			.setName("Marker property value")
			.setDesc('The value that key must have, e.g. "task".')
			.addText((text) =>
				text.setValue(settings.propertyKeys.markerValue).onChange((value) => {
					void this.deps.setSettings({
						...settings,
						propertyKeys: { ...settings.propertyKeys, markerValue: value },
					});
				}),
			);

		new Setting(this.containerEl)
			.setName("Week starts on")
			.setDesc("Used by the feed view's this week / next week buckets.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(WEEKDAY_LABELS)) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(String(settings.weekStart)).onChange((value) => {
					void this.deps.setSettings({ ...settings, weekStart: Number(value) as Weekday });
				});
			});
	}
}
