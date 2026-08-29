import { Plugin } from "obsidian";

import "@/styles/obtask.css";

import type { ObtaskSettings } from "@/adapters/obsidian/settings";
import { parseSettings } from "@/adapters/obsidian/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import { ObtaskSettingTab } from "@/settings/settings-tab";
import { registerViews } from "@/views/bases/register";

/**
 * Composition root (`docs/ARCHITECTURE.md#composition-root`). Loads
 * settings, registers the Bases views and the settings tab. Everything
 * registered through `register*`/`add*` is torn down automatically on
 * unload — there is nothing to clean up manually here.
 */
export default class ObtaskPlugin extends Plugin {
	private pluginSettings: ObtaskSettings = parseSettings(undefined);

	override async onload(): Promise<void> {
		await this.loadSettings();

		registerViews(this, {
			app: this.app,
			getPropertyKeys: () => this.pluginSettings.propertyKeys,
			// The status list is not yet user-configurable (M1) — the feed view reads it
			// through this accessor so wiring that up later doesn't touch the views.
			getStatuses: () => DEFAULT_STATUSES,
			getWeekStart: () => this.pluginSettings.weekStart,
		});

		this.addSettingTab(
			new ObtaskSettingTab(this.app, this, {
				getSettings: () => this.pluginSettings,
				setSettings: (settings) => this.saveSettings(settings),
			}),
		);
	}

	private async loadSettings(): Promise<void> {
		const raw: unknown = await this.loadData();
		this.pluginSettings = parseSettings(raw);
	}

	private async saveSettings(settings: ObtaskSettings): Promise<void> {
		this.pluginSettings = settings;
		await this.saveData(settings);
	}
}
