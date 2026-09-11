import type { App, QueryController } from "obsidian";
import { BasesView, Scope, TFile } from "obsidian";

import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import { projectFilePath, projectRawColor } from "@/adapters/obsidian/project-color-lookup";
import type { makeCreateTask, TaskDraft } from "@/app/create-task";
import { describeAppError } from "@/app/errors";
import type { RescheduleTask } from "@/app/reschedule-task";
import type { RedoReschedule, UndoReschedule } from "@/app/undo-reschedule";
import type { CalendarEvent } from "@/domain/calendar-events";
import { eventsForTask, sortCalendarEvents } from "@/domain/calendar-events";
import type { CalendarViewKind } from "@/domain/calendar-view-options";
import { COMPACT_CALENDAR_WIDTH, parseCalendarViewOptions } from "@/domain/calendar-view-options";
import type { TaskDate, Weekday } from "@/domain/dates";
import { toDateOnly } from "@/domain/dates";
import type { DotColor } from "@/domain/project-color";
import { resolveDotColor } from "@/domain/project-color";
import type { PropertyKeys } from "@/domain/property-keys";
import { none, some } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import type { Task } from "@/domain/task";
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
 *
 * **Compact month is read-and-navigate only, never create-on-tap.** Below
 * `COMPACT_CALENDAR_WIDTH` month renders as a grid of small dots
 * (`styles/calendar.css`), too small to reliably drag or to distinguish by
 * title — so `onSlotClick` there jumps into Day view for the tapped date
 * (`handle.goTo` + `handle.setView("day")`) instead of opening the
 * create-task modal. Creating a task from a narrow pane means either the
 * Bases toolbar's "+ New" (`createFileForView`, unaffected by this) or
 * drilling into Day view and tapping a time slot there. `handle.getView()`
 * (not the Bases-configured `initialView`) decides whether "month" is
 * actually on screen, since the user can switch views with Event Calendar's
 * own header buttons without this view ever finding out.
 */
export class CalendarBasesView extends BasesView {
	override type = VIEW_TYPE_CALENDAR;

	private readonly viewContainerEl: HTMLElement;
	private readonly deps: CalendarBasesViewDeps;
	private handle: CalendarHandle | undefined;
	private invalidLineEl: HTMLElement | undefined;
	/** The `.isotask-calendar` root the renderer is mounted into — kept so `isotask-calendar--compact` can be toggled on it from `onResize` as well as `onDataUpdated`. */
	private calendarRootEl: HTMLElement | undefined;
	/**
	 * The view/firstDay/compact last pushed to the handle. `onDataUpdated`
	 * fires on every vault change, and the user may have switched views in
	 * the calendar's own toolbar since the last one — re-applying the
	 * configured `initialView` unconditionally would snap them back. Only a
	 * change to one of these three is pushed. `compact` is a pane-width fact
	 * (see `isCompact`), not part of the Bases config, but it's tracked here
	 * for exactly the same reason: `onResize` fires far more often than the
	 * width actually crosses the threshold, and `setCompact` destroys and
	 * remounts the whole widget (`event-calendar-renderer.ts`), so it must
	 * only be called on an actual change.
	 */
	private applied: { readonly view: CalendarViewKind; readonly firstDay: Weekday; readonly compact: boolean } | undefined;
	/** Whether `scope` is currently pushed onto `app.keymap`'s scope stack — see the `focusin`/`focusout` handlers below. */
	private scopePushed = false;
	private readonly scope: Scope;
	/**
	 * Vault-relative paths of every project note the last render's events
	 * resolved a dot color against — rebuilt from scratch at the top of
	 * every `onDataUpdated` (`resolveTaskDotColor` repopulates it per task).
	 * Backs the `metadataCache` `changed` listener below, mirroring the
	 * feed's own `lastProjectPaths` (`feed-view.ts`): a project note's
	 * `color` changing touches no task note, so nothing else re-triggers
	 * `onDataUpdated`.
	 */
	private lastProjectPaths = new Set<string>();

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

		// Event Calendar classes the root only after the drag threshold, and rewrites `.ec-event`'s class
		// wholesale once a resize starts, so the press-lift exclusion goes on our own root at pointerdown.
		const resizingCls = cssClass("calendar--resizing");
		this.registerDomEvent(
			this.viewContainerEl,
			"pointerdown",
			(evt) => {
				if (evt.target instanceof Element && evt.target.closest(".ec-resizer") !== null) {
					this.calendarRootEl?.addClass(resizingCls);
				}
			},
			{ capture: true },
		);
		const clearResizing = (): void => {
			this.calendarRootEl?.removeClass(resizingCls);
		};
		this.registerDomEvent(document, "pointerup", clearResizing);
		this.registerDomEvent(document, "pointercancel", clearResizing);

		refreshAfterMetadataResolved(this, this.deps.app);

		// See `lastProjectPaths`'s doc comment, and the identical listener on
		// `FeedBasesView` — no rename handling for the same reason given
		// there: `metadataCache` fires no `changed` on rename, and the
		// hashed-fallback color simply follows a renamed project on whatever
		// render happens to touch this view next.
		this.registerEvent(
			this.deps.app.metadataCache.on("changed", (file) => {
				if (this.lastProjectPaths.has(file.path)) {
					this.onDataUpdated();
				}
			}),
		);
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
		const effective = this.computeEffective();

		// The calendar has no notion of Bases' outer `groupedData` groups (a
		// timeline can't be split into separate group sections the way the
		// feed's bucket lists can) — every group's tasks contribute events to
		// the same calendar.
		const events: CalendarEvent[] = [];
		let invalidCount = 0;
		// Rebuilt below as `resolveTaskDotColor` runs per task — see the
		// field's doc comment for why this can't just be computed once up
		// front.
		this.lastProjectPaths = new Set<string>();
		for (const group of this.data.groupedData) {
			const { tasks, invalid } = tasksFromBasesEntries(this.deps.app, group.entries, keys, statuses);
			invalidCount += invalid.length;
			for (const { task } of tasks) {
				events.push(...eventsForTask(task, { source: options.events }, this.resolveTaskDotColor(task)));
			}
		}

		let handle = this.handle;
		if (handle === undefined) {
			this.viewContainerEl.empty();
			this.invalidLineEl = this.viewContainerEl.createDiv({ cls: cssClass("calendar__invalid") });
			const root = this.viewContainerEl.createDiv({ cls: cssClass("calendar") });
			this.calendarRootEl = root;
			handle = this.deps.renderer.mount(root, {
				initialView: effective.view,
				firstDay: effective.firstDay,
				compact: effective.compact,
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
							// Event Calendar replaces the dragged element with a
							// ghost mid-gesture, so by the time the drop lands
							// focus has fallen back to `document.body` — which
							// popped our scope and left Cmd+Z dead at exactly the
							// moment an undo became available. Take focus back so
							// the keystroke is armed for the gesture just made.
							this.viewContainerEl.focus();
							return true;
						}
						this.deps.notifier.error(describeAppError(result.error));
						return false;
					},
					onSlotClick: (date) => {
						// Compact month is read-and-navigate only (see the class
						// doc comment on drilling into Day view): a tap on a day
						// cell there jumps to Day view for that date instead of
						// opening the create-task modal. `handle.getView()` (not
						// `this.applied.view`/the raw Bases config) is what
						// actually decides this — the user can switch views with
						// Event Calendar's own header buttons, which this view
						// never learns about, so a stale `applied.view` would
						// wrongly navigate a click made after switching to Day.
						// `isCompact()` is read fresh for the same reason: it's a
						// live pane-width fact, not something cached at mount.
						// Read via `this.handle` (rather than the `handle` local
						// this closure was built inside) so the check is
						// meaningful rather than a type-narrowing formality: by
						// the time a user can click anything the mount below has
						// always finished and `this.handle` is set, but a click
						// firing before that (this callback outlives the mount
						// call it's defined inside) has nothing to act on yet.
						const currentHandle = this.handle;
						if (currentHandle === undefined) {
							return;
						}
						if (this.isCompact() && currentHandle.getView() === "month") {
							currentHandle.goTo(toDateOnly(date));
							currentHandle.setView("day");
							return;
						}
						this.openCreateModal(this.prefillForSlot(date));
					},
				},
			});
			this.handle = handle;
			this.applied = effective;
		}

		// Event Calendar normalises all-day events' `start` to midnight
		// before its own (stable) sort, so same-day chips at different
		// times of day would tie there and keep insertion order — sorting
		// here is what actually puts them in time order on screen (see
		// `sortCalendarEvents`'s doc comment).
		handle.setEvents(sortCalendarEvents(events));
		this.applyEffective(effective);
		this.renderInvalidLine(invalidCount);
	}

	override onunload(): void {
		// Bases reuses the same `containerEl` across view-type switches, so
		// the class added in the constructor must come off here or the next
		// view inherits it.
		this.viewContainerEl.removeClass(cssClass("calendar-view"));
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
		this.calendarRootEl = undefined;
		super.onunload();
	}

	/**
	 * Undocumented-but-real Bases hook (see `getViewActions`'s doc comment
	 * for the pattern): called when the leaf's own size changes — a pane
	 * resize, a split being dragged, the workspace layout changing — without
	 * a corresponding `onDataUpdated`. `onDataUpdated` alone would leave the
	 * calendar showing 7-column chrome after the user drags a pane narrower
	 * (or vice versa) until the next vault-driven re-render.
	 */
	onResize(): void {
		if (this.handle === undefined) {
			return;
		}
		this.applyEffective(this.computeEffective());
	}

	/**
	 * Whether the pane is too narrow to sensibly render a 7-column week/month
	 * grid — see `domain/calendar-view-options.ts`'s `COMPACT_CALENDAR_WIDTH`.
	 * A pane-width fact, not "is this a mobile client": a narrow split pane
	 * on desktop is compact, a full-width pane on a phone in landscape isn't.
	 * `clientWidth` is `0` before the container has ever been laid out (e.g.
	 * a view created in a background/hidden tab) — treated as "not compact"
	 * rather than the false positive an unmeasured `0 < 640` would give.
	 */
	private isCompact(): boolean {
		const width = this.viewContainerEl.clientWidth;
		return width > 0 && width < COMPACT_CALENDAR_WIDTH;
	}

	/** The view/firstDay/compact that should currently be in effect, derived from the Bases config and the pane's current width. */
	private computeEffective(): { readonly view: CalendarViewKind; readonly firstDay: Weekday; readonly compact: boolean } {
		const options = parseCalendarViewOptions(this.config);
		const firstDay = options.firstDay === "default" ? this.deps.getWeekStart() : options.firstDay;
		const compact = this.isCompact();
		return { view: options.initialView, firstDay, compact };
	}

	/**
	 * Pushes onto the handle whichever of view/firstDay/compact actually
	 * changed since the last push, and keeps the `isotask-calendar--compact`
	 * class (which `styles/calendar.css` keys its header compaction off of)
	 * in sync with the same `compact` value the JS just computed — one
	 * source of truth for the breakpoint instead of a second, drifting CSS
	 * media query. Toggling the class is unconditional (cheap and
	 * idempotent) rather than gated on "did compact change", so it can never
	 * drift from `effective.compact` even if a future edit adds another
	 * early-return before it.
	 */
	private applyEffective(effective: { readonly view: CalendarViewKind; readonly firstDay: Weekday; readonly compact: boolean }): void {
		const handle = this.handle;
		if (handle === undefined) {
			return;
		}
		const applied = this.applied;
		if (applied?.view !== effective.view) {
			handle.setView(effective.view);
		}
		if (applied?.firstDay !== effective.firstDay) {
			handle.setFirstDay(effective.firstDay);
		}
		if (applied?.compact !== effective.compact) {
			handle.setCompact(effective.compact);
		}
		this.calendarRootEl?.toggleClass(cssClass("calendar--compact"), effective.compact);
		this.applied = effective;
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

	/**
	 * The `DotColor` a task's events should carry — the task's project's own
	 * color, or `neutral` with no project (`domain/project-color.ts
	 * #resolveDotColor`). A project-less task skips the metadata-cache
	 * lookup entirely rather than resolving against `undefined`. Also the
	 * one place `lastProjectPaths` gets populated. A `hex` result needs no
	 * further action here — `event-calendar-mapping.ts#toEventCalendarEvent`
	 * relays it through `extendedProps.hexDotColor`, and
	 * `event-calendar-renderer.ts`'s `eventDidMount` is what actually
	 * applies it to the mounted DOM element once one exists.
	 */
	private resolveTaskDotColor(task: Task): DotColor {
		const project = task.project;
		const rawColor = project === undefined ? undefined : projectRawColor(this.deps.app, project, task.path);
		const dotColor = resolveDotColor(rawColor, project);
		if (project !== undefined) {
			const projectPath = projectFilePath(this.deps.app, project, task.path);
			if (projectPath !== undefined) {
				this.lastProjectPaths.add(projectPath);
			}
		}
		return dotColor;
	}

	/** Shared by the Bases "New" flow (`createFileForView`) and the click-an-empty-slot flow, which differ only in what they pre-fill. */
	private openCreateModal(initial?: Partial<TaskDraft>): void {
		new CreateTaskModal(this.deps.app, {
			app: this.deps.app,
			createTask: this.deps.createTask,
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
