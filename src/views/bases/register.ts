import type { App, Plugin } from "obsidian";
import { Notice } from "obsidian";

import type { Weekday } from "@/domain/dates";
import type { PropertyKeys } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import { CalendarBasesView } from "@/views/bases/calendar/calendar-view";
import { FeedBasesView } from "@/views/bases/feed/feed-view";

export interface RegisterViewsDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getWeekStart: () => Weekday;
}

/** Registers `obtask-feed` and `obtask-calendar`. Returns whether Bases is enabled in this vault. */
export function registerViews(plugin: Plugin, deps: RegisterViewsDeps): boolean {
	const feedRegistered = plugin.registerBasesView("obtask-feed", {
		name: "Obtask feed",
		icon: "list-checks",
		factory: (controller, containerEl) =>
			new FeedBasesView(controller, containerEl, {
				app: deps.app,
				getPropertyKeys: deps.getPropertyKeys,
				getStatuses: deps.getStatuses,
				getWeekStart: deps.getWeekStart,
			}),
	});

	const calendarRegistered = plugin.registerBasesView("obtask-calendar", {
		name: "Obtask calendar",
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
		new Notice("Obtask: Bases is not enabled in this vault, so the feed and calendar views are unavailable.");
	}
	return enabled;
}
