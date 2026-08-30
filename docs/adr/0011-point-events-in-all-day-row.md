# 0011. Point events in the all-day row

## Status

Accepted, 2026-08-29

## Context

The week/day calendar time grid rendered every timed `due`, and every timed `scheduled` with no
`duration`, as a zero-duration ("point") event: a 24px-tall rectangle with no real length on the
grid. With more than one such marker near the same hour, or a marker landing on top of a genuine
scheduled+duration block, these collided and overlapped, making the grid unreadable. Event
Calendar 5.12 has no built-in time-grid clustering (a "+N more" popover the way month view has for
day cells) to absorb the overflow.

## Decision

A zero-duration event — a timed `due` (never has a duration), or a timed `scheduled` with no
`duration` — is rendered as an **all-day chip** instead of a time-grid rectangle, with its time
shown as a separate muted label in front of the title ("09:00" next to "Budget report",
`domain/dates.ts#formatTime`). The time grid holds only real blocks: `scheduled` with both a time
and a `duration`. `domain/calendar-events.ts#scheduledEvent`/`#dueEvent` set `allDay: true` for
every case except a timed-with-duration `scheduled`, but keep `start`'s time component either way
— the mapping layer (`event-calendar-mapping.ts#toEventCalendarEvent`) is what turns that
surviving time into `extendedProps.obtaskTime`, only when `allDay && isDateTime(start)`; the
renderer's `eventContent` (`event-content.ts`) reads it back to build the label. The renderer also
sets `slotEventOverlap: false`, so two real blocks that do overlap in time lay out side by side
instead of stacking on top of each other.

## Consequences

Positive:
- The time grid only ever shows things with an actual duration; it can no longer collide two
  unrelated markers, or a marker with a real block.
- A day's zero-duration events are no longer capped by vertical grid space — the all-day row grows
  to fit them, same as month view already does for all its (also zero-duration) events.
- No time grid overflow-clustering code is needed to work around Event Calendar's lack of one.

Negative:
- A due-time's position on the timeline is no longer visible at a glance — only its day and its
  `HH:mm` label communicate the time; reading it requires reading text, not scanning a position on
  the grid.
- A day with many zero-duration events grows the all-day row tall, pushing the time grid down
  further before it's visible.

## Alternatives considered

- **Side-by-side markers only** (keep zero-duration events in the time grid, rely solely on
  `slotEventOverlap: false` to avoid literal overlap). Rejected: a busy hour still fills the grid
  with several 24px slivers squeezed to a fraction of the column's width, each too narrow to read
  a title in — narrower, not clearer.
- **Tick-mark + same-slot clustering in the domain.** A dedicated compact marker rendering (e.g. a
  thin tick on the grid's edge) plus explicit clustering logic for markers sharing an hour.
  Rejected for now: meaningfully more code (a new event shape, cluster-grouping logic, its own
  popover/expand interaction) for a problem the all-day-row move already resolves; can be added
  later without undoing this decision if the all-day row turns out to feel like a demotion in
  practice.
