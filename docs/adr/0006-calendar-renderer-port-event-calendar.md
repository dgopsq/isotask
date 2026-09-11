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
  framework for isotask's own UI" — it isn't isotask's own UI, it's a wrapped third-party widget.
- The port's method surface has to anticipate what a calendar widget can do generically (mount,
  set events, click/drop/resize callbacks); an Event-Calendar-specific feature that doesn't fit
  the port abstraction can't be used without widening the port.

## Bundle size (measured, M3 Wave 3)

Before this wave, `main.js` had `EventCalendarRenderer` written (Wave 2) but not yet constructed or
imported anywhere — esbuild's tree-shaking dropped `@event-calendar/core` (and the Svelte runtime
it pulls in) from the bundle entirely, so a build at `7da81b4` (the tip of Wave 2) doesn't yet carry
the library's real cost. Wiring `EventCalendarRenderer` into `main.ts` (Wave 3) is what actually
pulls it in:

| | `main.js` raw | `main.js` gzip |
|---|---|---|
| `7da81b4` (Wave 2 tip, adapter unused) | 100,581 B (~98 KiB) | 30,197 B (~29 KiB) |
| After Wave 3 (adapter wired into `main.ts`) | 234,953 B (~229 KiB) | 76,162 B (~74 KiB) |
| Delta | +134,372 B | +45,965 B (~45 KiB) |

The ~45 KiB gz delta is above this ADR's original ~35 KiB gz estimate for Event Calendar alone —
plausibly the Svelte 5 runtime and/or the three imported plugins (`DayGrid`, `TimeGrid`, `List`)
cost more once actually bundled than the unminified `dist/index.js` size suggested at decision time
(see the M3 plan's "`@event-calendar/core` facts" for that estimate's basis). More notably, this
ADR's Context cites a **~150 KiB minified** budget for the whole plugin, and the measured minified
`main.js` (~229 KiB raw) is already over it — the raw/minified number is the one to hold against a
"minified" budget, not the gzip figure, and rrule/date-fns/valibot (already in the bundle before
M3) account for some of the pre-existing gap too. This wasn't caught during Wave 2 because the
adapter sat unconstructed and tree-shaken out until Wave 3 wired it in; flagging here rather than
quietly treating the budget as met — a follow-up should either revisit the budget number or look at
trimming (e.g. checking whether Event Calendar's Svelte runtime can be shared/slimmed, or whether
the ~150 KiB figure was gzip-based all along and just mislabeled "minified" when this ADR was
written).

## Alternatives considered

- **FullCalendar v6.** Rejected: larger bundle footprint than Event Calendar and uses an internal
  Preact runtime; FullCalendar v7 additionally requires a `Temporal` polyfill, which conflicts
  with the no-`Temporal` stance taken in ADR 0008 (Chromium versions below 144, which Obsidian's
  shells can still ship, lack native `Temporal`).
- **Schedule-X.** Rejected: bundle size impact not verified against the budget at decision time;
  revisit if Event Calendar proves unworkable.
- **Toast UI Calendar.** Rejected: project appeared stale (maintenance activity) at decision time.
