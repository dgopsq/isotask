import type { App, Plugin } from "obsidian";
import { Notice } from "obsidian";

import type { Weekday } from "@/domain/dates";
import type { PropertyKeys } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import { PLUGIN_NAME, VIEW_TYPE_CALENDAR, VIEW_TYPE_FEED } from "@/plugin-id";
import { CalendarBasesView } from "@/views/bases/calendar/calendar-view";
import { FeedBasesView } from "@/views/bases/feed/feed-view";

export interface RegisterViewsDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getWeekStart: () => Weekday;
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
			}),
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
