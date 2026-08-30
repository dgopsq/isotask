import type { App, QueryController } from "obsidian";
import { BasesView, Scope, TFile } from "obsidian";

import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import type { makeCreateTask, TaskDraft } from "@/app/create-task";
import { describeAppError } from "@/app/errors";
import type { RescheduleTask } from "@/app/reschedule-task";
import type { RedoReschedule, UndoReschedule } from "@/app/undo-reschedule";
import type { CalendarEvent } from "@/domain/calendar-events";
import { eventsForTask, sortCalendarEvents } from "@/domain/calendar-events";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import { parseCalendarViewOptions } from "@/domain/calendar-view-options";
import type { TaskDate, Weekday } from "@/domain/dates";
import type { PropertyKeys } from "@/domain/property-keys";
import { none, some } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import { refreshAfterMetadataResolved } from "@/views/bases/refresh-after-resolved";
import { cssClass, VIEW_TYPE_CALENDAR } from "@/plugin-id";
import type { CalendarHandle, CalendarRenderer } from "@/ports/calendar-renderer";
import type { Notifier } from "@/ports/notifier";
import type { RescheduleHistory } from "@/ports/reschedule-history";
import { CreateTaskModal } from "@/ui/create-task-modal";

/** One entry in the results-count dropdown's undocumented `getViewActions` hook — see the doc comment on `FeedBasesView`'s copy of this interface. */
interface BasesViewAction {
	readonly name: string;
	readonly icon: string;
	readonly callback: () => void;
}

export interface CalendarBasesViewDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getWeekStart: () => Weekday;
	readonly getTaskFolder: () => string;
	readonly createTask: ReturnType<typeof makeCreateTask>;
	readonly rescheduleTask: RescheduleTask;
	readonly renderer: CalendarRenderer;
	readonly notifier: Notifier;
	readonly history: RescheduleHistory;
	readonly undoReschedule: UndoReschedule;
	readonly redoReschedule: RedoReschedule;
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
 * to.
 *
 * The three interaction callbacks are handed to `mount` once and therefore
 * outlive any number of `onDataUpdated` passes, so anything of theirs that
 * depends on a view option re-reads `this.config` when it fires rather than
 * closing over the value the option happened to have at mount time.
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
	/** Whether `scope` is currently pushed onto `app.keymap`'s scope stack — see the `focusin`/`focusout` handlers below. */
	private scopePushed = false;
	private readonly scope: Scope;

	constructor(controller: QueryController, containerEl: HTMLElement, deps: CalendarBasesViewDeps) {
		super(controller);
		this.viewContainerEl = containerEl;
		this.deps = deps;

		// Obsidian's Cmd+Z (`editor:undo`) only fires against a focused
		// CodeMirror editor; a BasesView has none, so undo/redo here must be
		// claimed explicitly via a `Scope`. Making the container focusable is
		// what lets a click anywhere inside it arm that scope (clicking a
		// non-focusable descendant focuses the nearest focusable ancestor).
		// The added class is what `styles/calendar.css` targets to suppress
		// the resulting focus ring for pointer focus only.
		this.viewContainerEl.tabIndex = -1;
		this.viewContainerEl.addClass(cssClass("calendar-view"));

		// `app.scope` as the parent means any key this scope doesn't handle
		// falls through to Obsidian's own defaults instead of being swallowed
		// while the calendar has focus.
		this.scope = new Scope(this.deps.app.scope);
		this.scope.register(["Mod"], "z", (evt) => {
			evt.preventDefault();
			void this.runHistoryStep(this.deps.undoReschedule, "Nothing to undo.");
			return false;
		});
		this.scope.register(["Mod", "Shift"], "z", (evt) => {
			evt.preventDefault();
			void this.runHistoryStep(this.deps.redoReschedule, "Nothing to redo.");
			return false;
		});

		this.registerDomEvent(this.viewContainerEl, "focusin", () => {
			if (!this.scopePushed) {
				this.deps.app.keymap.pushScope(this.scope);
				this.scopePushed = true;
			}
		});
		this.registerDomEvent(this.viewContainerEl, "focusout", (evt) => {
			// Focus moving between two descendants of the container (e.g. from
			// one calendar toolbar button to another) fires `focusout` too —
			// only pop once focus has actually left the container entirely.
			if (evt.relatedTarget instanceof Node && this.viewContainerEl.contains(evt.relatedTarget)) {
				return;
			}
			if (this.scopePushed) {
				this.deps.app.keymap.popScope(this.scope);
				this.scopePushed = false;
			}
		});

		refreshAfterMetadataResolved(this, this.deps.app);
	}

	/**
	 * Replaces Bases' own "New" note flow with the full create-task modal —
	 * see `FeedBasesView#createFileForView`'s doc comment for why
	 * `frontmatterProcessor` is accepted but intentionally never called.
	 */
	override async createFileForView(baseFileName?: string, _frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		this.openCreateModal(baseFileName !== undefined ? { title: baseFileName } : undefined);
	}

	/** Undocumented Bases hook — see `FeedBasesView#getViewActions`'s doc comment. */
	getViewActions(): readonly BasesViewAction[] {
		return [{ name: "New task", icon: "plus", callback: () => void this.createFileForView() }];
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
			for (const { task } of tasks) {
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
				// Unconditional: every other calendar view option changes what
				// is *shown*, whereas a read-only toggle would change what is
				// *permitted*, and a user who doesn't want to drag simply
				// doesn't drag.
				editable: true,
				callbacks: {
					// Matches the feed's title link (`feed-view.ts`) rather than
					// `getLeaf().openFile()`, which would need a resolved `TFile`
					// where all we hold is a path.
					onEventClick: (event) => {
						// `openLinkText` on a path that no longer resolves to a file
						// creates a new, empty note there instead of failing — silently
						// resurrecting a task deleted between render and click. Resolve
						// first and bail with an error instead of opening in that case.
						const file = this.deps.app.vault.getAbstractFileByPath(event.taskPath);
						if (!(file instanceof TFile)) {
							this.deps.notifier.error(`Task not found: ${event.taskPath}`);
							return;
						}
						void this.deps.app.workspace.openLinkText(event.taskPath, "", false);
					},
					onEventMoved: async (event, start, end) => {
						// `CalendarEvent.source` is already `"due" | "scheduled"`,
						// i.e. exactly the `DateField` the use-case wants — the
						// event knows which of the task's dates it was derived
						// from, so a drag can never write the wrong one.
						const result = await this.deps.rescheduleTask(event.taskPath, event.source, start, end === undefined ? none() : some(end));
						if (result.ok) {
							this.deps.history.record(result.value);
							return true;
						}
						this.deps.notifier.error(describeAppError(result.error));
						return false;
					},
					onSlotClick: (date) => {
						this.openCreateModal(this.prefillForSlot(date));
					},
				},
			});
			this.handle = handle;
			this.applied = { view: options.initialView, firstDay };
		}

		// Event Calendar normalises all-day events' `start` to midnight
		// before its own (stable) sort, so same-day chips at different
		// times of day would tie there and keep insertion order — sorting
		// here is what actually puts them in time order on screen (see
		// `sortCalendarEvents`'s doc comment).
		handle.setEvents(sortCalendarEvents(events));
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
		// A view can be destroyed while it still has focus (e.g. the pane is
		// closed) — pop the pushed scope so it doesn't leak on `app.keymap`'s
		// scope stack.
		if (this.scopePushed) {
			this.deps.app.keymap.popScope(this.scope);
			this.scopePushed = false;
		}
		this.handle?.destroy();
		this.handle = undefined;
		this.applied = undefined;
		super.onunload();
	}

	/**
	 * Shared body of the Cmd+Z/Cmd+Shift+Z handlers: run one history step,
	 * and tell the user only when there was nothing to do — a successful
	 * undo/redo is visible on the calendar itself, so a notice on top of
	 * that would be noise.
	 */
	private async runHistoryStep(step: UndoReschedule | RedoReschedule, emptyMessage: string): Promise<void> {
		const result = await step();
		if (!result.ok) {
			this.deps.notifier.error(describeAppError(result.error));
			return;
		}
		if (!result.value.some) {
			this.deps.notifier.info(emptyMessage);
		}
	}

	/**
	 * Which date a clicked empty slot pre-fills. Follows the `events` view
	 * option, because pre-filling `scheduled` on a calendar the user has set
	 * to show due dates puts the new task somewhere other than the slot they
	 * clicked. `both` picks `scheduled` — "when will I work on it" is what
	 * clicking a slot expresses.
	 *
	 * Read from `this.config` on each click rather than captured at mount:
	 * the option can be changed while the view is open.
	 */
	private prefillForSlot(date: TaskDate): Partial<TaskDraft> {
		return parseCalendarViewOptions(this.config).events === "due" ? { due: date } : { scheduled: date };
	}

	/** Shared by the Bases "New" flow (`createFileForView`) and the click-an-empty-slot flow, which differ only in what they pre-fill. */
	private openCreateModal(initial?: Partial<TaskDraft>): void {
		new CreateTaskModal(this.deps.app, {
			app: this.deps.app,
			createTask: this.deps.createTask,
			getStatuses: this.deps.getStatuses,
			getDefaultFolder: this.deps.getTaskFolder,
			...(initial !== undefined ? { initial } : {}),
		}).open();
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
