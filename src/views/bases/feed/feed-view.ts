import type { AnimationController } from "@formkit/auto-animate";
import autoAnimate from "@formkit/auto-animate";
import type { App, BasesEntry, BasesPropertyId, QueryController } from "obsidian";
import { BasesView, Component, Menu, NullValue, setIcon } from "obsidian";

import type { TaskWithEntry } from "@/adapters/obsidian/bases-entries";
import { tasksFromBasesEntries } from "@/adapters/obsidian/bases-entries";
import { projectFilePath, projectRawColor } from "@/adapters/obsidian/project-color-lookup";
import type { makeCreateTask } from "@/app/create-task";
import type { DateField } from "@/app/set-date";
import type { makeSetDate } from "@/app/set-date";
import type { makeSetDuration } from "@/app/set-duration";
import type { makeSetPriority } from "@/app/set-priority";
import type { makeSetProject } from "@/app/set-project";
import type { makeSetRecurrence } from "@/app/set-recurrence";
import type { makeSetStatus } from "@/app/set-status";
import type { makeSetTags } from "@/app/set-tags";
import { describeAppError } from "@/app/errors";
import type { Bucket, DateSource } from "@/domain/buckets";
import { groupIntoBuckets, visibleBuckets } from "@/domain/buckets";
import type { TaskDate } from "@/domain/dates";
import { fromJsDate } from "@/domain/dates";
import type { Weekday } from "@/domain/dates";
import type { FeedColumn, FeedRowAnchor } from "@/domain/feed-row";
import { feedRowAnchor, feedRowColumns, feedRowDefaultDateField } from "@/domain/feed-row";
import { COMPACT_FEED_WIDTH, parseFeedViewOptions } from "@/domain/feed-view-options";
import type { PropertyKeys } from "@/domain/property-keys";
import { dotColorClasses, resolveDotColor } from "@/domain/project-color";
import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import { findStatus } from "@/domain/status";
import type { Priority, StatusId, Task, TaskPath } from "@/domain/task";
import { describeTaskParseError, priorityChipClass, priorityMarks } from "@/domain/task";
import { refreshAfterMetadataResolved } from "@/views/bases/refresh-after-resolved";
import { cssClass, VIEW_TYPE_FEED } from "@/plugin-id";
import type { Notifier } from "@/ports/notifier";
import { CreateTaskModal } from "@/ui/create-task-modal";
import { DateModal } from "@/ui/date-modal";
import { buildPriorityMenu } from "@/ui/priority-menu";
import { ProjectColorModal } from "@/ui/project-color-modal";
import { buildStatusMenu, statusIcon } from "@/ui/status-menu";
import { buildTaskEditMenu } from "@/ui/task-edit-menu";

/** One entry in the results-count dropdown's undocumented `getViewActions` hook (see below) — mirrors the shape read off `BasesView` instances in the Bases toolbar bundle, not exported by `obsidian.d.ts`. */
interface BasesViewAction {
	readonly name: string;
	readonly icon: string;
	readonly callback: () => void;
}

/**
 * One top-level child of the feed list (group/bucket header, task row,
 * invalid row, empty-bucket placeholder), kept across renders under its
 * reconciliation key — see `FeedBasesView#rendered`. `comp` exists only for
 * task rows (the one kind that registers DOM listeners) and is swapped on
 * every refill of that row's contents.
 */
interface RenderedItem {
	readonly el: HTMLElement;
	comp: Component | undefined;
}

const BUCKET_LABELS: Readonly<Record<Bucket, string>> = {
	overdue: "Overdue",
	today: "Today",
	"this-week": "This week",
	"next-week": "Next week",
	later: "Later",
	"no-date": "No date",
	errors: "Errors",
};

const DATE_FIELD_LABELS: Readonly<Record<FeedRowAnchor["field"], string>> = {
	due: "Due",
	scheduled: "Scheduled",
};

/**
 * A `Menu` forced to render as DOM rather than a native OS context menu.
 * Obsidian defaults `useNativeMenu` to `true` on macOS when the
 * `nativeMenus` vault config is unset (`Menu`'s `onload`, verified against
 * the bundled app bundle) — a native menu can't be keyboard-navigated or
 * styled the same as the rest of this plugin's UI, and has no DOM to test
 * against, so every menu this view opens itself forces the DOM path.
 */
function newMenu(): Menu {
	return new Menu().setUseNativeMenu(false);
}

export interface FeedBasesViewDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
	readonly getWeekStart: () => Weekday;
	readonly getTaskFolder: () => string;
	readonly createTask: ReturnType<typeof makeCreateTask>;
	readonly setStatus: ReturnType<typeof makeSetStatus>;
	readonly setPriority: ReturnType<typeof makeSetPriority>;
	readonly setDate: ReturnType<typeof makeSetDate>;
	readonly setDuration: ReturnType<typeof makeSetDuration>;
	readonly setRecurrence: ReturnType<typeof makeSetRecurrence>;
	readonly setProject: ReturnType<typeof makeSetProject>;
	readonly setTags: ReturnType<typeof makeSetTags>;
	readonly notifier: Notifier;
}

/**
 * Feed view: renders bucket headers and rows (status control, title link,
 * then the columns the Bases toolbar's "Properties" menu selects — date
 * chip, priority chip, project link, tags, and a muted generic chip for
 * anything else — see `domain/feed-row.ts#feedRowColumns`) from parsed
 * tasks, honouring the three Bases-native view options
 * (`domain/feed-view-options.ts`) registered in `views/bases/register.ts`.
 * Row layout stays thin — pure domain code decides buckets/anchors/columns,
 * this file only renders and dispatches.
 */
export class FeedBasesView extends BasesView {
	override type = VIEW_TYPE_FEED;

	private readonly viewContainerEl: HTMLElement;
	private readonly deps: FeedBasesViewDeps;
	/** The grid itself — a dedicated child of `viewContainerEl` so `onunload` can drop it wholesale and a fresh view never inherits a stale animation observer. */
	private readonly listEl: HTMLElement;
	/** autoAnimate's handle on `listEl`, disabled in `onunload` — see that method's comment. */
	private readonly animation: AnimationController;
	/** Whether a first `onDataUpdated` has already armed `animation` — see the enable at the end of that method. */
	private animatedOnce = false;
	/**
	 * One entry per top-level child of `listEl` held after the last render,
	 * keyed by reconciliation key (`g:`/`b:`/`e:`/`i:`/`r:` prefixes below).
	 * Reusing an unchanged task's element across renders — rather than the
	 * old full `empty()` rebuild — is what lets autoAnimate see a surviving
	 * child move rather than reading every render as a remove-all/add-all (no
	 * FLIP to animate). A row's `comp` owns that row's DOM listeners and is
	 * swapped on every refill of its contents, same lifecycle idea as the old
	 * per-render `rows` component, now at row granularity instead of
	 * view-render granularity.
	 */
	private readonly rendered = new Map<string, RenderedItem>();

	/**
	 * Vault-relative paths of every project note the last render's dots
	 * resolved a color against — rebuilt from scratch at the top of every
	 * `onDataUpdated` (`renderDot` repopulates it as rows render). Backs the
	 * `metadataCache` `changed` listener below: editing a project note's own
	 * `color` doesn't touch any task note, so nothing else would trigger a
	 * re-render.
	 */
	private lastProjectPaths = new Set<string>();

	constructor(controller: QueryController, containerEl: HTMLElement, deps: FeedBasesViewDeps) {
		super(controller);
		this.viewContainerEl = containerEl;
		this.deps = deps;
		this.viewContainerEl.addClass(cssClass("feed"));

		// Bases reuses containerEl across view switches and the reconciler
		// below never empties it again — clear whatever a previous view left
		// behind once, here, instead of on every data update.
		this.viewContainerEl.empty();
		this.listEl = this.viewContainerEl.createDiv({ cls: cssClass("feed__list") });
		// `duration` matches the row-level transitions elsewhere in the
		// plugin; autoAnimate no-ops under `prefers-reduced-motion` on its
		// own, so there's nothing to gate here.
		this.animation = autoAnimate(this.listEl, { duration: 180 });
		// Disabled until the first `onDataUpdated` has painted: the initial
		// render adds every row at once, and animating that reads as the
		// whole feed fading in on every view open (and left e2e screenshots
		// half-transparent) — only real data changes should animate.
		this.animation.disable();

		refreshAfterMetadataResolved(this, this.deps.app);

		// A project note's `color` frontmatter changing must re-render every
		// task whose dot depends on it — no task note itself changed, so
		// Bases' own re-query (which fires off *its* file-change tracking)
		// never re-runs `onDataUpdated` for this. No rename handling: per
		// `docs/DOMAIN-MODEL.md`, `metadataCache` fires no `changed` on
		// rename, and a project rename doesn't change its `color` — the
		// dot's hashed-fallback color (if any) simply follows the new name
		// on the next render that happens to touch this view anyway.
		this.registerEvent(
			this.deps.app.metadataCache.on("changed", (file) => {
				if (this.lastProjectPaths.has(file.path)) {
					this.onDataUpdated();
				}
			}),
		);
	}

	/**
	 * Replaces Bases' own "New" note flow (the toolbar `+ New` button, and
	 * anything else that calls this hook) with the full create-task modal.
	 * Bases' default implementation infers frontmatter from the base's own
	 * filters via `frontmatterProcessor` — for `Tasks.base` that can only
	 * ever produce `type: task` (every status filter it reads is a `!=`,
	 * which Bases does not use for inference), never a usable `status`. The
	 * modal is a strictly better "new task" experience than that inferred
	 * note, so `frontmatterProcessor` is accepted (to match the base class's
	 * signature) but intentionally never called. `baseFileName`, when given,
	 * seeds the modal's title field.
	 */
	override async createFileForView(baseFileName?: string, _frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		new CreateTaskModal(this.deps.app, {
			app: this.deps.app,
			createTask: this.deps.createTask,
			getStatuses: this.deps.getStatuses,
			getDefaultFolder: this.deps.getTaskFolder,
			...(baseFileName !== undefined ? { initial: { title: baseFileName } } : {}),
		}).open();
	}

	/**
	 * Undocumented Bases hook: entries returned here are appended to the
	 * results-count dropdown next to "Copy"/"Export CSV" (verified in the
	 * Obsidian 1.13.7 bundle; not declared in `obsidian.d.ts`, so this is a
	 * plain method rather than `override`). Offers the same create-task flow
	 * as `createFileForView` as an explicit, discoverable action.
	 */
	getViewActions(): readonly BasesViewAction[] {
		return [{ name: "New task", icon: "plus", callback: () => void this.createFileForView() }];
	}

	/**
	 * Bases reuses the same `containerEl` when the user switches a base
	 * between view types, so everything this view put on the container —
	 * class, grid CSS variable — must come off on unload or the next view
	 * inherits the feed's grid layout.
	 */
	override onunload(): void {
		// The container outlives this view, so the animated list and its
		// resize observer must not.
		this.animation.disable();
		this.rendered.clear();
		this.listEl.remove();
		this.viewContainerEl.removeClass(cssClass("feed"), cssClass("feed--no-meta"), cssClass("feed--compact"));
		this.viewContainerEl.style.removeProperty("--obtask-feed-meta-columns");
		super.onunload();
	}

	override onDataUpdated(): void {
		const keys = this.deps.getPropertyKeys();
		const statuses = this.deps.getStatuses();
		const today = fromJsDate(new Date());
		const firstDay = this.deps.getWeekStart();
		const options = parseFeedViewOptions(this.config);
		const columns = feedRowColumns(this.config.getOrder(), keys);
		// Rebuilt below as rows render (`renderDot`) — see the field's doc
		// comment for why this can't just be computed once up front.
		this.lastProjectPaths = new Set<string>();
		this.viewContainerEl.setCssProps({ "--obtask-feed-meta-columns": String(columns.length) });
		this.viewContainerEl.toggleClass(cssClass("feed--no-meta"), columns.length === 0);
		this.applyCompact();

		const used = new Set<string>();
		let cursor: Element | null = this.listEl.firstElementChild;

		// `createEl`/`createDiv` below are Obsidian's DETACHED global helpers
		// (same pattern as `createSpan` in
		// `event-calendar-renderer.ts`'s `allDayContentOption`), so a new
		// node costs exactly one insertion mutation — the `insertBefore`
		// here — never a reparent. Keys are unique by construction (a path
		// appears once per query result), but a collision must degrade to a
		// duplicate element, never fuse two rows onto one reused node —
		// suffix defensively.
		const mount = (rawKey: string, create: () => HTMLElement): RenderedItem => {
			let key = rawKey;
			for (let n = 2; used.has(key); n += 1) {
				key = `${rawKey}#${String(n)}`;
			}
			used.add(key);
			let item = this.rendered.get(key);
			if (item === undefined) {
				item = { el: create(), comp: undefined };
				this.rendered.set(key, item);
			}
			// An in-place child advances the cursor with zero DOM mutations,
			// so an unchanged feed produces none at all; only a moved or new
			// child reaches `insertBefore`.
			if (item.el === cursor) {
				cursor = cursor.nextElementSibling;
			} else {
				this.listEl.insertBefore(item.el, cursor);
			}
			return item;
		};

		const mountText = (key: string, tag: "h3" | "h4" | "div", cls: string, text: string): void => {
			const item = mount(key, () => createEl(tag, { cls }));
			if (item.el.textContent !== text) {
				item.el.setText(text);
			}
		};

		for (const group of this.data.groupedData) {
			const groupLabel = group.hasKey() && group.key !== undefined ? group.key.toString() : undefined;
			const groupKey = groupLabel ?? "";
			if (groupLabel !== undefined) {
				mountText(`g:${groupKey}`, "h3", cssClass("feed__group"), groupLabel);
			}

			const { tasks, invalid } = tasksFromBasesEntries(this.deps.app, group.entries, keys, statuses);
			const entryByPath = new Map(tasks.map((row) => [row.task.path, row.entry] as const));
			const buckets = groupIntoBuckets(
				tasks.map((row) => row.task),
				{
					today,
					firstDay,
					source: options.dateSource,
					statuses,
					completedAtBottom: options.completedAtBottom,
					order: this.config.getSort().length === 0 ? "smart" : "preserve",
				},
			);

			for (const bucket of visibleBuckets(buckets, invalid.length, options.showEmptyBuckets)) {
				mountText(`b:${groupKey}:${bucket}`, "h4", cssClass("feed__bucket"), BUCKET_LABELS[bucket]);

				if (bucket === "errors") {
					if (invalid.length === 0) {
						mountText(`e:${groupKey}:${bucket}`, "div", cssClass("feed__bucket-empty"), "No tasks");
						continue;
					}
					for (const entry of invalid) {
						const item = mount(`i:${entry.path}`, () =>
							createDiv({ cls: [cssClass("feed__row"), cssClass("feed__row--invalid")] }),
						);
						item.el.empty();
						item.el.createSpan({ text: entry.path, cls: cssClass("feed__title") });
						item.el.createSpan({ text: entry.errors.map((e) => describeTaskParseError(e)).join(", "), cls: cssClass("feed__error") });
					}
					continue;
				}

				const bucketTasks = buckets.get(bucket) ?? [];
				if (bucketTasks.length === 0) {
					mountText(`e:${groupKey}:${bucket}`, "div", cssClass("feed__bucket-empty"), "No tasks");
					continue;
				}

				for (const task of bucketTasks) {
					const entry = entryByPath.get(task.path);
					if (entry === undefined) {
						// Invariant: `entryByPath` was built from the exact same
						// `tasks` list `groupIntoBuckets` bucketed, keyed by each
						// task's own path — every bucketed task's entry is in
						// there. Guards the lookup instead of asserting past it.
						continue;
					}
					this.fillRow(mount(`r:${task.path}`, () => createDiv({ cls: cssClass("feed__row") })), { task, entry }, statuses, options.dateSource, columns);
				}
			}
		}

		// Removal is what autoAnimate turns into the exit animation;
		// deleting from `this.rendered` mid-iteration is fine in JS (the
		// iterator already captured the entries live at loop start).
		for (const [key, item] of this.rendered) {
			if (!used.has(key)) {
				if (item.comp !== undefined) {
					this.removeChild(item.comp);
				}
				item.el.remove();
				this.rendered.delete(key);
			}
		}

		if (!this.animatedOnce) {
			this.animatedOnce = true;
			// Enable only once this first render's mutations have been
			// consumed: the MutationObserver callback is a microtask, and a
			// requestAnimationFrame callback runs after microtasks drain, so
			// the observer sees the initial population while still disabled.
			// The registered cancel keeps a view unloaded before the frame
			// fires from re-enabling animation on a removed list.
			const raf = window.requestAnimationFrame(() => {
				this.animation.enable();
			});
			this.register(() => {
				window.cancelAnimationFrame(raf);
			});
		}
	}

	/**
	 * Rebuilds one row's contents from scratch (cheap, and identical to the
	 * old full-render cost per row) — only `item.el`'s identity is stable
	 * across renders, which is all the list-level reconciliation/animation
	 * needs. Listeners land on this row's own `comp`, freed on the next
	 * refill of this same row or on its removal (`onDataUpdated`'s sweep).
	 */
	private fillRow(item: RenderedItem, row: TaskWithEntry, statuses: readonly StatusConfig[], dateSource: DateSource, columns: readonly FeedColumn[]): void {
		if (item.comp !== undefined) {
			this.removeChild(item.comp);
		}
		const comp = this.addChild(new Component());
		item.comp = comp;
		const rowEl = item.el;
		rowEl.empty();

		const { task, entry } = row;

		this.renderDot(rowEl, task);
		this.renderStatusControl(comp, rowEl, task, statuses);

		const link = rowEl.createEl("a", {
			text: task.title,
			cls: ["internal-link", cssClass("feed__title")],
			href: task.path,
		});
		comp.registerDomEvent(link, "click", (evt) => {
			evt.preventDefault();
			void this.deps.app.workspace.openLinkText(task.path, "", false);
		});

		// `display: contents` in wide mode (`styles/obtask.css`), so its
		// children stay direct subgrid items of `.obtask-feed__row` and
		// nothing about the wide layout changes — it exists purely so
		// compact mode has a single element to turn into the wrapped
		// second line (`.obtask-feed--compact .obtask-feed__meta`).
		const metaEl = rowEl.createDiv({ cls: cssClass("feed__meta") });

		for (const column of columns) {
			switch (column.kind) {
				case "date":
					this.renderDateChip(comp, metaEl, task, dateSource);
					break;
				case "priority":
					this.renderPriorityControl(comp, metaEl, task);
					break;
				case "project":
					this.renderProjectLink(comp, metaEl, task);
					break;
				case "tags":
					this.renderTags(metaEl, task);
					break;
				case "generic":
					this.renderGenericChip(metaEl, entry, column.propertyId);
					break;
				default: {
					const exhaustive: never = column;
					return exhaustive;
				}
			}
		}

		this.registerRowContextMenu(comp, rowEl, task, statuses);
	}

	/**
	 * Toggles `obtask-feed--compact` (`styles/obtask.css`) off the pane's own
	 * `clientWidth` — see `domain/feed-view-options.ts`'s `COMPACT_FEED_WIDTH`
	 * doc comment. `clientWidth` is `0` before the container has ever been
	 * laid out (e.g. a view created in a background/hidden tab), treated as
	 * "not compact" rather than the false positive an unmeasured `0 <
	 * COMPACT_FEED_WIDTH` would give. Mirrors `CalendarBasesView#isCompact`.
	 */
	private applyCompact(): void {
		const width = this.viewContainerEl.clientWidth;
		const compact = width > 0 && width < COMPACT_FEED_WIDTH;
		this.viewContainerEl.toggleClass(cssClass("feed--compact"), compact);
	}

	/**
	 * Undocumented-but-real Bases hook: called when the leaf's own size
	 * changes — a pane resize, a split being dragged, the workspace layout
	 * changing — without a corresponding `onDataUpdated`. See
	 * `CalendarBasesView#onResize`'s doc comment for the full rationale
	 * (same hook, not declared on `BasesView` in `obsidian.d.ts`, so this
	 * stays a plain method rather than `override`). Without it the feed
	 * would keep showing wide-mode columns (or vice versa) after a pane
	 * resize until the next vault-driven `onDataUpdated`.
	 */
	onResize(): void {
		this.applyCompact();
	}

	/**
	 * Date chip: the field the configured date source resolved to
	 * (`due`/`scheduled`), plus its value — see `domain/feed-row.ts#feedRowAnchor`.
	 * A button-like span (same click/Enter/Space pattern as the status
	 * control) that opens `DateModal` pre-filled with the row's anchor
	 * field/value, dispatching `setDate` on save. When the task has no
	 * anchor date yet, renders a muted "Set date" chip that still opens the
	 * modal, targeting `feedRowDefaultDateField(dateSource)`.
	 */
	private renderDateChip(comp: Component, parent: HTMLElement, task: Task, dateSource: DateSource): void {
		const anchor = feedRowAnchor(task, dateSource);
		const field = anchor.some ? anchor.value.field : feedRowDefaultDateField(dateSource);
		const initial: Option<TaskDate> = anchor.some ? some(anchor.value.value) : none();

		const chip = parent.createSpan({
			cls: [cssClass("feed__date"), "clickable-icon"],
			attr: { role: "button", tabindex: "0" },
		});
		chip.setText(anchor.some ? `${DATE_FIELD_LABELS[anchor.value.field]}: ${anchor.value.value}` : "Set date");
		if (!anchor.some) {
			chip.addClass(cssClass("feed__date--empty"));
		}

		const openModal = (): void => {
			new DateModal(this.deps.app, {
				title: field === "due" ? "Set due date" : "Set scheduled date",
				initial,
				onSave: (value) => {
					void this.setDate(task.path, field, value);
				},
			}).open();
		};

		comp.registerDomEvent(chip, "click", openModal);
		comp.registerDomEvent(chip, "keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				openModal();
			}
		});
	}

	/**
	 * Priority control: Apple Reminders-style — `normal` renders nothing at
	 * all (no chip, no click target; a `normal` task's priority is still
	 * reachable via the row's context menu or the task panel), `high`/
	 * `urgent` render a small `!`/`!!` mark (`domain/task.ts#priorityMarks`)
	 * coloured by one `obtask-priority-<value>` class per
	 * `domain/task.ts#priorityChipClass` (`styles/obtask.css`). Same
	 * clickable-icon/button-like pattern as the status control — opens
	 * `buildPriorityMenu` on click/Enter/Space and dispatches to
	 * `setPriority`.
	 */
	private renderPriorityControl(comp: Component, parent: HTMLElement, task: Task): void {
		if (task.priority === "normal") {
			// Still emits an (empty, inert) grid cell: in wide mode the meta
			// chips are direct subgrid items of the row (`.obtask-feed__meta`
			// is `display: contents`), so skipping the element entirely would
			// shift this row's later columns (project, tags) one track left
			// relative to rows that do render a mark.
			parent.createSpan({ cls: [cssClass("feed__priority"), cssClass("feed__priority--empty")] });
			return;
		}

		const control = parent.createSpan({
			cls: [cssClass("feed__priority"), cssClass(priorityChipClass(task.priority)), "clickable-icon"],
			attr: { role: "button", tabindex: "0" },
			text: priorityMarks(task.priority),
		});

		const openMenu = (evt: MouseEvent | KeyboardEvent): void => {
			const menu = newMenu();
			buildPriorityMenu(menu, task.priority, (priority) => {
				void this.setPriority(task.path, priority);
			});
			if (evt instanceof MouseEvent) {
				menu.showAtMouseEvent(evt);
			} else {
				const rect = control.getBoundingClientRect();
				menu.showAtPosition({ x: rect.left, y: rect.bottom });
			}
		};

		comp.registerDomEvent(control, "click", openMenu);
		comp.registerDomEvent(control, "keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				openMenu(evt);
			}
		});
	}

	/**
	 * Internal link to the project note, if `task.project` resolves to an
	 * existing file — same open pattern as the title link. Unresolved
	 * projects render as plain text (no dead-link click). Always appends
	 * exactly one top-level element (an empty placeholder span when there is
	 * no project) so the grid's project column stays aligned across rows.
	 */
	private renderProjectLink(comp: Component, parent: HTMLElement, task: Task): void {
		const project = task.project;
		if (project === undefined) {
			parent.createSpan({ cls: [cssClass("feed__project"), cssClass("feed__project--empty")] });
			return;
		}

		const dest = this.deps.app.metadataCache.getFirstLinkpathDest(project, task.path);
		if (dest === null) {
			parent.createSpan({ text: project, cls: cssClass("feed__project") });
			return;
		}

		const link = parent.createEl("a", {
			text: project,
			cls: ["internal-link", cssClass("feed__project")],
			href: project,
		});
		comp.registerDomEvent(link, "click", (evt) => {
			evt.preventDefault();
			void this.deps.app.workspace.openLinkText(project, task.path, false);
		});
		comp.registerDomEvent(link, "contextmenu", (evt) => {
			// Own handler, not the row's `buildTaskEditMenu` one
			// (`registerRowContextMenu`) — stopped from bubbling so the two
			// menus never both open for one right-click.
			evt.preventDefault();
			evt.stopPropagation();
			const menu = newMenu();
			menu.addItem((item) =>
				item
					.setTitle("Set project color")
					.setIcon("palette")
					.onClick(() => {
						new ProjectColorModal(this.deps.app, dest).open();
					}),
			);
			menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
		});
	}

	/**
	 * Always appends exactly one top-level element (an empty placeholder
	 * span when there are no tags) so the grid's tags column stays aligned
	 * across rows.
	 */
	private renderTags(parent: HTMLElement, task: Task): void {
		if (task.tags.length === 0) {
			parent.createSpan({ cls: [cssClass("feed__tags"), cssClass("feed__tags--empty")] });
			return;
		}
		const container = parent.createSpan({ cls: cssClass("feed__tags") });
		for (const tag of task.tags) {
			container.createSpan({ text: `#${tag}`, cls: cssClass("feed__tag") });
		}
	}

	/**
	 * Muted label/value chip for a Bases toolbar "Properties" entry that
	 * isn't one of the feed's first-class columns (`domain/feed-row.ts`'s
	 * `generic` column) — anything from `note.*`, `file.*`, or `formula.*`
	 * the plugin doesn't otherwise render. Reads `entry.getValue()`
	 * display-only (never as a parse source, per `bases-entries.ts`'s doc
	 * comment) and shows `Value.toString()`. `Value.renderTo` was tried and
	 * rejected (2026-08-30): it draws Bases' *table-cell editors* (a boxed,
	 * segmented date input for `file.mtime`, for instance), which is a form
	 * control, not a chip. Renders nothing when the property is absent
	 * (`getValue` returns `null` or Bases' `NullValue`) or prints as empty
	 * text — deliberately not `isTruthy()`, which would also hide a
	 * meaningful `false` or `0`. Always appends exactly one top-level element
	 * (an empty placeholder span when there is no value to show) so the
	 * grid's generic column stays aligned across rows.
	 */
	private renderGenericChip(parent: HTMLElement, entry: BasesEntry, propertyId: string): void {
		const value = entry.getValue(propertyId as BasesPropertyId);
		// `NullValue.toString()` is the literal "null", so it has to be
		// recognised by type, not by its text.
		if (value === null || value instanceof NullValue) {
			parent.createSpan({ cls: [cssClass("feed__generic"), cssClass("feed__generic--empty")] });
			return;
		}
		const text = value.toString().trim();
		if (text === "") {
			parent.createSpan({ cls: [cssClass("feed__generic"), cssClass("feed__generic--empty")] });
			return;
		}

		const chip = parent.createSpan({ cls: cssClass("feed__generic") });
		chip.createSpan({ text: this.config.getDisplayName(propertyId as BasesPropertyId), cls: cssClass("feed__generic-label") });
		chip.createSpan({ text, cls: cssClass("feed__generic-value") });
	}

	/**
	 * Leading dot: the very first element of every row (including
	 * project-less ones, which render a plain neutral dot rather than
	 * skipping it) so every row's other columns line up regardless of
	 * whether a given task has a project. Color comes from the task's
	 * project (`domain/project-color.ts#resolveDotColor`); a project-less
	 * task skips the metadata-cache lookup entirely rather than resolving
	 * against `undefined`. Also the one place `lastProjectPaths` — this
	 * render's set of project notes a re-render must watch for a `color`
	 * edit on — gets populated.
	 */
	private renderDot(row: HTMLElement, task: Task): void {
		const project = task.project;
		const rawColor = project === undefined ? undefined : projectRawColor(this.deps.app, project, task.path);
		const dotColor = resolveDotColor(rawColor, project);
		if (project !== undefined) {
			const projectPath = projectFilePath(this.deps.app, project, task.path);
			if (projectPath !== undefined) {
				this.lastProjectPaths.add(projectPath);
			}
		}
		const dotEl = row.createSpan({ cls: [cssClass("feed__dot"), ...dotColorClasses(dotColor)] });
		// A hex color has no static class (`dotColorClasses`'s doc comment) —
		// applied directly as a scoped custom property via Obsidian's own
		// `setCssProps` instead, same as the calendar's `eventDidMount`
		// (`event-calendar-renderer.ts`) does for its own `.ec-event` root.
		if (dotColor.kind === "hex") {
			dotEl.setCssProps({ "--obtask-dot-color": dotColor.value });
		}
	}

	/** Button-like span (icon + label) that opens the status `Menu` on click/Enter/Space and dispatches to `setStatus`. */
	private renderStatusControl(comp: Component, row: HTMLElement, task: Task, statuses: readonly StatusConfig[]): void {
		const statusOption = findStatus(statuses, task.status);
		const control = row.createSpan({
			cls: [cssClass("feed__status"), "clickable-icon"],
			attr: { role: "button", tabindex: "0" },
		});

		setIcon(control.createSpan({ cls: cssClass("feed__status-icon") }), statusOption.some ? statusIcon(statusOption.value) : "circle");
		control.createSpan({
			text: statusOption.some ? statusOption.value.label : task.status,
			cls: cssClass("feed__status-label"),
		});

		const openMenu = (evt: MouseEvent | KeyboardEvent): void => {
			const menu = newMenu();
			buildStatusMenu(menu, statuses, task.status, (status) => {
				void this.setStatus(task.path, status.id);
			});
			if (evt instanceof MouseEvent) {
				menu.showAtMouseEvent(evt);
			} else {
				const rect = control.getBoundingClientRect();
				menu.showAtPosition({ x: rect.left, y: rect.bottom });
			}
		};

		comp.registerDomEvent(control, "click", openMenu);
		comp.registerDomEvent(control, "keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				openMenu(evt);
			}
		});
	}

	/**
	 * Opens `buildTaskEditMenu` (every editable property, `ui/task-edit-menu.ts`)
	 * at the pointer on right-click, and on a ~500ms touch-and-hold for
	 * mobile — Obsidian exposes no built-in long-press helper, so this times
	 * `touchstart`..`touchend`/`touchmove`/`touchcancel` itself via
	 * `window.setTimeout`, cleared on any of those or (as a safety net) when
	 * this row's `comp` unloads.
	 */
	private registerRowContextMenu(comp: Component, row: HTMLElement, task: Task, statuses: readonly StatusConfig[]): void {
		const openEditMenu = (position: { readonly clientX: number; readonly clientY: number }): void => {
			const menu = newMenu();
			buildTaskEditMenu(menu, task, {
				app: this.deps.app,
				statuses,
				setStatus: this.deps.setStatus,
				setPriority: this.deps.setPriority,
				setDate: this.deps.setDate,
				setDuration: this.deps.setDuration,
				setRecurrence: this.deps.setRecurrence,
				setProject: this.deps.setProject,
				setTags: this.deps.setTags,
				notifier: this.deps.notifier,
			});
			menu.showAtPosition({ x: position.clientX, y: position.clientY });
		};

		// Android WebView fires both our touch-and-hold timer below AND a
		// native `contextmenu` event for the same long-press, which would
		// otherwise open the menu twice. `suppressNextContextMenu` lets the
		// timer claim the gesture so the following `contextmenu` event is
		// swallowed (still `preventDefault()`ed, so no native menu appears
		// on top) exactly once. Desktop right-click never sets the flag, so
		// its `contextmenu` event always opens the menu as before.
		let suppressNextContextMenu = false;

		comp.registerDomEvent(row, "contextmenu", (evt) => {
			evt.preventDefault();
			if (suppressNextContextMenu) {
				suppressNextContextMenu = false;
				return;
			}
			openEditMenu(evt);
		});

		let longPressTimer: number | undefined;
		const clearLongPress = (): void => {
			if (longPressTimer !== undefined) {
				window.clearTimeout(longPressTimer);
				longPressTimer = undefined;
			}
		};

		comp.registerDomEvent(row, "touchstart", (evt) => {
			const touch = evt.touches[0];
			if (touch === undefined) {
				return;
			}
			const { clientX, clientY } = touch;
			clearLongPress();
			longPressTimer = window.setTimeout(() => {
				suppressNextContextMenu = true;
				openEditMenu({ clientX, clientY });
			}, 500);
		});
		comp.registerDomEvent(row, "touchend", clearLongPress);
		comp.registerDomEvent(row, "touchmove", clearLongPress);
		comp.registerDomEvent(row, "touchcancel", clearLongPress);
		comp.register(clearLongPress);
	}

	private async setStatus(path: TaskPath, statusId: StatusId): Promise<void> {
		const result = await this.deps.setStatus(path, statusId);
		if (!result.ok) {
			this.deps.notifier.error(describeAppError(result.error));
		}
	}

	private async setPriority(path: TaskPath, priority: Priority): Promise<void> {
		const result = await this.deps.setPriority(path, priority);
		if (!result.ok) {
			this.deps.notifier.error(describeAppError(result.error));
		}
	}

	private async setDate(path: TaskPath, field: DateField, value: Option<TaskDate>): Promise<void> {
		const result = await this.deps.setDate(path, field, value);
		if (!result.ok) {
			this.deps.notifier.error(describeAppError(result.error));
		}
	}
}
