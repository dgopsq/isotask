# 0007. Time model: due, scheduled, duration

## Status

Accepted, 2026-08-29

## Context

Task-management tools conflate "when is this due" and "when do I plan to work on it" to varying
degrees, or offer only one date. Isotask also needs a way to represent timed work blocks for the
calendar view, not just all-day deadlines.

## Decision

Two independent, optional date properties: `due` (a deadline) and `scheduled` (when the task is
planned to be worked), each accepting a date or a datetime. A `duration` (minutes) property is
meaningful when `scheduled` carries a time component, and sizes the timed block the calendar
renders for it. Recurrence anchors on `due` if present, else `scheduled` (ADR 0005). Feed
bucketing uses a configurable date source: `due`, `scheduled`, or the earlier of the two.

## Consequences

Positive:
- Matches how people actually plan: a deadline and a work session for the same task are often
  different times, and sometimes only one of them exists.
- The calendar view gets a natural timed-block source (`scheduled` + `duration`) distinct from the
  all-day deadline marker (`due`), without inventing a third property.
- Both properties independently optional keeps the minimal task (no dates at all) valid and cheap
  to create.

Negative:
- Two date properties (plus `duration`) is more surface area to explain in onboarding/UI than a
  single date field, and the feed's date-source setting adds a decision users must understand.
- A task with both `due` and `scheduled` set and calendar `events: both` produces two calendar
  events for one task (documented in `docs/DOMAIN-MODEL.md`), which needs clear visual
  differentiation so it doesn't read as two tasks.

## Alternatives considered

- **Single `date` property** (one field does double duty as deadline and/or work time).
  Rejected: forces users to choose one meaning per task and loses the ability to say "due Friday,
  planning to work on it Wednesday morning" in one task's data.
- **Due date only, no scheduling.** Rejected: leaves the calendar view with nothing but deadlines
  to render, which doesn't support "block out time to work on this" — a stated goal (calendar with
  drag-to-reschedule implies a plannable time slot, not just a due marker).
