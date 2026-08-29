import type { App, QueryController } from "obsidian";
import { BasesView } from "obsidian";

import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import type { CalendarEvent } from "@/domain/calendar-events";
import { eventsForTask } from "@/domain/calendar-events";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import { parseCalendarViewOptions } from "@/domain/calendar-view-options";
import type { Weekday } from "@/domain/dates";
import type { PropertyKeys } from "@/domain/property-keys";
import type { StatusConfig } from "@/domain/status";
import { cssClass, VIEW_TYPE_CALENDAR } from "@/plugin-id";
import type { CalendarHandle, CalendarRenderer } from "@/ports/calendar-renderer";
import type { Notifier } from "@/ports/notifier";

export interface CalendarBasesViewDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getWeekStart: () => Weekday;
	readonly renderer: CalendarRenderer;
	readonly notifier: Notifier;
}

/**
 * Calendar view: mounts a `CalendarRenderer` (Event Calendar, ADR 0006) over
 * the tasks in view, honouring the three Bases-native view options
 * (`domain/calendar-view-options.ts`) registered in `views/bases/register.ts`.
 *
 * Mount happens once, on the first `onDataUpdated`; every subsequent update
 * pushes new events/view/firstDay onto the existing `CalendarHandle` instead
 * of destroying and recreating the widget — a remount would reset the
 * calendar to its initial date, discarding whatever the user had navigated
 * to. `notifier` is currently unused (no failure path exists yet in a
 * read-only view) but kept in `deps` for parity with the feed view and
 * because M4's interactions (reschedule via drag) will need it.
 */
export class CalendarBasesView extends BasesView {
	override type = VIEW_TYPE_CALENDAR;

	private readonly viewContainerEl: HTMLElement;
	private readonly deps: CalendarBasesViewDeps;
	private handle: CalendarHandle | undefined;
	private invalidLineEl: HTMLElement | undefined;
	/**
	 * The view/firstDay last pushed to the handle. `onDataUpdated` fires on
	 * every vault change, and the user may have switched views in the
	 * calendar's own toolbar since the last one — re-applying the configured
	 * `initialView` unconditionally would snap them back. Only a change to the
	 * option itself is pushed.
	 */
	private applied: { readonly view: CalendarViewKind; readonly firstDay: Weekday } | undefined;

	constructor(controller: QueryController, containerEl: HTMLElement, deps: CalendarBasesViewDeps) {
		super(controller);
		this.viewContainerEl = containerEl;
		this.deps = deps;

		// Same first-render race as the feed view (see its constructor and
		// `docs/ARCHITECTURE.md`): re-run `onDataUpdated()` once the
		// `metadataCache` settles, so a task indexed just after Bases handed
		// us its entry isn't missing from the calendar until some unrelated
		// edit happens to trigger a re-query. Safe to call repeatedly —
		// `onDataUpdated()` pushes onto the already-mounted handle rather than
		// remounting it.
		this.registerEvent(
			this.deps.app.metadataCache.on("resolved", () => {
				this.onDataUpdated();
			}),
		);
	}

	override onDataUpdated(): void {
		const keys = this.deps.getPropertyKeys();
		const statuses = this.deps.getStatuses();
		const options = parseCalendarViewOptions(this.config);
		const firstDay = options.firstDay === "default" ? this.deps.getWeekStart() : options.firstDay;

		// The calendar has no notion of Bases' outer `groupedData` groups (a
		// timeline can't be split into separate group sections the way the
		// feed's bucket lists can) — every group's tasks contribute events to
		// the same calendar.
		const events: CalendarEvent[] = [];
		let invalidCount = 0;
		for (const group of this.data.groupedData) {
			const { tasks, invalid } = tasksFromBasesEntries(this.deps.app, group.entries, keys, statuses);
			invalidCount += invalid.length;
			for (const task of tasks) {
				events.push(...eventsForTask(task, { source: options.events }));
			}
		}

		let handle = this.handle;
		if (handle === undefined) {
			this.viewContainerEl.empty();
			this.invalidLineEl = this.viewContainerEl.createDiv({ cls: cssClass("calendar__invalid") });
			const root = this.viewContainerEl.createDiv({ cls: cssClass("calendar") });
			handle = this.deps.renderer.mount(root, {
				initialView: options.initialView,
				firstDay,
				callbacks: {},
			});
			this.handle = handle;
			this.applied = { view: options.initialView, firstDay };
		}

		handle.setEvents(events);
		const applied = this.applied;
		if (applied?.view !== options.initialView) {
			handle.setView(options.initialView);
		}
		if (applied?.firstDay !== firstDay) {
			handle.setFirstDay(firstDay);
		}
		this.applied = { view: options.initialView, firstDay };
		this.renderInvalidLine(invalidCount);
	}

	override onunload(): void {
		this.handle?.destroy();
		this.handle = undefined;
		this.applied = undefined;
		super.onunload();
	}

	private renderInvalidLine(count: number): void {
		const el = this.invalidLineEl;
		if (el === undefined) {
			return;
		}
		if (count === 0) {
			el.setText("");
			el.hide();
			return;
		}
		el.show();
		el.setText(count === 1 ? "1 task could not be parsed and is not shown." : `${String(count)} tasks could not be parsed and are not shown.`);
	}
}
