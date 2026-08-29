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

Within a bucket, rows sort: (when `completedAtBottom` is on) terminal-kind tasks (`domain/status.ts#isTerminal`)
last, then — on each side of that split — date (date source) ascending -> priority descending ->
title ascending. `completedAtBottom` reorders which tasks come first; it never replaces the
date/priority/title ordering, only splits it into a non-terminal group and a terminal group, each
independently sorted the same way. This ordering is fixed by the view and ignores whatever order
Bases applied upstream; this is documented view behavior, not a bug.

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
  with no `duration`) renders in the all-day row with its time prefixed onto the title, e.g.
  `09:00 Budget report` (`event-calendar-mapping.ts#toEventCalendarEvent`, via
  `domain/dates.ts#formatTime`) — the time-grid position is not shown, only the day and the
  prefixed text. A genuinely date-only chip gets no prefix.

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
