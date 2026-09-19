import type { App, BasesAllOptions, Plugin } from "obsidian";
import { Notice } from "obsidian";

import type { makeCreateTask } from "@/app/create-task";
import type { makeSetDate } from "@/app/set-date";
import type { RescheduleTask } from "@/app/reschedule-task";
import type { makeSetDuration } from "@/app/set-duration";
import type { makeSetPriority } from "@/app/set-priority";
import type { makeSetProject } from "@/app/set-project";
import type { makeSetRecurrence } from "@/app/set-recurrence";
import type { SetReminder } from "@/app/set-reminder";
import type { makeSetStatus } from "@/app/set-status";
import type { makeSetTags } from "@/app/set-tags";
import type { RedoReschedule, UndoReschedule } from "@/app/undo-reschedule";
import { DEFAULT_CALENDAR_VIEW_OPTIONS } from "@/domain/calendar-view-options";
import type { Weekday } from "@/domain/dates";
import { DEFAULT_FEED_VIEW_OPTIONS } from "@/domain/feed-view-options";
import type { PropertyKeys } from "@/domain/property-keys";
import type { ReminderDefaults } from "@/domain/reminders";
import type { StatusConfig } from "@/domain/status";
import { PLUGIN_NAME, VIEW_TYPE_CALENDAR, VIEW_TYPE_FEED } from "@/plugin-id";
import type { CalendarRenderer } from "@/ports/calendar-renderer";
import type { Clock } from "@/ports/clock";
import type { Haptics } from "@/ports/haptics";
import type { NavigationMemory } from "@/ports/navigation-memory";
import type { Notifier } from "@/ports/notifier";
import type { RescheduleHistory } from "@/ports/reschedule-history";
import { CalendarBasesView } from "@/views/bases/calendar/calendar-view";
import { FeedBasesView } from "@/views/bases/feed/feed-view";

/**
 * Bases-native view options for the feed, shown in Bases' own view-options
 * panel — not plugin settings. Keys/defaults mirror
 * `domain/feed-view-options.ts#DEFAULT_FEED_VIEW_OPTIONS`; `parseFeedViewOptions`
 * is what actually reads these back out of `BasesViewConfig` in `feed-view.ts`.
 */
const feedViewOptions: BasesAllOptions[] = [
	{
		key: "dateSource",
		type: "dropdown",
		displayName: "Date source",
		default: DEFAULT_FEED_VIEW_OPTIONS.dateSource,
		options: { due: "Due", scheduled: "Scheduled", earliest: "Earliest" },
	},
	{
		key: "showEmptyBuckets",
		type: "toggle",
		displayName: "Show empty buckets",
		default: DEFAULT_FEED_VIEW_OPTIONS.showEmptyBuckets,
	},
	{
		key: "completedAtBottom",
		type: "toggle",
		displayName: "Group completed tasks at bottom",
		default: DEFAULT_FEED_VIEW_OPTIONS.completedAtBottom,
	},
];

/** Monday-first, matching `domain/dates.ts`'s `Weekday` (0=Mon..6=Sun). */
const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
	0: "Monday",
	1: "Tuesday",
	2: "Wednesday",
	3: "Thursday",
	4: "Friday",
	5: "Saturday",
	6: "Sunday",
};

/**
 * Bases-native view options for the calendar. Keys/defaults mirror
 * `domain/calendar-view-options.ts#DEFAULT_CALENDAR_VIEW_OPTIONS`;
 * `parseCalendarViewOptions` reads these back out of `BasesViewConfig` in
 * `calendar-view.ts`.
 *
 * `firstDay`'s dropdown options use digit-string keys ("0".."6") because
 * `BasesDropdownOption.options` is `Record<string, string>` — there is no
 * numeric-keyed dropdown in Bases' own API — and `parseCalendarViewOptions`
 * accepts those digit strings alongside raw numbers (see
 * `calendar-view-options.ts`'s `FirstDaySchema`).
 */
function calendarViewOptions(getWeekStart: () => Weekday): BasesAllOptions[] {
	return [
		{
			key: "initialView",
			type: "dropdown",
			displayName: "Initial view",
			default: DEFAULT_CALENDAR_VIEW_OPTIONS.initialView,
			options: { month: "Month", week: "Week", day: "Day" },
		},
		{
			key: "events",
			type: "dropdown",
			displayName: "Events",
			default: DEFAULT_CALENDAR_VIEW_OPTIONS.events,
			options: { both: "Due and scheduled", due: "Due only", scheduled: "Scheduled only" },
		},
		{
			key: "firstDay",
			type: "dropdown",
			displayName: "First day of week",
			// Populated from the plugin's week-start setting at the moment
			// Bases asks for this view's options (see `registerBasesView`'s
			// `options: (config) => [...]` closure below) — a freshly-added
			// calendar view starts matching the plugin setting, but stays
			// overridable per `.base` file, same as `dateSource` for the feed.
			default: String(getWeekStart()),
			options: {
				default: "Default (plugin setting)",
				"0": WEEKDAY_LABELS[0],
				"1": WEEKDAY_LABELS[1],
				"2": WEEKDAY_LABELS[2],
				"3": WEEKDAY_LABELS[3],
				"4": WEEKDAY_LABELS[4],
				"5": WEEKDAY_LABELS[5],
				"6": WEEKDAY_LABELS[6],
			},
		},
	];
}

export interface RegisterViewsDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getWeekStart: () => Weekday;
	readonly getTaskFolder: () => string;
	readonly createTask: ReturnType<typeof makeCreateTask>;
	readonly rescheduleTask: RescheduleTask;
	readonly renderer: CalendarRenderer;
	readonly history: RescheduleHistory;
	readonly undoReschedule: UndoReschedule;
	readonly redoReschedule: RedoReschedule;
	readonly navigationMemory: NavigationMemory;
	readonly clock: Clock;
	readonly setStatus: ReturnType<typeof makeSetStatus>;
	readonly setPriority: ReturnType<typeof makeSetPriority>;
	readonly setDate: ReturnType<typeof makeSetDate>;
	readonly setDuration: ReturnType<typeof makeSetDuration>;
	readonly setRecurrence: ReturnType<typeof makeSetRecurrence>;
	readonly setReminder: SetReminder;
	readonly getReminderDefaults: () => ReminderDefaults;
	readonly setProject: ReturnType<typeof makeSetProject>;
	readonly setTags: ReturnType<typeof makeSetTags>;
	readonly notifier: Notifier;
	readonly haptics: Haptics;
}

/** Registers the feed and calendar Bases views (`VIEW_TYPE_FEED`/`VIEW_TYPE_CALENDAR`). Returns whether Bases is enabled in this vault. */
export function registerViews(plugin: Plugin, deps: RegisterViewsDeps): boolean {
	const feedRegistered = plugin.registerBasesView(VIEW_TYPE_FEED, {
		name: `${PLUGIN_NAME} feed`,
		icon: "list-checks",
		factory: (controller, containerEl) =>
			new FeedBasesView(controller, containerEl, {
				app: deps.app,
				getPropertyKeys: deps.getPropertyKeys,
				getStatuses: deps.getStatuses,
				getWeekStart: deps.getWeekStart,
				getTaskFolder: deps.getTaskFolder,
				createTask: deps.createTask,
				setStatus: deps.setStatus,
				setPriority: deps.setPriority,
				setDate: deps.setDate,
				setDuration: deps.setDuration,
				setRecurrence: deps.setRecurrence,
				setReminder: deps.setReminder,
				getReminderDefaults: deps.getReminderDefaults,
				setProject: deps.setProject,
				setTags: deps.setTags,
				notifier: deps.notifier,
				haptics: deps.haptics,
			}),
		options: () => feedViewOptions,
	});

	const calendarRegistered = plugin.registerBasesView(VIEW_TYPE_CALENDAR, {
		name: `${PLUGIN_NAME} calendar`,
		icon: "calendar",
		factory: (controller, containerEl) =>
			new CalendarBasesView(controller, containerEl, {
				app: deps.app,
				getPropertyKeys: deps.getPropertyKeys,
				getStatuses: deps.getStatuses,
				getWeekStart: deps.getWeekStart,
				getTaskFolder: deps.getTaskFolder,
				createTask: deps.createTask,
				rescheduleTask: deps.rescheduleTask,
				renderer: deps.renderer,
				notifier: deps.notifier,
				haptics: deps.haptics,
				history: deps.history,
				undoReschedule: deps.undoReschedule,
				redoReschedule: deps.redoReschedule,
				navigationMemory: deps.navigationMemory,
				clock: deps.clock,
			}),
		options: () => calendarViewOptions(deps.getWeekStart),
	});

	const enabled = feedRegistered && calendarRegistered;
	if (!enabled) {
		new Notice(`${PLUGIN_NAME}: Bases is not enabled in this vault, so the feed and calendar views are unavailable.`);
	}
	return enabled;
}
