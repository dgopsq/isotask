# Domain model

This design was decided on 2026-08-29. Keep this file in sync with `src/domain` whenever the
frontmatter schema, statuses, or recurrence rules change (see `AGENTS.md` workflow expectations).

## Frontmatter schema

A note is a task iff `<markerKey> == <markerValue>` (default `type == "task"`); nothing else
(folder, tag) is required. All keys below are configurable in settings; the table shows defaults.

| key         | type              | required | default        | notes |
|-------------|-------------------|----------|----------------|-------|
| `type`      | text              | yes      | —              | marker; key and value both configurable |
| `status`    | text              | yes      | `todo`         | id of a configured status, see Statuses |
| `priority`  | text              | no       | `normal`       | `normal \| high \| urgent`; absent means `normal`; `low` (retired) aliases to `normal` |
| `due`       | date / datetime   | no       | —              | ISO 8601, local wall-clock, no timezone suffix |
| `scheduled` | date / datetime   | no       | —              | when the task is planned to be worked; datetime enables `duration` |
| `duration`  | number            | no       | —              | minutes; meaningful when `scheduled` has a time component |
| `repeat`    | text              | no       | —              | RRULE body only, no `DTSTART`; anchor is `due`, else `scheduled` |
| `project`   | text (wikilink)   | no       | —              | `[[Project note]]`; Bases renders it as a link; the project note itself may carry its own `color` (see "Project color" below) |
| `tags`      | list              | no       | —              | native Obsidian tags |
| `created`   | datetime          | yes      | now, on create | set by the plugin, never edited by the user |
| `completed` | datetime          | no       | —              | set when status transitions into a `done`-kind status; removed on reopen |

Rules:
- `due`/`scheduled` accept `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm[:ss]`. No timezone suffixes; values
  are local wall-clock, matching Obsidian's own date/datetime property behavior.
- Property *types* (date vs. text) are inferred by Obsidian from the value; the plugin never
  touches the private `metadataTypeManager`.
- Writes go only through `app.fileManager.processFrontMatter`. The plugin never rewrites the body
  of an existing note, except when creating a spawned recurrence occurrence (a new note).

Domain types (branded, `src/domain`): `TaskPath`, `IsoDate`, `IsoDateTime`,
`TaskDate = IsoDate | IsoDateTime`, `Minutes`, `RRuleString`, `StatusId`, `Priority`, `Task`,
`TaskDraft` (input for creation), `ParsedFrontmatter` (raw record), `TaskParseError`.

## Statuses

Configurable list; default:

| id     | label  | kind   |
|--------|--------|--------|
| `todo` | To do  | `open` |
| `done` | Done   | `done` |

`kind` is the semantic the plugin reasons about, and it is a closed set of exactly two:
`open`/`done` (ADR 0017). `id`/`label`/`icon` are user-facing but there is currently no UI to edit
them — the status list is data-only, kept as settings so the domain abstraction (a `StatusConfig`
list with `kind`) survives for a possible future extension, but the plugin ships and only exposes
the two defaults above. `StatusConfigSchema.kind` in `domain/settings.ts` accepts only `"open"` or
`"done"`; a persisted list with any other kind (e.g. a pre-0017 `active`/`cancelled` entry) fails
validation as a whole and falls back to `DEFAULT_STATUSES`.

There is no way to pick or configure a status by hand anywhere in the UI — no status dropdown, no
settings modal, no "Set status…"/"Cycle status" command. The only status-changing affordance is a
single done/reopen toggle: the feed row's status circle, the file/edit menu's "Mark as
done"/"Reopen" item (`ui/status-menu.ts#addDoneMenuItem`), the task panel's "Done" toggle, and the
"Toggle done" command, all driven by `domain/status.ts#toggleStatus`. Plus a direct "Complete task"
command that sets the first configured `done`-kind status without going through the toggle.

- Entering a `done`-kind status sets `completed` to now; leaving one (reopen) clears `completed`.
- Only entering a `done`-kind status triggers recurrence spawning.
- The feed row's status circle toggles rather than opening a menu
  (`views/bases/feed/feed-view.ts#renderStatusControl`, `domain/status.ts#toggleStatus`): a
  `done`-kind status toggles to the first configured `open` status (reopen); any other status
  (open, or unconfigured) toggles to the first configured `done` status (mark as done). The
  "Toggle done" command does the same for the active note.
- Bases filters operate on the raw `status` value, not `kind`. The generated `Tasks.base` no longer
  excludes `done`-kind statuses at the file level — it only checks the marker (`type == "task"`).
  The Calendar view includes per-view filters to exclude done tasks; the Feed and "All tasks" table
  include them. Existing `.base` files keep their old file-level `status != "done"` filters and must
  be regenerated or edited by hand to remove them.
- A missing or empty `status` parses as the first configured `open`-kind status rather than
  failing (ADR 0012) — this is what makes a note created by the Bases toolbar's `+ New` button
  (see "New (Bases toolbar)" below) parse as a normal open task instead of an invalid row. Parsing
  never writes this default back to the note; the next write through any `app/*` use-case
  persists it. Only when no `open`-kind status is configured at all does this still fail, with
  `no-open-status`.
- `completed` is derived from `status`, not just set by the plugin's own toggle: on every
  `metadataCache` change to a task note, `adapters/obsidian/completion-watcher.ts` reconciles the
  two (`domain/completion-drift.ts`, ADR 0018) — a `done`-kind status with no `completed` gets the
  normal done transition applied (completed = now, recurrence spawn included); an `open`-kind
  status with a stale `completed` gets it cleared. This is what makes editing `status` directly in
  the Properties view, an external editor, or a script behave the same as using the plugin's own
  done/reopen toggle. It only reconciles live edits: the watcher ignores every `metadataCache`
  `changed` event until a quiet period after startup indexing's `resolved` events settle, so
  startup indexing never rewrites a pre-existing done task's `completed`. An edit made while
  Obsidian is closed is therefore not reconciled at the next startup — only a change made while
  Obsidian is running, after that quiet period, triggers it.

## Priority

Fixed set, ordered low to high: `normal`, `high`, `urgent`. Absent `priority` is treated as
`normal`. The retired fourth level, `low`, is aliased to `normal` during parsing (any case
variant; `CanonicalFixReason` `"priority-alias"`, see "Lenient parse, canonical write" below) — a
one-way collapse, never reconstructed. Used as the second sort key inside feed buckets (priority
desc).

Priority drives no dot/bar color anywhere (that's project color's job, below); instead it renders
as an Apple Reminders-style text mark at the right of a card, via `domain/task.ts#priorityMarks`:
`normal` -> a clickable icon control showing a faint "no priority" mark, opening the same priority
menu as the `!`/`!!` marks; `high` -> `!` (`--color-orange`), `urgent` -> `!!` (`--color-red`),
reusing the existing `priorityChipClass` mapping for color. The calendar's `event-content.ts`
emits nothing at all for `normal`. Editing priority (the row's priority menu, the task panel,
the "Set priority" command) is unaffected by whether a mark currently renders.

## Project color

A project note (whatever a task's `project` wikilink resolves to) may declare its own `color`
frontmatter property. This is a property of the **project note**, not a task property key — it is
not one of the configurable `PropertyKeys`; the key is always literally `color`, read straight off
the resolved project note's own frontmatter (`adapters/obsidian/project-color-lookup.ts`).

`domain/project-color.ts#resolveDotColor` decides what a task's card dot/bar (the feed row's
project label text color — only when the project property is in the Bases Properties order —
and the calendar's month dot, due ring, and time-grid pill) renders, in order:

1. The task has no `project` at all -> neutral (`var(--text-faint)`).
2. The project note's `color` parses (`parseProjectColor`) -> that color: one of 8 palette names
   (`red orange yellow green cyan blue purple pink`, mapped to Obsidian's `--color-*` variables)
   or a `#rgb`/`#rrggbb` hex string, case- and whitespace-insensitive.
3. Otherwise -> a frozen djb2a hash of the project name onto the same 8-entry palette
   (`hashPaletteColor`), giving every project a consistent, distinguishable color with zero
   configuration.

The feed row's project label shows only when the project property is enabled in the Bases
toolbar's Properties order; a row with it toggled off carries no project color.

**Parse-error policy for `color`:** an invalid value — a non-string, blank/unrecognized text, or a
malformed hex (`#gg0000`, `#12345`) — never errors and never affects the task's own parse result;
`parseProjectColor` simply returns `undefined` and step 3's hash fallback applies. There is no
`TaskParseError` variant for a bad project `color`.

Palette colors apply as one of 8 pre-declared static CSS classes. A hex color has no such class —
Obsidian's plugin guidelines forbid a plugin registering stylesheet rules at runtime — so it's
applied as a scoped `--isotask-dot-color` custom property directly on the element via Obsidian's
`setCssProps`, at the one place each renderer (the feed row, the calendar's `eventDidMount`) holds
the actual DOM node. The calendar's `eventDidMount` is mount-only (Svelte's `onMount`), so it alone
can't repaint an already-mounted event when a project's hex color changes underneath it — the
renderer (`adapters/calendar/event-calendar/event-calendar-renderer.ts`) additionally tracks every
mounted event element in a `Map` keyed by event id, and its `setEvents` walks that map on every
later data update to set or remove `--isotask-dot-color` directly, matching whatever the new event
list says. That's what makes a calendar event's hex color repaint live the same way a palette
class already does.

Editing is via `ui/project-color-modal.ts` (palette swatches, "Automatic" to clear the property,
or a custom hex field), writing through `processFrontMatter` on the *project* note — reachable
from the feed's project-link context menu, the task panel's color swatch, and the "Set project
color…" command. Feed/calendar views track which project note paths their last render's dots
depended on and re-render on a `metadataCache` `changed` event for one of them, so editing a
project's `color` updates every card referencing it without any task note being touched. There is
no rename handling: `metadataCache` fires no `changed` event on a rename, and a rename doesn't
itself change frontmatter, so a renamed project's dot simply keeps following the note under its
new name/path.

## Date formats

- `YYYY-MM-DD` (date) or `YYYY-MM-DDTHH:mm[:ss]` (datetime). No timezone suffix — always local
  wall-clock, consistent with Obsidian's native date/datetime property editors.
- Domain arithmetic uses `date-fns`; `Date` objects are constructed only at the `rrule` and
  calendar-library boundaries, never held in domain state.

## Recurrence semantics

1. `repeat` holds an RRULE *body* only (e.g. `FREQ=WEEKLY;BYDAY=MO`) — no `DTSTART`. It is parsed
   and evaluated with the `rrule` npm package (RFC 5545).
2. **Anchor** (`DTSTART` for evaluation purposes) = `due` if present, else `scheduled`. A task
   with `repeat` set but neither `due` nor `scheduled` is a parse warning: it renders, but never
   spawns.
3. On a status transition into a `done`-kind status:
   a. Compute `next = rrule.after(anchor, inclusive=false)` using the task's `repeat` body
      anchored at `anchor`.
   b. If `next` is undefined (series exhausted or unparseable), do not spawn. Likewise, if no
      configured status has kind `open` (e.g. a user has edited the status list down to none),
      there's no valid spawn target — do not spawn.
   c. Otherwise build the spawned note:
      - Body: identical to the completed note's body (the completed note is the template for the
        series).
      - Frontmatter: copied from the completed note, then patched —
        `status` = the first configured status with kind `open`;
        `due` shifted by `next - anchor` if `due` was present;
        `scheduled` shifted by `next - anchor` if `scheduled` was present;
        `completed` removed;
        `created` = now.
      - Filename: `<seriesTitle> <next-due YYYY-MM-DD>.md` in the same folder, where
        `seriesTitle` is the completed note's basename with a trailing ` YYYY-MM-DD` stripped (so
        titles do not accumulate dates across occurrences). The filename template is configurable,
        default `{{title}} {{due}}`.
4. **Idempotency**: if the spawn target path already exists, the plugin does not spawn a
   duplicate — it shows a `Notice` instead. This makes re-triggering completion (e.g. a duplicate
   event, or the user toggling status back and forth) safe.
5. Entering a `done`-kind status by editing `status` directly in frontmatter (bypassing the
   plugin's own toggle) spawns the next occurrence too — `adapters/obsidian/completion-watcher.ts`
   reconciles `completed` with `status` on any metadata change and, for that case, reuses this same
   transition (ADR 0018). Only a live edit triggers this; one made while Obsidian was closed does
   not reconcile at the next startup.
6. UI: a recurrence picker offers presets — daily, weekdays, weekly on `<day>`, every N weeks,
   monthly on day N, yearly — plus a raw RRULE text field for anything else. Natural-language
   recurrence input is a later idea (see `docs/ROADMAP.md`), not in scope for v1.

## Feed buckets

Buckets are computed by `domain/buckets.ts` from a configurable *date source* view option (`due`
default, `scheduled`, or `earliest` of the two), plus a `now` value from the `Clock` port and the
configured week-start setting (Monday default).

Buckets, in order: **Overdue** (date source < today) · **Today** (date source == today) ·
**This week** (rest of the current week, i.e. after today through the last day of the current
week) · **Next week** (the following full week) · **Later** (after next week) · **No date**
(date source absent) · **Completed** (terminal-kind tasks when `completedAtBottom` is on) · **Errors**
(entries that failed to parse at all — see below).

When the feed view option `completedAtBottom` is on (default), every task whose status kind is `done`
is routed to the `Completed` bucket regardless of its date. When it is off, tasks bucket by date
as before and there is no terminal/non-terminal split.

### Errors bucket

`Errors` is a synthetic bucket, last in `BUCKET_ORDER`/`Bucket` (`domain/buckets.ts`), for entries
Bases handed the feed that look like a task but fail `domain/frontmatter.ts#parseTask` (an unknown
`status`, an unparseable `due`/`scheduled`, …; `TaskParseError`, described for display by
`domain/task.ts#describeTaskParseError`). These entries never become a `Task`, so
`groupIntoBuckets` never routes one there itself — it always comes back empty (there's no anchor
date to bucket by). The feed view sizes it instead from
`adapters/obsidian/bases-entries.ts#tasksFromBasesEntries`'s `invalid` count, which it also reports
separately alongside the parsed `tasks` for the same set of entries.

Ordering and visibility are otherwise identical to every other bucket, via
`domain/buckets.ts#visibleBuckets`: `Errors` renders last (after `Completed` when it exists, or
after `No date` when `completedAtBottom` is off) and, like any other bucket, is skipped entirely
when it has nothing in it and `showEmptyBuckets` is off. Each row keeps the note's path (its title
never parsed) and its error(s), joined; fixing the note is out of scope here — a task linter/fix
flow is a later plan.

Within a bucket (or the `Completed` bucket when `completedAtBottom` is on), rows sort via one of
two orders, chosen per `this.config.getSort()` (`buckets.ts`'s `BucketOptions.order`):

- **No sort configured in the Bases toolbar** (`getSort()` returns `[]`): the *smart* order.
  For date buckets: date (date source) ascending -> priority descending -> title ascending.
  For the `Completed` bucket: `completed` date descending (newest first) -> tasks without a
  `completed` date last -> title ascending.
- **A sort is configured in the Bases toolbar**: Bases has already sorted `group.entries`
  accordingly, and the feed keeps that order as-is within each bucket (`order: "preserve"` — the
  within-bucket comparator returns `0`, relying on `Array.prototype.sort`'s stability to leave
  Bases' order untouched).

The calendar view ignores the toolbar sort entirely — its events are placed by time, not list
position (see "Calendar event derivation" below).

### Feed view options

Three Bases-native view options (`views/bases/register.ts`'s `options`, parsed by
`domain/feed-view-options.ts#parseFeedViewOptions`; not plugin settings — set per-view, in Bases'
own view options panel):

| option              | type     | default | effect |
|----------------------|----------|---------|--------|
| `dateSource`         | dropdown | `due`   | which date anchors bucketing *and* the row's date chip (`due`/`scheduled`/`earliest`) |
| `showEmptyBuckets`   | toggle   | `false` | render every bucket header, even with zero tasks (empty ones get a muted "No tasks" placeholder), instead of skipping them |
| `completedAtBottom`  | toggle   | `true`  | group completed tasks at bottom in a separate `Completed` bucket (smart order: newest `completed` date first) |

A malformed or hand-edited `.base` file falls back to each option's default independently
(`v.fallback` per field) rather than breaking the view.

### Properties (Bases toolbar)

The Bases toolbar's own "Properties" menu (not a plugin option — Bases-native, same panel every
built-in Bases view uses) controls which extra columns a feed row shows, via
`domain/feed-row.ts#feedRowColumns`. The status control and title link are always rendered first,
regardless of the menu; after that, each entry in the menu's order maps to a column, left to
right:

- `Due` or `Scheduled` -> one date chip, at the position of whichever of the two appears first in
  the menu; the second (if also enabled) is ignored — a row shows one date chip, never two.
- `Priority` -> the priority mark (see "Priority" above; `normal` renders a clickable icon control
  showing a faint "no priority" mark).
- `Project` -> the project link; a task with no project renders an italic faint "Set project"
  placeholder, clicking it opens ProjectModal (same as the row context menu's "Project…"), hidden
  in compact mode.
- `Tags` (either the frontmatter `tags` property or Obsidian's own inline/`file.tags`) -> the tags
  list, same first-wins dedupe as the date chip; a task with no tags renders an italic faint "Set
  tags" placeholder, clicking it opens TagsModal, hidden in compact mode.
- The task marker property (`type` by default) contributes nothing — it's noise in a feed row.
- Any other property (a different frontmatter field, or a formula) renders as a muted label/value
  chip, e.g. `Effort: 3`, using the property's Bases-configured display name.

Unchecking every property in the menu (or an `order:` reduced to just `file.name`) leaves a row
showing only its status control and title — still a valid feed, just chip-free.

**Search matches what's shown.** Bases' own toolbar Search only searches properties present in
the view's `order:`, so honouring `order:` for rendering also makes Search cover exactly the
columns visible on screen.

**The calendar view does not honour Properties** (documented no-op, not a bug): its events are
placed by date/time, not by a row of columns, so there is no equivalent per-property rendering to
drive. The calendar's own three view options (`events`/`initialView`/`firstDay`, above the Feed
table) are unaffected either way. Toolbar Search still applies to whatever the calendar's
`order:` contains, same as any other Bases view.

### Search (Bases toolbar)

The Bases toolbar's own Search box (not a plugin feature) matches against the properties listed
in the view's `order:` — the same set "Properties (Bases toolbar)" above draws feed columns from.
Both plugin views inherit it unmodified; there is nothing for the plugin to wire up.

### New (Bases toolbar)

The Bases toolbar's `+ New` button creates a plain note whose frontmatter Bases infers from the
base file's own filters (`==`, `contains`, `hasTag`, `inFolder`, `hasProperty`, `isEmpty` — never
`!=`) and places it in the view's `newItemFolder` (`app/generate-base.ts` emits this as the
configured task folder on both generated views; falls back to the active file's folder / Obsidian's
default new-note location otherwise). For `Tasks.base` that inference can only ever produce
`type: task` — every status filter it reads is a `!=`, so no `status` is ever inferred. The note
still parses as a normal open task: a missing `status` defaults to the first configured
`open`-kind status (ADR 0012), and it carries the marker property, so it is a valid task from the
moment it's created — just one with only a title and no other fields set.

For a richer starting point, both views override the undocumented `createFileForView`/
`getViewActions` Bases hooks: right-clicking the results-count area next to "Copy"/"Export CSV"
offers a "New task" action, and the same flow backs the toolbar's `+ New` button too (a `BasesView`
can override `createFileForView` outright) — both open the full create-task modal
(`ui/create-task-modal.ts`) instead of the toolbar's plain-note inference, seeding its title from
whatever name the toolbar prompted for.

### Date-chip anchor field

The feed row's date chip edits whichever frontmatter property the configured `dateSource`
actually resolved to for that task (`domain/feed-row.ts#feedRowAnchor`): with `dateSource: due` or
`scheduled`, the chip always edits that field; with `earliest`, it edits whichever of `due`/
`scheduled` produced the earlier date (a tie resolves to `due`, same precedence as
`taskAnchorDate`). When a task has neither date set yet, the chip shows a muted "Set date" and
opens the modal targeting a fixed default field (`feedRowDefaultDateField`): `due` for the `due`
and `earliest` sources, `scheduled` for the `scheduled` source.

**Worked example** — given `now` = Wednesday 2026-09-02 and week start = Monday, the current week
is Mon 2026-08-31 .. Sun 2026-09-06 and the next week is Mon 2026-09-07 .. Sun 2026-09-13:

| date source value       | bucket      |
|--------------------------|-------------|
| `2026-08-28` (Fri, last week) | Overdue |
| `2026-09-01` (Tue, this week, before today) | Overdue |
| `2026-09-02` (Wed, today)     | Today |
| `2026-09-04` (Fri, this week) | This week |
| `2026-09-06` (Sun, this week) | This week |
| `2026-09-07` (Mon, next week) | Next week |
| `2026-09-13` (Sun, next week) | Next week |
| `2026-09-14` (Mon, week after next) | Later |
| `2026-12-25`                  | Later |
| (absent)                      | No date |

## Calendar event derivation

Each task can contribute up to two calendar events, controlled by the `events` view option
(`both` default, or restrict to `scheduled` / `due` only):

- **`scheduled` event**: a real time-grid block, starting at `scheduled` with length `duration`
  minutes, only when `duration` is set *and* `scheduled` has a time component. Every other case —
  date-only `scheduled`, or a timed `scheduled` with no `duration` — is an all-day chip instead:
  the calendar's time grid holds only genuine scheduled+duration blocks (ADR 0011), never a
  zero-duration marker.
- **`due` event**: always an all-day chip, on the `due` date — `due` carries no duration field, so
  it can never become a time-grid block.
- A chip whose underlying date carries a time component (a timed `due`, or a timed `scheduled`
  with no `duration`) shows its time as a separate muted label in front of the title, e.g. "09:00"
  next to "Budget report" (`event-calendar-mapping.ts#toEventCalendarEvent` sets
  `extendedProps.isotaskTime` via `domain/dates.ts#formatTime`; the adapter's `event-content.ts`
  renders it as `.isotask-event-time`, styled in `styles/calendar.css`) — the time-grid position is
  not shown, only the day and the label. A genuinely date-only chip carries no `isotaskTime` and
  shows no label.
- Chips are ordered within the calendar by `domain/calendar-events.ts#sortCalendarEvents`
  (start, then title, then id) before being handed to the renderer — Event Calendar normalises
  all-day events' `start` to midnight before its own (stable) sort, so without this pre-sort,
  same-day chips at different times of day would tie there and keep insertion order instead of
  time order.

A task with both `due` and `scheduled` set and `events: both` produces two separate calendar
events for the same task. Every event renders on a neutral, uncoded surface
(`--background-modifier-hover`, `styles/calendar.css`) — color is carried entirely by two
independent, smaller signals instead of the event background:

- **The leading dot/ring** follows the task's **project**, not its priority (see "Project color"
  above): `due` renders as a ring, `scheduled` as a filled dot, both colored via
  `--isotask-dot-color`, which `domain/calendar-events.ts#CalendarEvent.dotColor` carries and
  `event-calendar-mapping.ts#toEventCalendarEvent` applies as a class
  (`domain/project-color.ts#dotColorClasses`) or, for a hex project color, a `setCssProps` custom
  property set by the renderer's `eventDidMount` and kept live by its `setEvents` repaint (see
  "Project color" above).
- **The trailing `!`/`!!` marks** (present only for `high`/`urgent`) follow the task's
  **priority**, reusing the same `isotask-priority-high`/`isotask-priority-urgent` color classes the
  feed's priority mark uses (`domain/task.ts#priorityChipClass`), attached by
  `event-content.ts#eventContent` — see "Priority" above.

No recurrence expansion: `eventsForTask`
never reads `repeat` — one note is one occurrence (ADR 0005), so a recurring task's calendar
presence is exactly its own `due`/`scheduled` values, with no future-occurrence events synthesized.

### Narrow-pane compaction

Below `COMPACT_CALENDAR_WIDTH` (640px, `domain/calendar-view-options.ts`) a 7-column week/month
grid has no room left for a legible event CHIP — at a 390px phone viewport a month cell is ~53px
wide, room for a small dot and nothing else. `views/bases/calendar/calendar-view.ts` measures
the calendar **pane's own width** (`clientWidth`), not `is-mobile`: a narrow split pane on desktop
gets the same treatment as a phone, and a full-width pane on a phone in landscape doesn't.

**Month renders as a dot grid, not a fallback view.** There is no `effectiveCalendarView`/view
remap any more — every `CalendarViewKind` (day/week/month) renders as itself at every pane width,
and the header switcher always lists all three. Below the threshold, `styles/calendar.css`'s
`.isotask-calendar--compact .ec-day-grid` rules turn month's chips into small dots instead: each
event's title stays in the DOM (clip-to-1px visually hidden, the same treatment the compact
time-axis gutter's "all-day" label already used, see below) so assistive tech still gets it, while
on screen only the existing priority-coloured dot (`.ec-event-body::before`, drawn for the
wide-pane "dot + title" chip too) remains. Every event keeps `pointer-events: none`, so a tap
anywhere in a compact month cell — including directly on a dot — reaches the day cell's own click
handler rather than the event's; `views/bases/calendar/calendar-view.ts#onSlotClick` uses that to
navigate into **Day view** for the tapped date (`handle.goTo` + `handle.setView("day")`) instead of
opening the create-task modal, since compact month is too small to reliably drag or read titles by.
Creating a task from a narrow pane goes through the Bases toolbar's "+ New", or by drilling into
Day view and tapping a time slot there — **mobile month view is read-and-navigate only, no
drag/reschedule**.

A busy day is capped rather than left to grow the whole week row taller: `dayMaxEvents: true`
(`event-calendar-renderer.ts`, compact month only) is Event Calendar's own per-day "does this one
still fit" hide, and `calendar.css` fixes the day-grid's row height to a small px value (rather than
the library's own height-filling default) so the visible cap stays a small, predictable number
(around four) regardless of how tall the pane actually is — no per-day counting logic of our own;
each task already renders its own DOM element, one dot per task, and Event Calendar decides which
ones still fit. The "+N more" link the library would otherwise render for whatever a day hides is
hidden entirely (`.ec-day-foot`) — compact month has no popover UI, only the drill-into-Day-view tap.

Week still collapses to the renderer's rolling **3-day window** when compact (`"3 days"` replacing
"Week" in the header) — that part is unchanged. `"day"` already fits a narrow pane and passes
through unchanged too. The window is rolling from wherever the calendar is currently navigated to,
not snapped to `firstDay` — confirmed against the vendored Event Calendar's own range derivation,
which only snaps to `firstDay` for whole-week/month durations.

Since there is no remap any more, Bases' own view-option dropdown listing "Month" is no longer a
wart: choosing it on a narrow pane renders the same dot grid as the default, not a 3-day
fallback — the dropdown and the render finally agree at every width.

The compact time-axis gutter is narrowed from 72px to 28px. It was 48px of content plus 12px of
padding each side, and the widest thing in it was not an hour label but the vendored "all-day"
corner label (47px, against 39px for "13:00") — Event Calendar sizes that whole sidebar column to
the widest content any row puts in it, so shortening the hour labels alone would have changed
nothing. Three things shrink together: `slotLabelFormat` becomes `{ hour: "2-digit", hour12: false }`
so hours render as a bare zero-padded 24-hour number ("13", 16px, matching `domain/dates.ts#formatTime`'s
own convention — `hour12` must be pinned, since a 12-hour locale would render the wider "1 PM"); the
"all-day" label is replaced via `allDayContent` with a span carrying an `isotask-` class, which
`calendar.css` then visually hides; and the sidebar padding is tightened. The label is hidden with
the clip-to-1px treatment rather than `display: none`, so it stays in the accessibility tree and the
all-day row is still announced — an out-of-flow element contributes no width, which is what actually
shrinks the column. `allDayContent` is passed as a FUNCTION, not a fixed value: Event Calendar
resolves it inside a reactive `derived`, so each render must get its own node rather than re-parenting
one shared span.

At the compact 3-day view's ~86px column width, a timed all-day chip's time label and title no
longer fit on one line (the title was squeezed out entirely — a chip read as bare "11:45" with no
task name). `styles/calendar.css` stacks the two onto separate lines under
`.isotask-calendar--compact` (CSS-only: `.ec-event-body` gets `flex-wrap: wrap` and the title
`flex-basis: 100%`, forcing it onto its own line via the standard flexbox "wrap" trick — no change
to `event-content.ts`'s DOM). A date-only chip (no `.isotask-event-time` node) is unaffected, since
the rule is scoped via a `.isotask-event-time ~ .ec-event-title` sibling combinator. Wide panes are
untouched — the rule only applies under `.isotask-calendar--compact`. The compact grid's own height
stays `"auto"` (unbounded, same as wide panes) — a bounded height would give Event Calendar an
internal scroller, which would pin the day-header and all-day rows in place while the hourly slots
scrolled beneath them; instead the whole grid scrolls away with the pane. This costs little because
per ADR 0011 every zero-duration event (all timed `due`s, and any `scheduled` without a `duration`)
already renders in the all-day row at the very top, visible with no scrolling at all.

### Reschedule semantics

Dragging or resizing a calendar event writes back through `app/reschedule-task.ts`, which builds a
single frontmatter patch (one gesture, one write, one re-render). Four rules govern what it writes,
each of them a consequence of the derivation above rather than a free choice:

- **The event's own field is the one written.** A `CalendarEvent` records the `source` it was
  derived from, so a dragged due-date chip writes `due` and a dragged scheduled block writes
  `scheduled`. A calendar showing both never has to guess.
- **A `due` event has no span**, so a drag of one never touches `duration`, and `due` has no
  resize handle to grab in the first place.
- **`duration` is written only by a resize.** A move leaves the stored `duration` in place rather
  than clearing it: `duration` doubles as a standalone time estimate that an unrelated move has no
  business destroying. This matters for an all-day `scheduled` chip (a datetime with no `duration`,
  or a date-only `scheduled`) dragged along the all-day row — the patch omits `duration`, so an
  estimate set by the "set duration" command survives. Such a `duration` is inert while `scheduled`
  has no time — per the derivation above it takes both to make a block — not incorrect.
- **Time-of-day survives an all-day drop.** A `scheduled` datetime with no `duration` renders as an
  all-day chip that still carries its time (ADR 0011). Moving that chip to another day changes only
  the day; the `14:30` is preserved.
- **A drag cannot cross between the all-day row and the time grid.** This is a limitation of Event
  Calendar 5.12.0, not a decision of ours, and it applies to a real mouse as much as to a synthetic
  one. Its `Action` component captures which region the gesture started in at `pointerdown`
  (`allDaySlot`), freezes a `viewport` rect around that region, and clamps the pointer into that
  rect before hit-testing which cell is under it (`findDayEl`); a cell whose all-day-ness differs
  from the gesture's start is rejected outright (`if (newAllDay === allDay)`). So a `due` chip
  cannot be dragged down into the time grid to give it a time, and a block cannot be dragged up
  into the all-day row to clear its. Use the "set due date"/"set scheduled date" commands for that.
  `fromEventCalendarDrop` still branches on `drop.allDay` and would map such a drop correctly if
  the gesture ever became possible (a newer Event Calendar, or a different renderer behind the
  `CalendarRenderer` port) — the branch is kept and unit-tested for that reason, not because a drag
  reaches it today.
- **Dragging a repeating task's event moves the anchor its next occurrence is computed from.**
  `eventsForTask` ignores `repeat` entirely (ADR 0005: one note is one occurrence), so the event on
  the calendar is always derived from the task's own `due`/`scheduled`, never from an expanded
  RRULE occurrence. Rescheduling that event therefore reschedules the anchor itself: `repeat`
  (`domain/recurrence.ts#nextOccurrence`) evaluates against `due` if present, else `scheduled`
  (`domain/transitions.ts#anchorOf`), so dragging a repeating task's `due` or `scheduled` event
  moves the date the *next* spawned occurrence is computed from, exactly as if the date had been
  edited in Properties. It does not touch any already-spawned occurrence note, each of which is its
  own independent task per ADR 0005.

## Parse-error policy

Frontmatter parsing never throws and never crashes a view. `domain/frontmatter.ts` returns
`Result<Task, TaskParseError[]>`. On failure:

- The feed view groups every such note under the synthetic **Errors** bucket (see "Errors bucket"
  above), each row showing the reason(s); the note is excluded from date-bucket computation (it
  cannot be bucketed without valid data) but is not hidden by the plugin — Bases' own filters
  still decide whether the row appears at all.
- The calendar view does not render an event for an unparseable task.
- A `repeat` present without a usable anchor (`due`/`scheduled`) is treated as a parse *warning*,
  not a hard error: the task still renders and behaves normally, it simply never spawns on
  completion.
- A missing/empty `status` is not an error either (ADR 0012): it defaults to the first configured
  `open`-kind status. `no-open-status` (no `open`-kind status configured at all) is the only
  status-related hard error left; `unknown-status` (a present, unrecognized value) is unchanged.

### Lenient parse, canonical write

Task frontmatter is edited as free text in Obsidian's Properties panel, so unambiguous but
non-canonical variants are common — trailing whitespace, a status *label* typed instead of its id,
a scalar tag, a duration typed as a quoted number, a datetime typed with a space instead of `T`.
Rejecting all of these would make a task silently vanish from every view over a typo. Per ADR 0010,
`domain/frontmatter.ts` runs `domain/canonicalize.ts`'s `canonicalizeFrontmatter` over the raw
frontmatter before validating it, so `parseTask` accepts:

- **status** — leading/trailing whitespace; any case variant of a configured status `id`
  (`"Done"` → `done`); any case variant of a configured status *label* (`"In progress"` →
  `in-progress`). A value matching neither an id nor a label is left as-is and still fails with
  `unknown-status`.
- **priority** — leading/trailing whitespace and any case variant, if the lower-cased result is a
  known `Priority` (`"HIGH"` → `high`). Anything else still fails with `invalid-priority`.
- **duration** — a non-negative-integer *string* becomes a number (`"45"` → `45`). A decimal or
  negative string is left as-is and still fails with `invalid-duration`.
- **tags** — unchanged from the parser's existing behaviour: a scalar string becomes a
  one-element list.
- **due/scheduled/created/completed** — `YYYY-MM-DD HH:mm` and `YYYY-MM-DD HH:mm:ss`
  (space-separated) and `YYYY-MM-DDTHH:mm:ss` (seconds included) all fold to the canonical
  `YYYY-MM-DDTHH:mm`; surrounding whitespace is trimmed. Timezone-suffixed values (`Z`, `+01:00`,
  ...) are never accepted — dates are local wall-clock only (ADR 0008).

`canonicalizeFrontmatter` also reports, per key, the exact patch (`from`/`to`/`reason`) that would
make the note canonical — the plugin never applies this patch automatically; a future
user-triggered linter command is expected to offer it (ADR 0010). Canonicalizing already-canonical
frontmatter is a no-op (zero fixes), and only the configured property keys are ever touched.
