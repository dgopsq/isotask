import { Plugin } from "obsidian";

import "@/styles/calendar.css";
import "@/styles/isotask.css";

import { EventCalendarRenderer } from "@/adapters/calendar/event-calendar/event-calendar-renderer";
import { makeRescheduleHistory } from "@/adapters/history/reschedule-history";
import { makeNavigationMemory } from "@/adapters/navigation/navigation-memory";
import { copyToClipboard } from "@/adapters/obsidian/clipboard";
import { createObsidianClock } from "@/adapters/obsidian/clock";
import { registerCompletionWatcher } from "@/adapters/obsidian/completion-watcher";
import { createObsidianHaptics } from "@/adapters/obsidian/haptics";
import { registerTaskMenus } from "@/adapters/obsidian/menus";
import { createNtfyChannel, describePushError } from "@/adapters/obsidian/ntfy-channel";
import { createObsidianNotifier } from "@/adapters/obsidian/notifier";
import { registerProtocolHandlers } from "@/adapters/obsidian/protocol-handler";
import { registerReminderReconciler } from "@/adapters/obsidian/reminder-reconciler";
import { VaultTaskStore } from "@/adapters/obsidian/task-store";
import { registerTaskViewActions } from "@/adapters/obsidian/view-actions";
import type { IsotaskApi } from "@/app/agent-instructions";
import { renderAgentInstructions } from "@/app/agent-instructions";
import { makeCheckNtfyCapability } from "@/app/check-ntfy-capability";
import { makeConvertNote } from "@/app/convert-note";
import { makeCreateTask } from "@/app/create-task";
import type { AppDeps } from "@/app/deps";
import { makeReconcileReminders } from "@/app/reconcile-reminders";
import { makeRescheduleTask } from "@/app/reschedule-task";
import { makeSetDate } from "@/app/set-date";
import { makeSetDuration } from "@/app/set-duration";
import { makeSetPriority } from "@/app/set-priority";
import { makeSetProject } from "@/app/set-project";
import { makeSetRecurrence } from "@/app/set-recurrence";
import { makeSetReminder } from "@/app/set-reminder";
import { makeSetStatus } from "@/app/set-status";
import { makeSetTags } from "@/app/set-tags";
import { makeToggleDone } from "@/app/toggle-done";
import { makeRedoReschedule, makeUndoReschedule } from "@/app/undo-reschedule";
import { registerCommands } from "@/commands/register-commands";
import { parseSettings, reminderDefaultsOf } from "@/domain/settings";
import type { IsotaskSettings } from "@/domain/settings";
import { AGENT_GUIDE_URL, VIEW_TYPE_TASK_PANEL } from "@/plugin-id";
import { IsotaskSettingTab } from "@/settings/settings-tab";
import { registerViews } from "@/views/bases/register";
import { revealTaskPanel } from "@/views/task-panel/reveal-task-panel";
import { TASK_PANEL_ICON, TaskPanelView } from "@/views/task-panel/task-panel-view";

/**
 * Composition root (`docs/ARCHITECTURE.md#composition-root`). Loads settings,
 * builds the adapters and `app` use-cases, and registers the Bases views,
 * commands, menus, settings tab, and the public `api` field.
 */
export default class IsotaskPlugin extends Plugin {
	private pluginSettings: IsotaskSettings = parseSettings(undefined);

	/** `app.plugins.plugins.isotask.api` — reads `pluginSettings` live via closure, so it always reflects the current settings. */
	readonly api: IsotaskApi = {
		version: 1,
		agentInstructions: () => renderAgentInstructions(this.pluginSettings, AGENT_GUIDE_URL),
	};

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
		const channel = createNtfyChannel({
			getConfig: () => this.pluginSettings.reminders.ntfy,
			getVaultName: () => this.app.vault.getName(),
		});
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
		const setReminder = makeSetReminder(appDeps);
		const getReminderDefaults = () => reminderDefaultsOf(this.pluginSettings.reminders);
		const setTags = makeSetTags(appDeps);
		const undoReschedule = makeUndoReschedule(appDeps);
		const redoReschedule = makeRedoReschedule(appDeps);
		const reconcileReminders = makeReconcileReminders({ store, clock, channel, settings: () => this.pluginSettings });
		const checkNtfy = makeCheckNtfyCapability({ channel, clock });

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
			setReminder,
			getReminderDefaults,
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
			getAgentInstructions: () => this.api.agentInstructions(),
			createTask,
			convertNote,
			setStatus,
			toggleDone,
			setDate,
			setPriority,
			setDuration,
			setRecurrence,
			setReminder,
			getReminderDefaults,
			setProject,
			setTags,
			undoReschedule,
			redoReschedule,
			reconcileReminders,
			describePushError,
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
			setReminder,
			getReminderDefaults,
			setProject,
			setTags,
			notifier,
		};

		registerTaskMenus(this, taskMenuDeps);
		registerTaskViewActions(this, taskMenuDeps);
		registerCompletionWatcher(this, appDeps);
		registerReminderReconciler(this, { reconcile: reconcileReminders, notifier, describeError: describePushError, getPropertyKeys: () => this.pluginSettings.propertyKeys });
		registerProtocolHandlers(this);

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
				copyAgentInstructions: () => copyToClipboard(this.api.agentInstructions(), notifier, "Agent instructions copied to clipboard."),
				checkNtfy: async () => {
					const result = await checkNtfy();
					if (!result.ok) {
						notifier.error(describePushError(result.error));
						return;
					}
					if (result.value === "ready") {
						notifier.info("ntfy is ready.");
					} else {
						notifier.error("This server is older than ntfy 2.16.");
					}
				},
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
