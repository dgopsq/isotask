import { Plugin } from "obsidian";

import "@/styles/calendar.css";
import "@/styles/obtask.css";

import { EventCalendarRenderer } from "@/adapters/calendar/event-calendar/event-calendar-renderer";
import { createObsidianClock } from "@/adapters/obsidian/clock";
import { registerTaskMenus } from "@/adapters/obsidian/menus";
import { createObsidianNotifier } from "@/adapters/obsidian/notifier";
import { VaultTaskStore } from "@/adapters/obsidian/task-store";
import { makeConvertNote } from "@/app/convert-note";
import { makeCreateTask } from "@/app/create-task";
import { makeCycleStatus } from "@/app/cycle-status";
import type { AppDeps } from "@/app/deps";
import { makeRescheduleTask } from "@/app/reschedule-task";
import { makeSetDate } from "@/app/set-date";
import { makeSetDuration } from "@/app/set-duration";
import { makeSetPriority } from "@/app/set-priority";
import { makeSetProject } from "@/app/set-project";
import { makeSetRecurrence } from "@/app/set-recurrence";
import { makeSetStatus } from "@/app/set-status";
import { makeSetTags } from "@/app/set-tags";
import { registerCommands } from "@/commands/register-commands";
import { parseSettings } from "@/domain/settings";
import type { ObtaskSettings } from "@/domain/settings";
import { ObtaskSettingTab } from "@/settings/settings-tab";
import { registerViews } from "@/views/bases/register";

/**
 * Composition root (`docs/ARCHITECTURE.md#composition-root`). Loads
 * settings, builds the adapters and `app` use-cases, registers the Bases
 * views, commands, the "Obtask" file/editor-menu section and the settings
 * tab. Everything registered through `register*`/`add*` is torn down
 * automatically on unload — there is nothing to clean up manually here.
 */
export default class ObtaskPlugin extends Plugin {
	private pluginSettings: ObtaskSettings = parseSettings(undefined);

	override async onload(): Promise<void> {
		await this.loadSettings();

		const store = new VaultTaskStore({
			app: this.app,
			getPropertyKeys: () => this.pluginSettings.propertyKeys,
			getStatuses: () => this.pluginSettings.statuses,
		});
		const clock = createObsidianClock();
		const notifier = createObsidianNotifier();
		const calendarRenderer = new EventCalendarRenderer();

		const appDeps: AppDeps = {
			store,
			clock,
			notifier,
			settings: () => this.pluginSettings,
		};

		const createTask = makeCreateTask(appDeps);
		const convertNote = makeConvertNote(appDeps);
		const setStatus = makeSetStatus(appDeps);
		const cycleStatus = makeCycleStatus(appDeps);
		const rescheduleTask = makeRescheduleTask(appDeps);
		const setDate = makeSetDate(appDeps);
		const setDuration = makeSetDuration(appDeps);
		const setPriority = makeSetPriority(appDeps);
		const setProject = makeSetProject(appDeps);
		const setRecurrence = makeSetRecurrence(appDeps);
		const setTags = makeSetTags(appDeps);

		registerViews(this, {
			app: this.app,
			getPropertyKeys: () => this.pluginSettings.propertyKeys,
			getStatuses: () => this.pluginSettings.statuses,
			getWeekStart: () => this.pluginSettings.weekStart,
			getTaskFolder: () => this.pluginSettings.taskFolder,
			createTask,
			rescheduleTask,
			renderer: calendarRenderer,
			setStatus,
			setPriority,
			setDate,
			setDuration,
			setRecurrence,
			setProject,
			setTags,
			notifier,
		});

		registerCommands(this, {
			app: this.app,
			store,
			notifier,
			getPropertyKeys: () => this.pluginSettings.propertyKeys,
			getStatuses: () => this.pluginSettings.statuses,
			getTaskFolder: () => this.pluginSettings.taskFolder,
			getTasksBasePath: () => this.pluginSettings.tasksBasePath,
			createTask,
			convertNote,
			setStatus,
			cycleStatus,
			setDate,
			setRecurrence,
		});

		registerTaskMenus(this, {
			app: this.app,
			getPropertyKeys: () => this.pluginSettings.propertyKeys,
			getStatuses: () => this.pluginSettings.statuses,
			setStatus,
			setPriority,
			setDate,
			setDuration,
			setRecurrence,
			setProject,
			setTags,
			notifier,
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
