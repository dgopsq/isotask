# 0008. Dates as ISO strings with date-fns

## Status

Accepted, 2026-08-29

## Context

`domain`/`app` need a date representation for frontmatter values (`due`, `scheduled`, `created`,
`completed`) and for date arithmetic (buckets, recurrence shifting). Obsidian bundles `moment` and
uses it internally and in its own date/datetime property editors. Native `Temporal` is a cleaner
modern API but not universally available in Obsidian's runtime targets.

## Decision

Domain dates are branded ISO 8601 strings (`IsoDate`, `IsoDateTime`), local wall-clock, no
timezone suffix, matching the frontmatter format exactly (`docs/DOMAIN-MODEL.md`). Arithmetic uses
`date-fns` (tree-shaken). `Date` objects are constructed only at the boundaries that require them
— `rrule` evaluation and the Event Calendar adapter — never stored in domain state.

## Consequences

Positive:
- Domain values round-trip to/from frontmatter with no conversion — the branded string *is* the
  storage format, eliminating a whole class of "which format is this in right now" bugs.
- `date-fns` functions are pure and tree-shake well, keeping bundle cost proportional to what's
  actually used (against the ~150 kB budget).
- Immutable by construction (strings), which fits the "no classes, `readonly` everywhere" rule in
  `docs/CONVENTIONS.md`) far better than `moment`'s mutable objects.

Negative:
- Every arithmetic operation pays a parse-string -> compute -> format-string round trip rather
  than operating on a richer date object directly; acceptable given the volumes involved (task
  lists, not high-frequency data).
- Two boundary conversions to maintain (`rrule`'s `Date`, the calendar adapter's `Date`) instead
  of one uniform type throughout.

## Alternatives considered

- **Obsidian's bundled `moment`.** Rejected: free (already in the bundle) but its objects are
  mutable, which conflicts with the "readonly everywhere" functional-core discipline the rest of
  `domain`/`app` follows; using it would mean either wrapping it defensively everywhere or
  accepting a mutability hole in an otherwise immutable core.
- **Native `Temporal`.** Rejected for the same reason as in ADR 0005/0006: Obsidian's Electron
  shell and mobile WebView targets cannot be assumed to have native `Temporal` support (Chromium
  below version 144 lacks it), and a polyfill's weight isn't justified when ISO strings plus
  `date-fns` already satisfy every requirement.
