# 0014. Three-level priority with Apple Reminders-style marks

## Status

Accepted, 2026-08-31

## Context

Priority was `low | normal | high | urgent`, rendered as a colored chip and, until now, reused to
color calendar events. In practice `low` saw negligible use next to `normal`, and priority-driven
event coloring collided with project color (ADR 0015): once a project note could drive the card's
dot/bar, a task could carry two independent, competing color signals for two different things on
the same small surface. Apple Reminders already solves "priority as a compact mark instead of a
colored chip" with a scheme every user recognizes.

## Decision

`Priority` narrows to `"normal" | "high" | "urgent"` (`domain/task.ts`). `"low"` is retired from
the type but not rejected from existing notes: `domain/canonicalize.ts#canonicalizePriorityValue`
aliases any case variant of `"low"` to `"normal"` via a `PRIORITY_ALIASES` table and a new
`CanonicalFixReason`, `"priority-alias"` — the same lenient-parse mechanism ADR 0010 established,
so a note with `priority: low` keeps parsing (as `normal`) instead of failing `invalid-priority`.
This is a one-way collapse: canonicalization never reconstructs `"low"`.

Priority no longer drives any dot/bar color anywhere (feed row, calendar month dot, due ring,
time-grid pill) — that slot now belongs to project color (ADR 0015). Instead,
`domain/task.ts#priorityMarks` renders a text mark at the right of a card: `normal` -> `""`, `high`
-> `"!"`, `urgent` -> `"!!"`, colored via the existing `priorityChipClass` mapping (`high` ->
`--color-orange`, `urgent` -> `--color-red`). A `normal` task's control still occupies its grid
cell — an empty, inert placeholder span (`isotask-feed__priority isotask-feed__priority--empty`),
not a fully-omitted element, so a mixed-priority feed's later columns (project, tags) stay
column-aligned across rows — but it renders no mark, no click target, and no color. Editing
priority (the row's priority menu, the task panel, the "Set priority" command) is unaffected by
whether anything currently renders.

## Consequences

Positive:
- Project color (identity) and a priority mark (urgency) can coexist on one card without either
  drowning out the other.
- The common case (`normal`) renders visually silent, so a feed/calendar dominated by
  normal-priority tasks stays quiet.
- Three levels map cleanly onto two marks with no ambiguity; `PRIORITIES`-driven exhaustiveness
  checks (`priorityRank`, `priorityMarks`, `priorityChipClass`) each shrank by one case.

Negative:
- A vault with existing `priority: low` tasks silently reclassifies them as `normal` on next
  parse — a real semantic change to those notes, and one-way (see Decision).
- Two levels now share a `!`/`!!` scale with no room for a fourth without a third mark shape.

## Alternatives considered

- **Keep 4 levels, only add marks.** Rejected: `low` had no natural mark distinct from `normal`'s
  "nothing" — giving it a mark that must look quieter than "nothing" is impossible, and leaving it
  unmarked makes `low`/`normal` indistinguishable anyway.
- **Match Apple's exact scale (`low` = `!`, `medium` = `!!`, `high` = `!!!`).** Rejected: this
  still needs a distinct `none` state below `low`, i.e. 4 levels — the problem above, just
  renamed. Keeping isotask's existing `high`/`urgent` identifiers and dropping only `low` avoids
  renaming everything that already uses `Priority`.
- **Keep priority driving dot/bar color, add project color as a second dot.** Rejected: one card
  has one dot slot (ADR 0015); two independently-colored dots read as noise, not two signals.
