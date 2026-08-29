# Architecture decision records

An ADR captures a decision that is expensive to reverse: the data model, statuses/recurrence
semantics, or a new runtime dependency. See `AGENTS.md` for when a change requires a new ADR.

## Format

Each ADR is a file `docs/adr/NNNN-title.md` (four-digit sequential number, kebab-case title),
with these sections, in order:

- **Title** — `# NNNN. Title`
- **Status** — `Accepted, YYYY-MM-DD` (or `Superseded by NNNN`, `Deprecated`)
- **Context** — what problem forced a decision, in a few sentences.
- **Decision** — what was decided, stated plainly.
- **Consequences** — bullet lists, split `Positive` / `Negative`.
- **Alternatives considered** — each rejected option with the concrete reason it lost.

Keep each ADR to 60 lines or fewer. An ADR is never edited to reflect a later reversal — write a
new ADR that supersedes it and update the `Status` line and the index below.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-bases-first-views.md) | Bases-first views | Accepted, 2026-08-29 |
| [0002](0002-frontmatter-marker.md) | Frontmatter marker identifies a task | Accepted, 2026-08-29 |
| [0003](0003-plain-typescript-fp-core-no-effect.md) | Plain TypeScript FP core, no Effect | Accepted, 2026-08-29 |
| [0004](0004-vanilla-dom-obsidian-helpers.md) | Vanilla DOM via Obsidian helpers, no UI framework | Accepted, 2026-08-29 |
| [0005](0005-recurrence-rrule-spawn-new-note.md) | Recurrence via RRULE, spawn a new note | Accepted, 2026-08-29 |
| [0006](0006-calendar-renderer-port-event-calendar.md) | CalendarRenderer port over Event Calendar | Accepted, 2026-08-29 |
| [0007](0007-time-model-due-scheduled-duration.md) | Time model: due, scheduled, duration | Accepted, 2026-08-29 |
| [0008](0008-dates-iso-strings-date-fns.md) | Dates as ISO strings with date-fns | Accepted, 2026-08-29 |
| [0009](0009-obsidian-1-13-floor-declarative-settings.md) | Obsidian 1.13 floor, declarative settings | Accepted, 2026-08-29 |
| [0010](0010-lenient-parse-canonical-write.md) | Lenient parse, canonical write | Accepted, 2026-08-29 |
| [0011](0011-point-events-in-all-day-row.md) | Point events in the all-day row | Accepted, 2026-08-29 |
