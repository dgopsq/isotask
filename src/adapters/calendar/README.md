# Calendar adapter

`event-calendar/event-calendar-renderer.ts` is the sole `CalendarRenderer` implementation (ADR
0006), wrapping `@event-calendar/core`. It is the only part of the codebase allowed to import
`@event-calendar/*` (ESLint-enforced, see `eslint.config.js`).

`event-calendar/event-calendar-mapping.ts` holds the pure mapping in both directions —
`CalendarViewKind` -> Event Calendar view name, domain `Weekday` -> Event Calendar `firstDay`,
domain `CalendarEvent` -> Event Calendar `EventInput`, and `fromEventCalendarDrop` converting a
drag/resize result back into domain `TaskDate`s — and is unit-tested directly. The renderer class
itself needs a real DOM `Element` for `createCalendar`, unavailable under vitest's `environment:
"node"`, so it's exercised at runtime by the Bases view and by `e2e/` instead. That split is why
anything with a decision in it belongs in the mapping file rather than in `mount()`.

`mount()` loads the `DayGrid`, `TimeGrid` and `Interaction` plugins — no `List` (the calendar has
no list view; day/week/month only). `Interaction` is what provides `dateClick` and
`editable`/drag/resize; `eventClick` needs no plugin, which is why the read-only calendar shipped
without it. Which `CalendarCallbacks` the caller wires decides which Event Calendar options get
set, and an unwired callback leaves its option key *absent* rather than `undefined` —
`exactOptionalPropertyTypes` rejects the latter, hence the `Pick<Calendar.Options, "...">`
conditional-spread pattern repeated for each one.

`durationEditable` is set per event, `false` for all-day chips: resizing one would ask the user to
give a task an end *date*, and the data model has no property for one (`duration` is minutes, and
only meaningful against a timed `scheduled`). All-day chips stay draggable, just not resizable.

`rrule` is a separate, already-present dependency (landed with `domain/recurrence.ts` in M1) and
is unrelated to this adapter — `eventsForTask` never expands `repeat` (ADR 0005, one note = one
occurrence). See `docs/ARCHITECTURE.md`'s "Data flow: calendar reschedule path" for the whole
gesture-to-frontmatter path.
