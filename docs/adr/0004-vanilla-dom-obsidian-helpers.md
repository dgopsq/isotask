# 0004. Vanilla DOM via Obsidian helpers, no UI framework

## Status

Accepted, 2026-08-29

## Context

The feed view, calendar chrome, and modals (task create, date picker, recurrence picker, status
menu) need UI. Obsidian's own plugin ecosystem and its own core UI are built on vanilla DOM plus a
set of helper methods (`createEl`, `Setting`, `Menu`, `Modal`, `setIcon`) rather than a component
framework, and the bundle budget is tight (~150 kB minified total).

## Decision

Build all isotask UI with Obsidian's own DOM helpers (`createEl`/`createDiv`/`createSpan`,
`Setting`, `Menu`, `Modal`, `setIcon`). No React/Svelte/Vue/etc. for isotask's own UI code. (The
Event Calendar adapter, per ADR 0006, brings its own internal rendering — that is opaque to the
plugin, isolated behind the `CalendarRenderer` port.)

## Consequences

Positive:
- No framework runtime added to the bundle; the whole budget stays available for functional
  dependencies (rrule, date-fns, valibot, Event Calendar).
- Visual and interaction consistency with Obsidian core and other well-behaved plugins that use
  the same helpers (`Setting` rows, `Menu` styling, theme variables) for free.
- No framework-specific reactivity model to reconcile with Obsidian's own lifecycle
  (register/unload, `MarkdownRenderer`, `MetadataCache` events).

Negative:
- No declarative component model or built-in reactive state; view updates (e.g. re-rendering a
  feed row after a status change) are done by explicit DOM manipulation in `ui`/`views` code.
- More boilerplate for anything with nontrivial local state (e.g. a multi-step modal) than a
  framework component would need.

## Alternatives considered

- **Svelte** (used internally by Event Calendar itself). Rejected: adds a compiler/runtime
  dependency and a second UI paradigm alongside Obsidian's own helper-based style, for UI that
  Obsidian's own `Setting`/`Menu`/`Modal` already cover well; the plugin's own UI surface (feed
  rows, a handful of modals) is small enough that vanilla DOM is not a maintenance burden.
- **React.** Rejected: same reasoning as Svelte, plus a larger bundle-size cost than Svelte would
  add, against a tight budget already spent mostly on functional dependencies.
