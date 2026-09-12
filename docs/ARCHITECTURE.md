# Architecture

This design was decided on 2026-08-29. Isotask is hexagonal (ports and adapters) with a
functional core / imperative shell split. There is no framework and no Effect — the core is
plain TypeScript functions over immutable data.

## Layers

```
src/
  domain/      pure. Types, frontmatter parse/serialise, statuses, buckets, recurrence,
               transitions, settings (type + defaults + `parseSettings`). No `obsidian` import.
               100% unit-tested with vitest.
  ports/       interfaces the core needs: Clock, TaskStore, Notifier, CalendarRenderer,
               PathResolver.
  app/         use-cases, each a `make*(deps: AppDeps) => (...) => Promise<Result<...>>` factory
               over `deps.ts`'s ports: `createTask`, `setStatus` (incl. complete -> spawn),
               `toggleDone`, `convertNote`, `setDate`, `setDuration`, `setRecurrence`, plus the
               pure `generateBase#renderTasksBase`. `errors.ts` holds the shared `AppError` union
               and `describeAppError`/`describeRecurrenceError`. Pure orchestration over ports;
               unit-tested with in-memory fakes (`app/test/fakes.ts`).
  adapters/
    obsidian/  TaskStore over Vault + MetadataCache + fileManager.processFrontMatter; Clock;
               Notifier (Notice); settings persistence (loadData/saveData; re-exports
               `domain/settings.ts`'s type/defaults/`parseSettings`, which do the actual
               valibot validation — see the note below).
    calendar/event-calendar/  CalendarRenderer implementation. Only file tree allowed to import
               `@event-calendar/*`.
  views/bases/feed/, views/bases/calendar/   BasesView subclasses: thin, map entries -> domain,
               call renderers, dispatch actions to app use-cases.
  views/task-panel/   plain workspace `ItemView` (not Bases): follows the active markdown note and
               renders its task fields as a form — dropdowns for the enums, the shared modals for
               the rest — dispatching the same app use-cases.
  ui/          small DOM renderers + modals: `CreateTaskModal`, `DateModal`, `RecurrenceModal`,
               `status-menu.ts#addDoneMenuItem` (a single done/reopen toggle — no status picker,
               see ADR 0017). createEl only; no innerHTML.
  commands/    `register-commands.ts#registerCommands`: wires every command to an `app` use-case;
               note-scoped commands use `checkCallback` + the active file's frontmatter to hide
               themselves off a non-task note.
  settings/    SettingsTab (Setting API), settings type + defaults + migration.
  styles/      isotask.css, calendar.css (theme-variable mappings only).
  main.ts      composition root.
```

**`IsotaskSettings` lives in `src/domain/settings.ts`**, not `src/adapters/obsidian/settings.ts`: it's
pure valibot validation with no Obsidian dependency, so the domain layer owns it (`app` may not
import `adapters`, and `AppDeps.settings()` needs the type). `src/adapters/obsidian/settings.ts`
re-exports it unchanged so existing `@/adapters/obsidian/settings` imports keep working.

Dependency direction is strictly inward: `views`/`ui`/`settings`/`adapters` depend on `app`,
which depends on `ports` and `domain`. `domain` and `ports` depend on nothing in this repo.
`app` never imports an adapter directly — it receives ports through its function/use-case
arguments, wired up in `main.ts`.

## Data flow: Bases feed view render path

```
Bases (.base file)                     isotask-feed BasesView
┌─────────────────────┐   entries      ┌──────────────────────────────┐
│ filters/sort/group   ├───────────────▶ for each entry:              │
│ (owned by Bases)     │                │   entry.file                │
└─────────────────────┘                │       │                     │
                                        │       ▼                     │
                             metadataCache.getFileCache(file)         │
                                        │       │ .frontmatter        │
                                        │       ▼                     │
                                domain/frontmatter.ts (parse)         │
                                        │       │                     │
                                        │       ▼ Result<Task, Error[]>│
                                        │  domain/buckets.ts           │
                                        │  (Overdue/Today/.../No date)│
                                        │       │                     │
                                        │       ▼                     │
                                ui renderer (createEl rows)           │
                                        └──────────────────────────────┘
```

The domain parser (`domain/frontmatter.ts`) is the single source of truth for turning raw
frontmatter into a `Task`; it is independent of Bases' own value objects. A note that fails to
parse renders as an "invalid task" row with the reason and is excluded from buckets, but the view
never hides it outright — Bases decides visibility via its filters.

**Why `metadataCache.getFileCache`, not `BasesEntry` values.** `BasesEntry`'s only public accessor
(`getValue(propertyId): Value | null`, `obsidian.d.ts`) returns a `Value` wrapper whose only public
methods are `toString()`/`isTruthy()` — there is no typed accessor that round-trips a property back
to the plain string/number/boolean/array shapes `parseTask` expects, so `bases-entries.ts` reads the
file's own indexed frontmatter instead. That source can (rarely) be stale on the very first render
right after a vault loads — a file Bases already produced an entry for hasn't finished being
indexed into `metadataCache` yet. Both `FeedBasesView` and `CalendarBasesView` register
`app.metadataCache.on("resolved", ...)` in their constructor (`registerEvent`, torn down with the
view) to re-run `onDataUpdated()` once indexing settles, self-healing that race regardless of
whatever re-query Bases performs on its own.

`tasksFromBasesEntries` returns `{ tasks: TaskWithEntry[], invalid: InvalidTaskEntry[] }`, where
each `TaskWithEntry` is `{ task: Task; entry: BasesEntry }` — the source `BasesEntry` travels
alongside its parsed `Task` rather than being discarded. The calendar view only ever needs
`.task` (events are derived from `Task` fields alone); the feed view keeps both, since a row also
renders whichever extra Bases toolbar "Properties" this plugin doesn't model as first-class `Task`
fields (`domain/feed-row.ts#feedRowColumns`'s `generic` column), read display-only off the entry
via `BasesEntry.getValue()`/`Value.toString()` — never as a second parse source.

### Bases view options and re-rendering

A `BasesViewRegistration` (passed to `plugin.registerBasesView`, see `views/bases/register.ts`)
can declare `options: (config) => BasesAllOptions[]` — dropdown/toggle entries Bases renders in
its own native view-options panel (not a plugin `SettingsTab`; the feed's three options —
`dateSource`, `showEmptyBuckets`, `completedAtBottom` — are per-`.base`-view config, read back out
via `BasesViewConfig.get(key)` inside `onDataUpdated()`, parsed by
`domain/feed-view-options.ts#parseFeedViewOptions`).

**Finding (verified empirically in `e2e/specs/views.e2e.ts`'s "Feed view options" probe, per the
"live DOM probe recipe" in `docs/CONVENTIONS.md`): editing a view option re-renders the view with
no extra plumbing on isotask's side.** `BasesViewConfig.set(key, value)` alone — with no manual
`onDataUpdated()` call — is enough; Bases owns config reactivity and calls back into the view
itself once the config changes. `FeedBasesView` needed no `onConfigChanged`-style hook (there
isn't one in the public `BasesView` API — the abstract class exposes only `onDataUpdated()`); it
already only reads options at the top of `onDataUpdated()`, so the existing single entry point
covers option changes too. The probe found this by inspecting the runtime "bases" leaf's
prototype chain (`leaf.view.controller.view` is the actual registered `BasesView` instance) and
calling `config.set()` on it directly, rather than driving Bases' own options-panel DOM.

## Data flow: Bases calendar view render path

```
Bases (.base file)                     isotask-calendar BasesView
┌─────────────────────┐   entries      ┌──────────────────────────────────┐
│ filters/sort/group   ├───────────────▶ for each group, for each entry:   │
│ (owned by Bases)     │                │   entry.file                    │
└─────────────────────┘                │       │                         │
                                        │       ▼                         │
                             metadataCache.getFileCache(file)             │
                                        │       │ .frontmatter            │
                                        │       ▼                         │
                                domain/frontmatter.ts (parse)             │
                                        │       │ Result<Task, Error[]>   │
                                        │       ▼                         │
                              domain/calendar-events.ts#eventsForTask     │
                              (up to 2 events/task: due, scheduled)       │
                                        │       │                         │
                                        │       ▼                         │
                              ports.CalendarRenderer.mount(...) — once —  │
                              then CalendarHandle.setEvents/setView/      │
                              setFirstDay on every later onDataUpdated    │
                                        └──────────────────────────────────┘
```

**Compact hourly time grid**: `EventCalendarRenderer` sets `slotDuration: "01:00:00"` and
`slotHeight: 32` (with `height: "auto"`), so the week/day time grid renders one 32px row per hour
(a full day ≈770px instead of the vendored default's ≈1150px) while `calendar.css`'s smaller
event font, tighter padding, and an `!important` `min-height`/`min-block-size` floor (needed to
beat Event Calendar's own inline sizing) keep a 30-minute block's title fully readable.

**Outer Bases groups are ignored**: `groupedData`'s groups make sense for the feed (a heading per
group) but not for a single continuous timeline, so `eventsForTask` is called across every group's
entries and every task's events land on the same calendar — there is no per-group calendar
section.

**Mount happens once, not on every render.** The first `onDataUpdated` creates the `.isotask-calendar`
root and calls `CalendarRenderer.mount(...)`; every subsequent `onDataUpdated` (a real data change,
or a view-option change via `config.set()` — same reactivity finding as the feed, above) instead
calls the already-mounted `CalendarHandle`'s `setEvents`/`setView`/`setFirstDay`. Destroying and
recreating the widget on every update would reset Event Calendar's internal navigation state
(whatever month/week/day the user had navigated to) back to today — the handle exists precisely so
a view-option or data change doesn't do that. The handle is torn down once, in the view's
`onunload()` (`BasesView` extends `Component`, so this is the same `Component` lifecycle hook every
other view/registration in this codebase relies on — see `docs/CONVENTIONS.md`).

An entry that fails to parse is not rendered as a calendar event (a calendar has no per-row slot to
show an "invalid task" the way a feed row can); the view instead shows a small muted count line
above the calendar root when at least one entry in view is invalid.

`firstDay: "default"` (the option's own default — see `domain/calendar-view-options.ts`) resolves
to `getWeekStart()` at render time, not at option-registration time, so it always tracks the
current plugin setting for a view that has never had `firstDay` explicitly overridden.

**Narrow-pane compaction (dot-grid month, rolling 3-day week).** Below `COMPACT_CALENDAR_WIDTH`
(640px, `domain/calendar-view-options.ts`), a 7-column week/month grid has no room for a legible
event CHIP — at a 390px phone viewport a month cell is ~53px wide, just enough for a small dot and
no readable title. This is a **pane-width** fact, not `is-mobile`: `CalendarBasesView` measures its
own `viewContainerEl.clientWidth` (re-evaluated on every `onDataUpdated` and on Obsidian's
undocumented-but-real `BasesView.onResize()` hook, confirmed to fire — repeatedly — on a real leaf
resize) against the threshold, so a narrow *split pane* on desktop gets the same treatment as a
phone, and a full-width pane on a phone in landscape doesn't. The `applied` record already tracked
for view/firstDay change-detection also tracks `compact` for the same reason: `onResize` fires far
more often than the derived boolean actually flips.

There is no `effectiveCalendarView`/view-remap function any more: `computeEffective()` pushes the
Bases-configured `initialView` straight through to `CalendarHandle.setView`/the initial `mount()`
call, compact or not. Month used to collapse into the renderer's rolling 3-day view below the
threshold (too narrow for a 7-column CHIP grid); it no longer does, because compact month doesn't
need 7 columns of chips any more — `styles/calendar.css`'s `.isotask-calendar--compact .ec-day-grid`
rules render every event as a small dot instead (the title stays in the DOM, clipped to 1px, so
assistive tech still gets it; only the existing project-coloured `::before` dot (ADR 0015) — already drawn for
the wide-pane "dot + title" chip — stays visible), and `pointer-events: none` on every event lets a
tap anywhere in the cell, dot included, reach the day cell's own click handler. `week` still becomes
a rolling 3-day window when compact (`"3 days"` in the header, replacing "Week") — that part is
unchanged, driven entirely inside the renderer (see `EventCalendarRenderer#setCompact` below), never
by a `CalendarViewKind` remap. Since Bases' own view-option dropdown listing "Month" now renders the
same thing at every pane width, choosing it is no longer the wart it used to be.

A busy month cell is capped, not left to grow the whole week row: `EventCalendarRenderer#buildOptions`
sets `dayMaxEvents: true` only when compact, which is Event Calendar's own per-day "does this one
still fit" hide (`day-grid/Event.svelte`'s `hide()`, measuring each day cell's own available height)
— no per-day counting logic lives in this codebase; every task still renders its own `.ec-event`
element; the library decides which ones still fit. `calendar.css` pins the day-grid's row height to
a small fixed px value (rather than Event Calendar's own height-filling `minmax(0, 1fr)` default for
`dayMaxEvents`, which would let far more than a handful of tiny dots through on a tall phone) so the
visible cap stays a small, predictable number — around four, by the geometry documented at that CSS
rule — regardless of pane height. The library's own "+N more" overflow link is hidden entirely
(`.ec-day-foot`): compact month has no popover UI, only the tap-to-Day-view navigation below.

`views/bases/calendar/calendar-view.ts#onSlotClick` is what that tap drives: compact month is
**read-and-navigate only**, so a tap there calls `handle.goTo(toDateOnly(date))` then
`handle.setView("day")` instead of opening the create-task modal — creating a task from a narrow
pane goes through the Bases toolbar's "+ New", or by drilling into Day view and tapping a time slot.
Deciding "is compact month actually on screen right now" needs `CalendarHandle.getView()` (backed by
`calendar.getOption("view")` through `event-calendar-mapping.ts#fromEventCalendarView`, the total
reverse of `toEventCalendarView`, falling back to `DEFAULT_CALENDAR_VIEW_OPTIONS.initialView` for
anything it doesn't recognise), not the view this handle last pushed or the raw Bases config: the
user can switch views with Event Calendar's own header buttons, entirely outside this port, so a
stale cached view would make a tap in Day view wrongly navigate instead of creating.

`CalendarHandle.setCompact(compact)` is how the view pushes a compactness change to the renderer.
A live probe against the vendored `@event-calendar/core@5.12.0` (see the port's doc comment on
`setCompact`) found that neither `buttonText` nor a per-view `duration` override survives a bare
`calendar.setOption(...)` once the user next switches views — Event Calendar bakes a per-view
options snapshot at `createCalendar` construction time and silently re-applies it on every view
switch, and `setOption("views", ...)` itself is an even more direct no-op post-construction (the
`views` key is deleted from the library's live options during construction and never consulted
again). `EventCalendarRenderer#setCompact` therefore **destroys and recreates the whole widget**,
capturing `calendar.getOption("date")` beforehand and feeding it back into the new instance so the
user's navigated-to date survives the swap. The same probe found the resulting 3-day window is
**rolling** from whatever date is current, not snapped to `firstDay` (Event Calendar's own
`currentRange` derivation only snaps to `firstDay` for whole-week/month durations, never a plain
`{ days: 3 }` one) — confirmed by driving `next()`/`prev()` and reading `getView().currentStart`.

`styles/calendar.css`'s `isotask-calendar--compact` class is toggled by the SAME `clientWidth`
computation (never a CSS media query, which would key off the *viewport*, not the pane) so the
header's smaller typography/padding can't drift from the JS's own breakpoint.

## Data flow: complete-task path

```
user action (status Menu / command)
        │
        ▼
view action handler  ──calls──▶  app/setStatus.ts (use-case)
        │                              │
        │                              ├─ domain/transitions.ts: validate + compute new status,
        │                              │  set/clear `completed` per statuses table
        │                              │
        │                              ├─ ports.TaskStore.write(path, patch)
        │                              │      │
        │                              │      ▼
        │                              │  adapters/obsidian TaskStore
        │                              │      → app.fileManager.processFrontMatter(file, fn)
        │                              │
        │                              └─ if transition entered a `done`-kind status:
        │                                    domain/recurrence.ts computes next occurrence
        │                                    (rrule.after(anchor, inclusive=false))
        │                                       │
        │                                       ▼
        │                                 ports.TaskStore.create(draft)
        │                                       │
        │                                       ▼
        │                                 adapters/obsidian TaskStore
        │                                    → vault.create(path, body) or Notice if the
        │                                      spawned path already exists (idempotent)
        ▼
ports.Notifier.notify(...) on error / spawn result
```

## Data flow: calendar reschedule path

```
user drags/resizes an event (desktop) or long-presses + drags (touch)
        │
        ▼
CalendarRenderer adapter (event-calendar) fires its native drop/resize callback
        │  - event-calendar-mapping.ts#fromEventCalendarDrop: the widget's new
        │    position (JS Dates + allDay) back into domain start/end TaskDates
        ▼
isotask-calendar BasesView — callbacks.onEventMoved
        │
        ▼
app/reschedule-task.ts (use-case)
        │  - one FrontmatterPatch: the event's own date field, plus duration
        │    only when the gesture was a resize
        ▼
ports.TaskStore.updateProperties(path, patch)
        │
        ▼
adapters/obsidian TaskStore → app.fileManager.processFrontMatter(file, fn)
        │
        ▼
metadataCache change event fires → Bases re-queries → view re-renders with new data
```
Click on an empty calendar slot follows the same shape but calls `app/create-task.ts` instead
(via the create-task modal), pre-filled with the clicked date. Click on an existing event opens
its note instead — `dateClick` does not fire there, because the event's own `pointerdown` claims
the gesture before the day cell's handler sees it.

The use-case returns a `Result`, and `onEventMoved` reports it back to the adapter as a boolean so
a failed write can be reverted: a failed write leaves the vault unchanged, so no `metadataCache`
event fires and nothing would otherwise come along to move the event back off the slot the user
dropped it on.

Two rules of the mapping are worth stating because they are not obvious from the widget's API:

- **A drop is converted absolutely, never as a delta applied to the old date.** A one-day drag
  across a DST boundary is 23 or 25 real hours, but the task's wall-clock time must not move; and a
  delta cannot express a *change of kind*, which is exactly what dragging a timed block into the
  all-day row is.
- **An all-day drop keeps the event's time-of-day.** Per ADR 0011 a `scheduled` datetime with no
  `duration` renders as an all-day chip that still carries its time, and Event Calendar normalises
  an all-day event's `start` to midnight — so the new *day* comes from the drop and the
  *time-of-day* from the original event (`domain/dates.ts#withDatePart`).

## Ports

Each port is an interface in `src/ports`, implemented by an adapter and consumed only by `app`
use-cases (never imported directly by `domain`).

- **Clock** — the only source of "now" the core is allowed to use, so tests can inject a fixed
  time. Methods: `now(): TaskDate` (current local wall-clock instant, same string shape as
  frontmatter dates).
- **TaskStore** — all task persistence, always addressed by path: there is deliberately no
  `list()`, because Bases already selects the notes a view shows (see "why views never filter"),
  so the plugin never enumerates the vault for task data. Methods: `read(path)`, `readBody(path)`,
  `rawFrontmatter(path)`, `exists(path)`, `updateProperties(path, patch)` (goes through
  `processFrontMatter`), `create(draft)` (fails idempotently if the target path already exists).
  All return `Result<_, TaskStoreError>`.
- **Notifier** — user-visible feedback without coupling `app` to Obsidian's `Notice`. Method:
  `notify(message: string): void`.
- **CalendarRenderer** — abstracts the calendar widget library (`src/ports/calendar-renderer.ts`,
  finalized M3). One method, `mount(container: HTMLElement, options: CalendarOptions):
  CalendarHandle`; `CalendarOptions` carries `initialView`/`firstDay`/`editable?`/`compact?` plus an
  all-optional `CalendarCallbacks` (`onEventClick`/`onEventMoved`/`onSlotClick`) — all three wired by
  the calendar view, `callbacks: {}` mounting a read-only calendar. `onEventMoved` resolves to
  whether the move was persisted, so the adapter can revert an optimistic drag whose write failed.
  `compact` is a pane-width fact (too narrow for a 7-column grid), never "is mobile" — see the
  calendar render-path section above. The returned `CalendarHandle` is how a view drives an
  already-mounted calendar without remounting it: `setEvents`, `setView`, `getView`, `setFirstDay`,
  `setCompact`, `goTo`, `next`, `prev`, `today`, `destroy`. `getView` reads back whichever view Event
  Calendar is ACTUALLY showing (via `calendar.getOption("view")`, mapped through
  `event-calendar-mapping.ts#fromEventCalendarView`) rather than the last one this handle pushed —
  the widget's own header buttons can switch views outside the port entirely, which is what compact
  month's tap-to-Day-view navigation needs to detect correctly (see above). `setCompact` is the one
  exception to "without remounting" — the Event Calendar adapter destroys and recreates its widget to
  apply it (see above for why). `CalendarEvent`/`CalendarViewKind` are domain types
  (`domain/calendar-events.ts`, `domain/calendar-view-options.ts`), imported by the port rather than
  defined in it — they're derived data, not part of the widget-abstraction surface.
- **PathResolver** — vault-path concerns kept out of `domain`. Methods: `exists(path: TaskPath):
  boolean`, `normalize(path: string): TaskPath`, `resolveSpawnPath(seriesTitle: string, nextDue:
  TaskDate): TaskPath` (applies the configured spawned-occurrence filename template).

## Composition root

`main.ts` is the plugin's only imperative shell entry point and the only place that decides
which concrete adapter implements which port (e.g. the Event Calendar adapter is the sole
`CalendarRenderer` — swapping calendar libraries later means writing a new adapter and changing
one line here). On `onload()` it:

1. Loads and migrates settings (`src/settings`).
2. Constructs adapters (`ObsidianTaskStore`, `ObsidianClock`, `ObsidianNotifier`,
   `EventCalendarRenderer`, ...), each closed over `this.app`.
3. Registers Bases views via `this.registerBasesView(type, { name, icon, factory, options })` for
   `isotask-feed` and `isotask-calendar`.
4. Registers commands, the settings tab, file-menu and editor-menu entries, and the optional
   ribbon icon.

Everything registered through `register*`/`add*` Obsidian APIs (`registerEvent`,
`registerDomEvent`, `registerInterval`, `addCommand`, `addSettingTab`, `registerBasesView`) is
torn down automatically by the `Plugin` base class when the plugin unloads — there is no manual
`onunload()` cleanup to write as long as every side-effecting registration goes through one of
those methods.

## Why views never filter

Bases already owns which notes appear, their order, grouping, and property visibility — that is
the point of building on Bases instead of a bespoke query engine. `isotask-feed` and
`isotask-calendar` render exactly the entry set Bases hands them; the feed view's own bucket
computation is presentation (mapping already-selected tasks to time buckets and rows), not
filtering. If a view silently dropped or reordered entries beyond what its declared view options
say, it would diverge from what the user configured in the `.base` file and from what every other
Bases view (e.g. the generated `All tasks` table) shows for the same file. Keeping filter/sort/
group exclusively in Bases keeps the plugin's surface area small and its behavior predictable
across views.
