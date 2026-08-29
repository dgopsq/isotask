# Calendar adapter (M3 Wave 2)

`event-calendar/event-calendar-renderer.ts` is the sole `CalendarRenderer` implementation (ADR
0006), wrapping `@event-calendar/core`. It is the only part of the codebase allowed to import
`@event-calendar/*` (ESLint-enforced, see `eslint.config.js`).

`event-calendar/event-calendar-mapping.ts` holds the pure option/event mapping
(`CalendarViewKind` -> Event Calendar view name, domain `Weekday` -> Event Calendar `firstDay`,
domain `CalendarEvent` -> Event Calendar `EventInput`) and is unit-tested directly — the renderer
class itself needs a real DOM `Element` for `createCalendar`, unavailable under vitest's
`environment: "node"`, so it's exercised at runtime by the Bases view instead.

`mount()` loads only the `DayGrid` and `TimeGrid` plugins — no `List` (the calendar has no list
view; day/week/month only) and no `Interaction` (that's an M4 extension, needed only for
click-to-open/drag/resize/click-empty-slot-create; `CalendarCallbacks` is still all-optional and
unwired in M3, see `src/ports/calendar-renderer.ts`).

Not yet done (M3 Wave 3, `~/agent-notes/obtask/plans/2026-08-29-m3-calendar.md`): wiring
`EventCalendarRenderer` into `src/views/bases/calendar/calendar-view.ts` and `main.ts`, and
registering the `obtask-calendar` Bases view options (`initialView`, `events`, `firstDay`).

`rrule` is a separate, already-present dependency (landed with `domain/recurrence.ts` in M1) and
is unrelated to this adapter — `eventsForTask` never expands `repeat` (ADR 0005, one note = one
occurrence). See `docs/ROADMAP.md` M3 (calendar).
