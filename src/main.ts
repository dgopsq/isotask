import { Plugin } from "obsidian";

import "@/styles/calendar.css";
import "@/styles/isotask.css";

import { EventCalendarRenderer } from "@/adapters/calendar/event-calendar/event-calendar-renderer";
import { makeRescheduleHistory } from "@/adapters/history/reschedule-history";
import { makeNavigationMemory } from "@/adapters/navigation/navigation-memory";
import { createObsidianClock } from "@/adapters/obsidian/clock";
import { createObsidianHaptics } from "@/adapters/obsidian/haptics";
import { registerTaskMenus } from "@/adapters/obsidian/menus";
import { createObsidianNotifier } from "@/adapters/obsidian/notifier";
import { VaultTaskStore } from "@/adapters/obsidian/task-store";
import { registerTaskViewActions } from "@/adapters/obsidian/view-actions";
import { makeConvertNote } from "@/app/convert-note";
import { makeCreateTask } from "@/app/create-task";
import type { AppDeps } from "@/app/deps";
import { makeRescheduleTask } from "@/app/reschedule-task";
import { makeSetDate } from "@/app/set-date";
import { makeSetDuration } from "@/app/set-duration";
import { makeSetPriority } from "@/app/set-priority";
import { makeSetProject } from "@/app/set-project";
import { makeSetRecurrence } from "@/app/set-recurrence";
import { makeSetStatus } from "@/app/set-status";
import { makeSetTags } from "@/app/set-tags";
import { makeToggleDone } from "@/app/toggle-done";
import { makeRedoReschedule, makeUndoReschedule } from "@/app/undo-reschedule";
import { registerCommands } from "@/commands/register-commands";
import { parseSettings } from "@/domain/settings";
import type { IsotaskSettings } from "@/domain/settings";
import { VIEW_TYPE_TASK_PANEL } from "@/plugin-id";
import { IsotaskSettingTab } from "@/settings/settings-tab";
import { registerViews } from "@/views/bases/register";
import { revealTaskPanel } from "@/views/task-panel/reveal-task-panel";
import { TASK_PANEL_ICON, TaskPanelView } from "@/views/task-panel/task-panel-view";

/**
 * Composition root (`docs/ARCHITECTURE.md#composition-root`). Loads
 * settings, builds the adapters and `app` use-cases, registers the Bases
 * views, commands, the "Isotask" file/editor-menu section and the settings
 * tab. Everything registered through `register*`/`add*` is torn down
 * automatically on unload — there is nothing to clean up manually here.
 */
export default class IsotaskPlugin extends Plugin {
	private pluginSettings: IsotaskSettings = parseSettings(undefined);

	override async onload(): Promise<void> {
		await this.loadSettings();

		const store = new VaultTaskStore({
			app: this.app,
			getPropertyKeys: () => this.pluginSettings.propertyKeys,
			getStatuses: () => this.pluginSettings.statuses,
		});
		const clock = createObsidianClock();
		const notifier = createObsidianNotifier();
		const haptics = createObsidianHaptics({ isEnabled: () => this.pluginSettings.hapticsEnabled });
		const calendarRenderer = new EventCalendarRenderer();
		// Session-only: deliberately not persisted across reloads (see
		// `adapters/history/reschedule-history.ts`), so it's built fresh here
		// rather than restored from `loadData`.
		const rescheduleHistory = makeRescheduleHistory();
		// Session-only, same reasoning as `rescheduleHistory` above: a reload
		// should start the calendar fresh rather than resurrect a stale view/date.
		const navigationMemory = makeNavigationMemory();

		const appDeps: AppDeps = {
			store,
			clock,
			notifier,
			history: rescheduleHistory,
			settings: () => this.pluginSettings,
		};

		const createTask = makeCreateTask(appDeps);
		const convertNote = makeConvertNote(appDeps);
		const setStatus = makeSetStatus(appDeps);
		const toggleDone = makeToggleDone(appDeps);
		const rescheduleTask = makeRescheduleTask(appDeps);
		const setDate = makeSetDate(appDeps);
		const setDuration = makeSetDuration(appDeps);
		const setPriority = makeSetPriority(appDeps);
		const setProject = makeSetProject(appDeps);
		const setRecurrence = makeSetRecurrence(appDeps);
		const setTags = makeSetTags(appDeps);
		const undoReschedule = makeUndoReschedule(appDeps);
		const redoReschedule = makeRedoReschedule(appDeps);

		registerViews(this, {
			app: this.app,
			getPropertyKeys: () => this.pluginSettings.propertyKeys,
			getStatuses: () => this.pluginSettings.statuses,
			getWeekStart: () => this.pluginSettings.weekStart,
			getTaskFolder: () => this.pluginSettings.taskFolder,
			createTask,
			rescheduleTask,
			renderer: calendarRenderer,
			history: rescheduleHistory,
			undoReschedule,
			redoReschedule,
			navigationMemory,
			clock,
			setStatus,
			setPriority,
			setDate,
			setDuration,
			setRecurrence,
			setProject,
			setTags,
			notifier,
			haptics,
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
			toggleDone,
			setDate,
			setPriority,
			setDuration,
			setRecurrence,
			setProject,
			setTags,
			undoReschedule,
			redoReschedule,
		});

		const taskMenuDeps = {
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
		};

		registerTaskMenus(this, taskMenuDeps);
		registerTaskViewActions(this, taskMenuDeps);

		this.registerView(VIEW_TYPE_TASK_PANEL, (leaf) => new TaskPanelView(leaf, { ...taskMenuDeps, convertNote }));

		this.addRibbonIcon(TASK_PANEL_ICON, "Open task panel", () => {
			void revealTaskPanel(this.app);
		});

		// One-time auto-open of the sidebar task panel on first enable, gated
		// by the persisted `taskPanelIntroduced` flag (`domain/settings.ts`):
		// persist the flag before revealing anything, so a reload or crash
		// mid-reveal can never cause a second auto-open, and skip revealing
		// if a leaf of that type is already open (e.g. restored from a
		// previous session's layout) — but still mark the flag used.
		this.app.workspace.onLayoutReady(() => {
			void (async () => {
				if (this.pluginSettings.taskPanelIntroduced) {
					return;
				}
				const alreadyOpen = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_PANEL).length > 0;
				await this.saveSettings({ ...this.pluginSettings, taskPanelIntroduced: true });
				if (!alreadyOpen) {
					await revealTaskPanel(this.app);
				}
			})();
		});

		this.addSettingTab(
			new IsotaskSettingTab(this.app, this, {
				getSettings: () => this.pluginSettings,
				setSettings: (settings) => this.saveSettings(settings),
			}),
		);
	}

	private async loadSettings(): Promise<void> {
		const raw: unknown = await this.loadData();
		this.pluginSettings = parseSettings(raw);
	}

	private async saveSettings(settings: IsotaskSettings): Promise<void> {
		this.pluginSettings = settings;
		await this.saveData(settings);
	}
}
