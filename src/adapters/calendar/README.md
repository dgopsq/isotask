# Calendar adapter — not implemented yet

This directory is where the sole `CalendarRenderer` implementation goes (ADR 0006), wrapping
`@event-calendar/core`. It is the only part of the codebase allowed to import `@event-calendar/*`
(ESLint-enforced, see `eslint.config.js`).

Implement `src/ports/calendar-renderer.ts`'s `CalendarRenderer` interface here in M3:

```ts
export interface CalendarRenderer {
	readonly mount: (container: HTMLElement, options: CalendarOptions) => CalendarHandle;
}
```

`@event-calendar/core` and `rrule` are not currently in `package.json` — add them back
(`pnpm add @event-calendar/core rrule`) when this adapter and `domain/recurrence.ts` land. See
`docs/ROADMAP.md` M1 (recurrence) and M3 (calendar).
