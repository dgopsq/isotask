# 0006. CalendarRenderer port over Event Calendar

## Status

Accepted, 2026-08-29

## Context

The calendar view needs day/week/month/list rendering, drag-to-reschedule, and touch support,
inside a tight bundle budget (~150 kB minified total) and Obsidian's theme system. The calendar
library is a significant implementation choice with real tradeoffs, and different libraries in
this space carry different size, dependency, and maintenance risk profiles.

## Decision

Define a `CalendarRenderer` port (`src/ports`) that the app/views depend on, and implement it with
one adapter wrapping `@event-calendar/core` (vkurko), the only place in the codebase allowed to
import `@event-calendar/*` (ESLint-enforced). The concrete adapter is selected in exactly one
place, `main.ts`. Library CSS variables are mapped to Obsidian theme variables in
`src/styles/calendar.css`.

## Consequences

Positive:
- Swapping the calendar library later (if Event Calendar's tradeoffs stop working out) means
  writing a new adapter behind the same port and changing one line in `main.ts` — no churn in
  `app`/`views`.
- Event Calendar is comparatively small (~35 kB gz) and fits the bundle budget alongside rrule,
  date-fns, and valibot.
- The port also gives tests a fake `CalendarRenderer`, keeping calendar-adjacent app logic
  (`rescheduleTask`) unit-testable without a real DOM/calendar widget.

Negative:
- Event Calendar's internal rendering uses Svelte; that runtime is bundled but scoped entirely
  inside the adapter and invisible to the rest of the app, consistent with ADR 0004's "no
  framework for obtask's own UI" — it isn't obtask's own UI, it's a wrapped third-party widget.
- The port's method surface has to anticipate what a calendar widget can do generically (mount,
  set events, click/drop/resize callbacks); an Event-Calendar-specific feature that doesn't fit
  the port abstraction can't be used without widening the port.

## Alternatives considered

- **FullCalendar v6.** Rejected: larger bundle footprint than Event Calendar and uses an internal
  Preact runtime; FullCalendar v7 additionally requires a `Temporal` polyfill, which conflicts
  with the no-`Temporal` stance taken in ADR 0008 (Chromium versions below 144, which Obsidian's
  shells can still ship, lack native `Temporal`).
- **Schedule-X.** Rejected: bundle size impact not verified against the budget at decision time;
  revisit if Event Calendar proves unworkable.
- **Toast UI Calendar.** Rejected: project appeared stale (maintenance activity) at decision time.
