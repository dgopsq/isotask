import type { App, Plugin, SettingDefinitionItem } from "obsidian";
import { Platform, PluginSettingTab } from "obsidian";

import type { IsotaskSettings } from "@/adapters/obsidian/settings";
import type { Weekday } from "@/domain/dates";
import type { PropertyKeys } from "@/domain/property-keys";
import { AGENT_GUIDE_URL, PLUGIN_ID } from "@/plugin-id";

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

interface PropertyKeyControlDef {
	readonly key: keyof PropertyKeys;
	readonly name: string;
	readonly desc: string;
}

const PROPERTY_KEY_CONTROLS: readonly PropertyKeyControlDef[] = [
	{ key: "markerKey", name: "Marker property key", desc: 'The frontmatter key that identifies a task note, e.g. "type".' },
	{ key: "markerValue", name: "Marker property value", desc: 'The value that key must have, e.g. "task".' },
	{ key: "status", name: "Status property key", desc: "The frontmatter key holding the task's status." },
	{ key: "priority", name: "Priority property key", desc: "The frontmatter key holding the task's priority." },
	{ key: "due", name: "Due property key", desc: "The frontmatter key holding the task's due date." },
	{ key: "scheduled", name: "Scheduled property key", desc: "The frontmatter key holding the task's scheduled date." },
	{ key: "duration", name: "Duration property key", desc: "The frontmatter key holding the task's duration, in minutes." },
	{ key: "repeat", name: "Repeat property key", desc: "The frontmatter key holding the task's recurrence rule." },
	{ key: "project", name: "Project property key", desc: "The frontmatter key holding the task's project." },
	{ key: "tags", name: "Tags property key", desc: "The frontmatter key holding the task's tags." },
	{ key: "created", name: "Created property key", desc: "The frontmatter key holding the date the task was created." },
	{ key: "completed", name: "Completed property key", desc: "The frontmatter key holding the date the task was completed." },
];

type ScalarSettingKey = "taskFolder" | "tasksBasePath" | "newTaskFilenameTemplate" | "spawnFilenameTemplate" | "weekStart" | "hapticsEnabled";
type SettingKey = keyof PropertyKeys | ScalarSettingKey;

function isPropertyKeySetting(key: string): key is keyof PropertyKeys {
	return PROPERTY_KEY_CONTROLS.some((control) => control.key === key);
}

/**
 * One entry per `ScalarSettingKey`, enforced by the `Record` type itself
 * (a missing key is a compile error) rather than a `switch` — `key` arrives
 * from Obsidian as a plain `string`, so a `switch` on it can't be narrowed
 * enough for `@typescript-eslint/switch-exhaustiveness-check` to verify.
 */
const SCALAR_SETTINGS: Readonly<
	Record<
		ScalarSettingKey,
		{
			readonly get: (settings: IsotaskSettings) => unknown;
			readonly set: (settings: IsotaskSettings, value: unknown) => IsotaskSettings;
		}
	>
> = {
	taskFolder: {
		get: (settings) => settings.taskFolder,
		set: (settings, value) => ({ ...settings, taskFolder: String(value) }),
	},
	tasksBasePath: {
		get: (settings) => settings.tasksBasePath,
		set: (settings, value) => ({ ...settings, tasksBasePath: String(value) }),
	},
	newTaskFilenameTemplate: {
		get: (settings) => settings.newTaskFilenameTemplate,
		set: (settings, value) => ({ ...settings, newTaskFilenameTemplate: String(value) }),
	},
	spawnFilenameTemplate: {
		get: (settings) => settings.spawnFilenameTemplate,
		set: (settings, value) => ({ ...settings, spawnFilenameTemplate: String(value) }),
	},
	weekStart: {
		get: (settings) => String(settings.weekStart),
		set: (settings, value) => ({ ...settings, weekStart: Number(value) as Weekday }),
	},
	hapticsEnabled: {
		get: (settings) => settings.hapticsEnabled,
		set: (settings, value) => ({ ...settings, hapticsEnabled: Boolean(value) }),
	},
};

function isScalarSetting(key: string): key is ScalarSettingKey {
	return Object.prototype.hasOwnProperty.call(SCALAR_SETTINGS, key);
}

export interface SettingsTabDeps {
	readonly getSettings: () => IsotaskSettings;
	readonly setSettings: (settings: IsotaskSettings) => Promise<void>;
	readonly copyAgentInstructions: () => Promise<void>;
}

/**
 * Settings tab, built with the declarative `getSettingDefinitions()` API
 * (Obsidian 1.13+): each control's `key` is resolved through
 * `getControlValue`/`setControlValue`, which read and write through `deps`
 * rather than `this.plugin.settings` (the `PluginSettingTab` default) since
 * settings live behind the `getSettings`/`setSettings` deps instead.
 *
 * The status list itself has no UI here: task status is a two-way toggle
 * (open/done, see ADR 0017) with no user-facing way to pick or configure a
 * status. Only the `status` property key remains editable, below.
 */
export class IsotaskSettingTab extends PluginSettingTab {
	private readonly deps: SettingsTabDeps;

	constructor(app: App, plugin: Plugin, deps: SettingsTabDeps) {
		super(app, plugin);
		this.deps = deps;
	}

	override getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				type: "group",
				heading: "General",
				items: [
					{
						name: "Task folder",
						desc: "Where new task notes are created.",
						control: { type: "text", key: "taskFolder" },
					},
					{
						name: "Tasks base path",
						desc: 'Vault path of the .base file used by the plugin\'s "Open tasks" command, e.g. "Tasks.base".',
						control: { type: "text", key: "tasksBasePath" },
					},
					{
						name: "New task filename template",
						desc: 'Filename (without extension) for a newly created task note. Supports "{{title}}".',
						control: { type: "text", key: "newTaskFilenameTemplate" },
					},
					{
						name: "Spawn filename template",
						desc: 'Filename (without extension) for a note spawned from a completed recurring task. Supports "{{title}}" and "{{due}}".',
						control: { type: "text", key: "spawnFilenameTemplate" },
					},
					{
						name: "Week starts on",
						desc: "Used by the feed view's this week / next week buckets.",
						control: { type: "dropdown", key: "weekStart", options: WEEKDAY_OPTIONS },
					},
					{
						name: "Haptic feedback",
						desc: "Vibrate on drag, drop and task completion.",
						control: { type: "toggle", key: "hapticsEnabled" },
						visible: () => Platform.isIosApp,
					},
				],
			},
			{
				type: "group",
				heading: "Property keys",
				items: PROPERTY_KEY_CONTROLS.map((control) => ({
					name: control.name,
					desc: control.desc,
					control: { type: "text" as const, key: control.key },
				})),
			},
			{
				type: "group",
				heading: "AI agents",
				items: [
					{
						name: "Copy agent instructions",
						desc: `Text an AI agent needs to create and manage task notes in this vault. From the Obsidian CLI: obsidian eval code="app.plugins.plugins.${PLUGIN_ID}.api.agentInstructions()". Guide: ${AGENT_GUIDE_URL}`,
						// SettingControl has no "button" variant; "render" drops to imperative
						// Setting/addButton for just this row, rest of the tab stays declarative.
						render: (setting) => {
							setting.addButton((button) =>
								button.setButtonText("Copy").onClick(() => {
									void this.deps.copyAgentInstructions();
								}),
							);
						},
					},
				],
			},
		];
	}

	override getControlValue(key: string): unknown {
		const settings = this.deps.getSettings();

		if (isPropertyKeySetting(key)) {
			return settings.propertyKeys[key];
		}
		if (isScalarSetting(key)) {
			return SCALAR_SETTINGS[key].get(settings);
		}
		return undefined;
	}

	override setControlValue(key: string, value: unknown): void | Promise<void> {
		const settings = this.deps.getSettings();

		if (isPropertyKeySetting(key)) {
			return this.deps.setSettings({
				...settings,
				propertyKeys: { ...settings.propertyKeys, [key]: String(value) },
			});
		}
		if (isScalarSetting(key)) {
			return this.deps.setSettings(SCALAR_SETTINGS[key].set(settings, value));
		}
		return undefined;
	}
}
