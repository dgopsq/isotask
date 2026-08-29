# 0003. Plain TypeScript FP core, no Effect

## Status

Accepted, 2026-08-29

## Context

`domain`/`app` need predictable error handling, testability with fakes, and immutability
discipline. `Effect` (Effect.ts) is a popular option for this in the 2026 TypeScript ecosystem,
offering typed errors, dependency injection, and structured concurrency. Obsidian plugins run
inside a synchronous, callback-driven host (commands, event handlers, `processFrontMatter`
callbacks) with a hard bundle-size budget (~150 kB minified, see `docs/CONVENTIONS.md`).

## Decision

Use plain TypeScript: functions and immutable data, an in-house `Result<T, E>`/`Option<T>` for
fallibility, and ports (plain interfaces) for dependency injection instead of a runtime DI
container. No Effect anywhere in the codebase.

## Consequences

Positive:
- Zero added runtime dependency and its bundle cost against a tight budget.
- No fiber runtime / effect-system learning curve for contributors; code reads as ordinary
  TypeScript, matching how the rest of an Obsidian plugin (synchronous callbacks, `async`/`await`)
  is written.
- Ports-as-interfaces plus fakes in tests gets most of the testability benefit Effect's DI would
  give, without the ceremony.

Negative:
- No built-in structured concurrency, retries, or typed-error composition helpers — anything like
  that is hand-rolled if it's ever needed.
- `Result`/`Option` are hand-maintained (small, but still code and tests obtask owns rather than a
  library's).

## Alternatives considered

- **Effect for the domain layer only.** Rejected: still pulls in Effect's core runtime as a
  dependency for a codebase whose core logic (frontmatter parsing, bucketing, recurrence math) is
  synchronous and doesn't need fibers/schedules; the ergonomic win didn't justify the bundle cost
  or the mixed style at the `app`/`adapters` boundary where Obsidian's own async callbacks take
  over anyway.
- **Effect throughout (including adapters/views).** Rejected: Effect's runtime plus its ecosystem
  packages sit roughly in the 50–100 kB gz range on their own, which alone consumes a large
  fraction of the ~150 kB total bundle budget; combined with Event Calendar (~35 kB gz) and rrule
  (~13 kB gz) it would blow the budget. Obsidian's plugin host is a synchronous callback model
  (commands, `processFrontMatter`, DOM events) that doesn't benefit from a fiber-based runtime.
