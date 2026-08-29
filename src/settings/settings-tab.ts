import type { App, Plugin, SettingDefinitionItem } from "obsidian";
import { PluginSettingTab } from "obsidian";

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

const WEEKDAY_OPTIONS: Record<string, string> = Object.fromEntries(
	Object.entries(WEEKDAY_LABELS),
);

export interface SettingsTabDeps {
	readonly getSettings: () => ObtaskSettings;
	readonly setSettings: (settings: ObtaskSettings) => Promise<void>;
}

type SettingKey = "taskFolder" | "markerKey" | "markerValue" | "weekStart";

/**
 * Minimal M0 settings tab: task folder, marker key/value, week start.
 * Everything else (status list editing, other property-key mappings) is
 * TBD (M1) — see `docs/ROADMAP.md`.
 *
 * Uses the declarative `getSettingDefinitions()` API (Obsidian 1.13+):
 * each control's `key` is resolved through `getControlValue`/
 * `setControlValue`, which read and write through `deps` rather than
 * `this.plugin.settings` (the `PluginSettingTab` default) since settings
 * live behind the `getSettings`/`setSettings` deps instead.
 */
export class ObtaskSettingTab extends PluginSettingTab {
	private readonly deps: SettingsTabDeps;

	constructor(app: App, plugin: Plugin, deps: SettingsTabDeps) {
		super(app, plugin);
		this.deps = deps;
	}

	override getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				name: "Task folder",
				desc: "Where new task notes are created.",
				control: { type: "text", key: "taskFolder" },
			},
			{
				name: "Marker property key",
				desc: 'The frontmatter key that identifies a task note, e.g. "type".',
				control: { type: "text", key: "markerKey" },
			},
			{
				name: "Marker property value",
				desc: 'The value that key must have, e.g. "task".',
				control: { type: "text", key: "markerValue" },
			},
			{
				name: "Week starts on",
				desc: "Used by the feed view's this week / next week buckets.",
				control: { type: "dropdown", key: "weekStart", options: WEEKDAY_OPTIONS },
			},
		];
	}

	override getControlValue(key: string): unknown {
		const settings = this.deps.getSettings();

		if (key === "taskFolder") {
			return settings.taskFolder;
		}
		if (key === "markerKey") {
			return settings.propertyKeys.markerKey;
		}
		if (key === "markerValue") {
			return settings.propertyKeys.markerValue;
		}
		if (key === "weekStart") {
			return String(settings.weekStart);
		}
		return undefined;
	}

	override setControlValue(key: string, value: unknown): void | Promise<void> {
		const settings = this.deps.getSettings();

		if (key === "taskFolder") {
			return this.deps.setSettings({ ...settings, taskFolder: String(value) });
		}
		if (key === "markerKey") {
			return this.deps.setSettings({
				...settings,
				propertyKeys: { ...settings.propertyKeys, markerKey: String(value) },
			});
		}
		if (key === "markerValue") {
			return this.deps.setSettings({
				...settings,
				propertyKeys: { ...settings.propertyKeys, markerValue: String(value) },
			});
		}
		if (key === "weekStart") {
			return this.deps.setSettings({
				...settings,
				weekStart: Number(value) as Weekday,
			});
		}
		return undefined;
	}
}
