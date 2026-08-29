import type { Menu, TAbstractFile } from "obsidian";
import { Plugin, TFile } from "obsidian";

import "@/styles/obtask.css";

import { createObsidianClock } from "@/adapters/obsidian/clock";
import { createObsidianNotifier } from "@/adapters/obsidian/notifier";
import { VaultTaskStore } from "@/adapters/obsidian/task-store";
import { makeConvertNote } from "@/app/convert-note";
import { makeCreateTask } from "@/app/create-task";
import { makeCycleStatus } from "@/app/cycle-status";
import type { AppDeps } from "@/app/deps";
import { describeAppError } from "@/app/errors";
import { makeSetDate } from "@/app/set-date";
import { makeSetRecurrence } from "@/app/set-recurrence";
import { makeSetStatus } from "@/app/set-status";
import { registerCommands } from "@/commands/register-commands";
import { isTaskNote } from "@/domain/frontmatter";
import { parseSettings } from "@/domain/settings";
import type { ObtaskSettings } from "@/domain/settings";
import type { StatusId, TaskPath } from "@/domain/task";
import { ObtaskSettingTab } from "@/settings/settings-tab";
import { statusIcon } from "@/ui/status-menu";
import { registerViews } from "@/views/bases/register";

/**
 * Composition root (`docs/ARCHITECTURE.md#composition-root`). Loads
 * settings, builds the adapters and `app` use-cases, registers the Bases
 * views, commands, the file-menu "Set status" entries and the settings tab.
 * Everything registered through `register*`/`add*` is torn down
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
		const setDate = makeSetDate(appDeps);
		const setRecurrence = makeSetRecurrence(appDeps);

		registerViews(this, {
			app: this.app,
			getPropertyKeys: () => this.pluginSettings.propertyKeys,
			getStatuses: () => this.pluginSettings.statuses,
			getWeekStart: () => this.pluginSettings.weekStart,
			setStatus,
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

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				this.addStatusMenuItems(menu, file, setStatus, notifier);
			}),
		);

		this.addSettingTab(
			new ObtaskSettingTab(this.app, this, {
				getSettings: () => this.pluginSettings,
				setSettings: (settings) => this.saveSettings(settings),
			}),
		);
	}

	/**
	 * "Set status" entries on a task note's file-menu. Obsidian 1.13's
	 * `MenuItem` has no `setSubmenu` (verified against the bundled
	 * `obsidian.d.ts` — there is no submenu API at all in this version, not
	 * just on mobile), so this adds one flat, prefixed item per status
	 * instead of a nested submenu.
	 */
	private addStatusMenuItems(
		menu: Menu,
		file: TAbstractFile,
		setStatus: ReturnType<typeof makeSetStatus>,
		notifier: ReturnType<typeof createObsidianNotifier>,
	): void {
		if (!(file instanceof TFile)) {
			return;
		}
		const keys = this.pluginSettings.propertyKeys;
		const raw = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (raw === undefined || !isTaskNote(raw, keys)) {
			return;
		}

		const rawStatus: unknown = raw[keys.status];
		const currentStatus = (typeof rawStatus === "string" ? rawStatus : "") as StatusId;
		const path = file.path as TaskPath;

		menu.addSeparator();
		for (const status of this.pluginSettings.statuses) {
			menu.addItem((item) => {
				item
					.setTitle(`Set status: ${status.label}`)
					.setIcon(statusIcon(status))
					.setChecked(status.id === currentStatus)
					.onClick(() => {
						void setStatus(path, status.id).then((result) => {
							if (!result.ok) {
								notifier.error(describeAppError(result.error));
							}
						});
					});
			});
		}
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
