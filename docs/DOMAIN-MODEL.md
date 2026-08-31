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
| `priority`  | text              | no       | `normal`       | `low \| normal \| high \| urgent`; absent means `normal` |
| `due`       | date / datetime   | no       | —              | ISO 8601, local wall-clock, no timezone suffix |
| `scheduled` | date / datetime   | no       | —              | when the task is planned to be worked; datetime enables `duration` |
| `duration`  | number            | no       | —              | minutes; meaningful when `scheduled` has a time component |
| `repeat`    | text              | no       | —              | RRULE body only, no `DTSTART`; anchor is `due`, else `scheduled` |
| `project`   | text (wikilink)   | no       | —              | `[[Project note]]`; Bases renders it as a link |
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

| id            | label       | kind        |
|---------------|-------------|-------------|
| `todo`        | To do       | `open`      |
| `in-progress` | In progress | `active`    |
| `done`        | Done        | `done`      |
| `cancelled`   | Cancelled   | `cancelled` |

`kind` is the semantic the plugin reasons about (`open`, `active`, `done`, `cancelled` in the
default set — a user could add more statuses per kind, but not more kinds; kinds are TBD (M1) for
the exact closed set beyond these four). `id`/`label`/`icon` are user-facing and configurable.

- Terminal kinds: `done`, `cancelled`.
- Entering any terminal-kind status sets `completed` to now; leaving a terminal-kind status
  (reopen) clears `completed`.
- Only entering a `done`-kind status triggers recurrence spawning. Entering `cancelled` ends the
  series — no spawn.
- The "Cycle status" command walks the configured status list in order.
- Bases filters operate on the raw `status` value, not `kind`. The generated `Tasks.base` filters
  `status != "done" && status != "cancelled"` and is regenerated from settings when the status
  list changes.
- A missing or empty `status` parses as the first configured `open`-kind status rather than
  failing (ADR 0012) — this is what makes a note created by the Bases toolbar's `+ New` button
  (see "New (Bases toolbar)" below) parse as a normal open task instead of an invalid row. Parsing
  never writes this default back to the note; the next write through any `app/*` use-case
  persists it. Only when no `open`-kind status is configured at all does this still fail, with
  `no-open-status`.

## Priority

Fixed set, ordered low to high: `low`, `normal`, `high`, `urgent`. Absent `priority` is treated as
`normal`. Used as the second sort key inside feed buckets (priority desc) and to color calendar
events via Obsidian's `--color-*` palette variables.

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
5. UI: a recurrence picker offers presets — daily, weekdays, weekly on `<day>`, every N weeks,
   monthly on day N, yearly — plus a raw RRULE text field for anything else. Natural-language
   recurrence input is a later idea (see `docs/ROADMAP.md`), not in scope for v1.

## Feed buckets

Buckets are computed by `domain/buckets.ts` from a configurable *date source* view option (`due`
default, `scheduled`, or `earliest` of the two), plus a `now` value from the `Clock` port and the
configured week-start setting (Monday default).

Buckets, in order: **Overdue** (date source < today) · **Today** (date source == today) ·
**This week** (rest of the current week, i.e. after today through the last day of the current
week) · **Next week** (the following full week) · **Later** (after next week) · **No date**
(date source absent).

Terminal-kind tasks are not excluded from bucketing by the buckets function itself — whether they
are visible at all is decided by the Bases filter on the underlying `.base` view.

Within a bucket, rows sort: (when `completedAtBottom` is on) terminal-kind tasks
(`domain/status.ts#isTerminal`) last, then — on each side of that split — one of two orders,
chosen by the feed view per `this.config.getSort()` (`buckets.ts`'s `BucketOptions.order`):

- **No sort configured in the Bases toolbar** (`getSort()` returns `[]`): the *smart* order — date
  (date source) ascending -> priority descending -> title ascending.
- **A sort is configured in the Bases toolbar**: Bases has already sorted `group.entries`
  accordingly, and the feed keeps that order as-is within each bucket (`order: "preserve"` — the
  within-bucket comparator applies only the `completedAtBottom` split and otherwise returns `0`,
  relying on `Array.prototype.sort`'s stability to leave Bases' order untouched).

Either way, `completedAtBottom` only reorders which tasks come first; it never replaces the
chosen order, only splits it into a non-terminal group and a terminal group, each independently
keeping that order. The calendar view ignores the toolbar sort entirely — its events are placed
by time, not list position (see "Calendar event derivation" below).

### Feed view options

Three Bases-native view options (`views/bases/register.ts`'s `options`, parsed by
`domain/feed-view-options.ts#parseFeedViewOptions`; not plugin settings — set per-view, in Bases'
own view options panel):

| option              | type     | default | effect |
|----------------------|----------|---------|--------|
| `dateSource`         | dropdown | `due`   | which date anchors bucketing *and* the row's date chip (`due`/`scheduled`/`earliest`) |
| `showEmptyBuckets`   | toggle   | `false` | render every bucket header, even with zero tasks (empty ones get a muted "No tasks" placeholder), instead of skipping them |
| `completedAtBottom`  | toggle   | `true`  | sort terminal-kind tasks after non-terminal ones within each bucket (see above) |

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
- `Priority` -> the priority chip. `Project` -> the project link.
- `Tags` (either the frontmatter `tags` property or Obsidian's own inline/`file.tags`) -> the tags
  list, same first-wins dedupe as the date chip.
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
  `extendedProps.obtaskTime` via `domain/dates.ts#formatTime`; the adapter's `event-content.ts`
  renders it as `.obtask-event-time`, styled in `styles/calendar.css`) — the time-grid position is
  not shown, only the day and the label. A genuinely date-only chip carries no `obtaskTime` and
  shows no label.
- Chips are ordered within the calendar by `domain/calendar-events.ts#sortCalendarEvents`
  (start, then title, then id) before being handed to the renderer — Event Calendar normalises
  all-day events' `start` to midnight before its own (stable) sort, so without this pre-sort,
  same-day chips at different times of day would tie there and keep insertion order instead of
  time order.

A task with both `due` and `scheduled` set and `events: both` produces two separate calendar
events for the same task. Event color follows `priority` by reusing the feed's existing
`domain/task.ts#priorityChipClass` mapping — no new priority-to-color table. The adapter
(`event-calendar-mapping.ts#toEventCalendarEvent`) attaches `obtask-priority-<priority>` as one of
the event's `classNames`, and `styles/calendar.css` maps each to an Obsidian `--color-*` variable,
scoped under `.obtask-calendar` so it doesn't affect the feed's own (differently-styled) priority
chip: `urgent`/`high` set the event's background (`--color-red`/`--color-orange`) plus
`--text-on-accent` text; `normal`/`low` leave the background alone and only tint the event's
left-edge accent bar (`--text-muted`/`--text-faint`). No recurrence expansion: `eventsForTask`
never reads `repeat` — one note is one occurrence (ADR 0005), so a recurring task's calendar
presence is exactly its own `due`/`scheduled` values, with no future-occurrence events synthesized.

### Narrow-pane compaction

Below `COMPACT_CALENDAR_WIDTH` (640px, `domain/calendar-view-options.ts`) a 7-column week/month
grid has no room left for a legible event chip — at a 390px phone viewport a month cell is ~53px
wide, room for a priority dot and nothing else. `views/bases/calendar/calendar-view.ts` measures
the calendar **pane's own width** (`clientWidth`), not `is-mobile`: a narrow split pane on desktop
gets the same treatment as a phone, and a full-width pane on a phone in landscape doesn't.

Below the threshold, `domain/calendar-view-options.ts#effectiveCalendarView` maps `"month"` to
`"week"` — which the Event Calendar adapter then draws not as the usual 7 days but as a **rolling
3-day window** (`"3 days"` in the header, replacing "Week"; "Month" is dropped from the view
switcher entirely). `"day"` and `"week"` already fit a narrow pane and pass through unchanged. The
window is rolling from wherever the calendar is currently navigated to, not snapped to `firstDay` —
confirmed against the vendored Event Calendar's own range derivation, which only snaps to
`firstDay` for whole-week/month durations.

**Known wart**: Bases' own view-option dropdown still lists "Month" (Bases view options can't vary
at runtime by pane width — they're static per-`.base`-file config), so a user (or a saved `.base`
file) choosing "Month" on a narrow pane silently renders 3 days instead of a 7-column grid. This is
accepted, not a bug to fix — the alternative (hiding "Month" from the dropdown itself) would need
the dropdown's own options to vary by live pane width, which Bases doesn't support.

The compact time-axis gutter is narrowed from 72px to 28px. It was 48px of content plus 12px of
padding each side, and the widest thing in it was not an hour label but the vendored "all-day"
corner label (47px, against 39px for "13:00") — Event Calendar sizes that whole sidebar column to
the widest content any row puts in it, so shortening the hour labels alone would have changed
nothing. Three things shrink together: `slotLabelFormat` becomes `{ hour: "2-digit", hour12: false }`
so hours render as a bare zero-padded 24-hour number ("13", 16px, matching `domain/dates.ts#formatTime`'s
own convention — `hour12` must be pinned, since a 12-hour locale would render the wider "1 PM"); the
"all-day" label is replaced via `allDayContent` with a span carrying an `obtask-` class, which
`calendar.css` then visually hides; and the sidebar padding is tightened. The label is hidden with
the clip-to-1px treatment rather than `display: none`, so it stays in the accessibility tree and the
all-day row is still announced — an out-of-flow element contributes no width, which is what actually
shrinks the column. `allDayContent` is passed as a FUNCTION, not a fixed value: Event Calendar
resolves it inside a reactive `derived`, so each render must get its own node rather than re-parenting
one shared span.

At the compact 3-day view's ~86px column width, a timed all-day chip's time label and title no
longer fit on one line (the title was squeezed out entirely — a chip read as bare "11:45" with no
task name). `styles/calendar.css` stacks the two onto separate lines under
`.obtask-calendar--compact` (CSS-only: `.ec-event-body` gets `flex-wrap: wrap` and the title
`flex-basis: 100%`, forcing it onto its own line via the standard flexbox "wrap" trick — no change
to `event-content.ts`'s DOM). A date-only chip (no `.obtask-event-time` node) is unaffected, since
the rule is scoped via a `.obtask-event-time ~ .ec-event-title` sibling combinator. Wide panes are
untouched — the rule only applies under `.obtask-calendar--compact`. The compact grid's own height
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

- The feed view renders an "invalid task" row showing the reason(s), and the note is excluded
  from bucket computation (it cannot be bucketed without valid data) but is not hidden by the
  plugin — Bases' own filters still decide whether the row appears at all.
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
