# Architecture

This design was decided on 2026-08-29. Obtask is hexagonal (ports and adapters) with a
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
               `cycleStatus`, `convertNote`, `setDate`, `setDuration`, `setRecurrence`, plus the
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
  ui/          small DOM renderers + modals: `CreateTaskModal`, `DateModal`, `RecurrenceModal`,
               `StatusSuggestModal` (`FuzzySuggestModal`), `status-menu.ts#buildStatusMenu`.
               createEl only; no innerHTML.
  commands/    `register-commands.ts#registerCommands`: wires every command to an `app` use-case;
               note-scoped commands use `checkCallback` + the active file's frontmatter to hide
               themselves off a non-task note.
  settings/    SettingsTab (Setting API), settings type + defaults + migration.
  styles/      obtask.css, calendar.css (theme-variable mappings only).
  main.ts      composition root.
```

**`ObtaskSettings` lives in `src/domain/settings.ts`**, not `src/adapters/obsidian/settings.ts`: it's
pure valibot validation with no Obsidian dependency, so the domain layer owns it (`app` may not
import `adapters`, and `AppDeps.settings()` needs the type). `src/adapters/obsidian/settings.ts`
re-exports it unchanged so existing `@/adapters/obsidian/settings` imports keep working.

Dependency direction is strictly inward: `views`/`ui`/`settings`/`adapters` depend on `app`,
which depends on `ports` and `domain`. `domain` and `ports` depend on nothing in this repo.
`app` never imports an adapter directly — it receives ports through its function/use-case
arguments, wired up in `main.ts`.

## Data flow: Bases feed view render path

```
Bases (.base file)                     obtask-feed BasesView
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

### Bases view options and re-rendering

A `BasesViewRegistration` (passed to `plugin.registerBasesView`, see `views/bases/register.ts`)
can declare `options: (config) => BasesAllOptions[]` — dropdown/toggle entries Bases renders in
its own native view-options panel (not a plugin `SettingsTab`; the feed's three options —
`dateSource`, `showEmptyBuckets`, `completedAtBottom` — are per-`.base`-view config, read back out
via `BasesViewConfig.get(key)` inside `onDataUpdated()`, parsed by
`domain/feed-view-options.ts#parseFeedViewOptions`).

**Finding (verified empirically in `e2e/specs/views.e2e.ts`'s "Feed view options" probe, per the
"live DOM probe recipe" in `docs/CONVENTIONS.md`): editing a view option re-renders the view with
no extra plumbing on obtask's side.** `BasesViewConfig.set(key, value)` alone — with no manual
`onDataUpdated()` call — is enough; Bases owns config reactivity and calls back into the view
itself once the config changes. `FeedBasesView` needed no `onConfigChanged`-style hook (there
isn't one in the public `BasesView` API — the abstract class exposes only `onDataUpdated()`); it
already only reads options at the top of `onDataUpdated()`, so the existing single entry point
covers option changes too. The probe found this by inspecting the runtime "bases" leaf's
prototype chain (`leaf.view.controller.view` is the actual registered `BasesView` instance) and
calling `config.set()` on it directly, rather than driving Bases' own options-panel DOM.

## Data flow: Bases calendar view render path

```
Bases (.base file)                     obtask-calendar BasesView
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

**Outer Bases groups are ignored**: `groupedData`'s groups make sense for the feed (a heading per
group) but not for a single continuous timeline, so `eventsForTask` is called across every group's
entries and every task's events land on the same calendar — there is no per-group calendar
section.

**Mount happens once, not on every render.** The first `onDataUpdated` creates the `.obtask-calendar`
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
        │
        ▼
obtask-calendar BasesView action handler
        │
        ▼
app/rescheduleTask.ts (use-case)
        │  - domain: recompute due/scheduled (+duration) from the new slot
        ▼
ports.TaskStore.write(path, patch)
        │
        ▼
adapters/obsidian TaskStore → app.fileManager.processFrontMatter(file, fn)
        │
        ▼
metadataCache change event fires → Bases re-queries → view re-renders with new data
```
Click on an empty calendar slot follows the same shape but calls `app/createTask.ts` instead,
pre-filled with the clicked date.

## Ports

Each port is an interface in `src/ports`, implemented by an adapter and consumed only by `app`
use-cases (never imported directly by `domain`).

- **Clock** — the only source of "now" the core is allowed to use, so tests can inject a fixed
  time. Methods: `now(): TaskDate` (current local wall-clock instant, same string shape as
  frontmatter dates).
- **TaskStore** — all task persistence. Methods: `list(): Task[]` (or an async iterable — see
  `docs/DOMAIN-MODEL.md`/TBD (M1) for exact signature), `read(path: TaskPath): Task | undefined`,
  `write(path: TaskPath, patch: Partial<TaskDraft>): Promise<Result<void, Error>>` (goes through
  `processFrontMatter`), `create(draft: TaskDraft): Promise<Result<TaskPath, Error>>` (fails
  idempotently if the target path already exists).
- **Notifier** — user-visible feedback without coupling `app` to Obsidian's `Notice`. Method:
  `notify(message: string): void`.
- **CalendarRenderer** — abstracts the calendar widget library (`src/ports/calendar-renderer.ts`,
  finalized M3). One method, `mount(container: HTMLElement, options: CalendarOptions):
  CalendarHandle`; `CalendarOptions` carries `initialView`/`firstDay`/`editable?` plus an all-optional
  `CalendarCallbacks` (`onEventClick`/`onEventMoved`/`onSlotClick` — unwired in M3, `callbacks: {}`;
  M4's extension point). The returned `CalendarHandle` is how a view drives an already-mounted
  calendar without remounting it: `setEvents`, `setView`, `setFirstDay`, `goTo`, `next`, `prev`,
  `today`, `destroy`. `CalendarEvent`/`CalendarViewKind` are domain types
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
   `obtask-feed` and `obtask-calendar`.
4. Registers commands, the settings tab, file-menu and editor-menu entries, and the optional
   ribbon icon.

Everything registered through `register*`/`add*` Obsidian APIs (`registerEvent`,
`registerDomEvent`, `registerInterval`, `addCommand`, `addSettingTab`, `registerBasesView`) is
torn down automatically by the `Plugin` base class when the plugin unloads — there is no manual
`onunload()` cleanup to write as long as every side-effecting registration goes through one of
those methods.

## Why views never filter

Bases already owns which notes appear, their order, grouping, and property visibility — that is
the point of building on Bases instead of a bespoke query engine. `obtask-feed` and
`obtask-calendar` render exactly the entry set Bases hands them; the feed view's own bucket
computation is presentation (mapping already-selected tasks to time buckets and rows), not
filtering. If a view silently dropped or reordered entries beyond what its declared view options
say, it would diverge from what the user configured in the `.base` file and from what every other
Bases view (e.g. the generated `All tasks` table) shows for the same file. Keeping filter/sort/
group exclusively in Bases keeps the plugin's surface area small and its behavior predictable
across views.
