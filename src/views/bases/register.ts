import type { App, BasesAllOptions, Plugin } from "obsidian";
import { Notice } from "obsidian";

import type { makeSetDate } from "@/app/set-date";
import type { makeSetStatus } from "@/app/set-status";
import type { Weekday } from "@/domain/dates";
import { DEFAULT_FEED_VIEW_OPTIONS } from "@/domain/feed-view-options";
import type { PropertyKeys } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import { PLUGIN_NAME, VIEW_TYPE_CALENDAR, VIEW_TYPE_FEED } from "@/plugin-id";
import type { Notifier } from "@/ports/notifier";
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
		displayName: "Completed tasks at bottom",
		default: DEFAULT_FEED_VIEW_OPTIONS.completedAtBottom,
	},
];

export interface RegisterViewsDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getWeekStart: () => Weekday;
	readonly setStatus: ReturnType<typeof makeSetStatus>;
	readonly setDate: ReturnType<typeof makeSetDate>;
	readonly notifier: Notifier;
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
				setStatus: deps.setStatus,
				setDate: deps.setDate,
				notifier: deps.notifier,
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
			}),
	});

	const enabled = feedRegistered && calendarRegistered;
	if (!enabled) {
		new Notice(`${PLUGIN_NAME}: Bases is not enabled in this vault, so the feed and calendar views are unavailable.`);
	}
	return enabled;
}
