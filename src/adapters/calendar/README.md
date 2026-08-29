# Calendar adapter — not implemented yet (M3 Wave 2)

This directory is where the sole `CalendarRenderer` implementation goes (ADR 0006), wrapping
`@event-calendar/core`. It is the only part of the codebase allowed to import `@event-calendar/*`
(ESLint-enforced, see `eslint.config.js`).

`src/ports/calendar-renderer.ts`'s `CalendarRenderer` interface is finalized (M3 Wave 1 —
`CalendarEvent`/`CalendarViewKind` are domain-owned, imported from `domain/calendar-events.ts`
and `domain/calendar-view-options.ts`; `CalendarCallbacks` fields and `CalendarOptions.editable`
are optional, ready for M4 to fill in with no port shape change). Implement it here in M3 Wave 2
(`~/agent-notes/obtask/plans/2026-08-29-m3-calendar.md`):

```ts
export interface CalendarRenderer {
	readonly mount: (container: HTMLElement, options: CalendarOptions) => CalendarHandle;
}
```

`@event-calendar/core` is not currently in `package.json` — add it (`pnpm add
@event-calendar/core@5.12.0`) when this adapter lands. `rrule` is already a dependency (landed
with `domain/recurrence.ts` in M1) and is unrelated to this adapter — `eventsForTask` never
expands `repeat` (ADR 0005, one note = one occurrence). See `docs/ROADMAP.md` M3 (calendar).
