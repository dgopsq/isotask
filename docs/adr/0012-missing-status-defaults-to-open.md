# 0012. Missing status defaults to the first open status

## Status

Accepted, 2026-08-30. Superseded by 0017 (status kinds) for the status-table/kind list; this
ADR's default-to-open rule for a missing `status` still applies.

## Context

The Bases toolbar's `+ New` button creates a note whose frontmatter is inferred from the base
file's filters (`==`, `contains`, `hasTag`, `inFolder`, `hasProperty`, `isEmpty` — never `!=`,
verified against Obsidian 1.13.7). The generated `Tasks.base` filters on `type == "task"` and
`status != "done"`, so `+ New` can only ever infer `type: task` — never a `status`,
because every status filter it could read is a `!=`. This button is owned by Bases' own
`QueryController` and cannot be intercepted by a custom `BasesView`, so the resulting note always
lands with no `status` property. `domain/frontmatter.ts#parseTask` treated that as a hard
`missing-status` error, so every note `+ New` creates shows up in the feed as a red "could not be
parsed" row — the plugin's own toolbar button appears to produce broken tasks.

## Decision

A missing or empty `status` is no longer a parse error: `parseTask` now defaults it to the first
configured `open`-kind status, the same status `app/create-task.ts` and `domain/transitions.ts`'s
reopen path already use as "the" open status. This is a lenient-parse fold in the spirit of ADR
0010 (whitespace, status-label, numeric-duration, ...), not a new precedent — it just extends the
existing "unambiguous variant -> accepted" list to "absent -> the obvious default" for this one
field. The `TaskParseError` variant this replaces is renamed `missing-status` -> `no-open-status`
and now only fires when there is no `open`-kind status configured at all (a real configuration
error, not a normal `+ New` artifact). `unknown-status` (a present-but-unrecognized value) is
untouched — still a hard error. Per ADR 0010, parsing never writes the resolved value back; the
next write of any kind through `app/*`'s existing patch paths (e.g. `taskToPatch`, `setStatus`)
persists the real status, same as every other canonicalized field.

## Consequences

Positive:
- `+ New` from the Bases toolbar produces a task that parses cleanly as an open task instead of a
  visibly broken row — the plugin's own generated base stops looking buggy out of the box.
- Reuses an existing concept (`firstOpenStatus`) instead of introducing new status-resolution
  logic.

Negative:
- A note with a genuinely forgotten `status` (e.g. hand-deleted by a user) now silently becomes
  "open" instead of surfacing as an error — trades a hard failure for a permissive default,
  matching ADR 0010's existing trade-off for other fields.

## Alternatives considered

- **Keep the hard error and rely on the task linter's future "Fix" action.** Rejected: no such
  linter exists yet (ADR 0010 defers it), and even once it does, `+ New` would keep looking broken
  until the user manually invokes it — the toolbar button should work out of the box.
- **Ship a `.base`-adjacent template so `+ New` infers a real status.** Rejected: Bases' new-note
  inference only reads `==`/`contains`/`hasTag`/`inFolder`/`hasProperty`/`isEmpty` filters, and the
  base intentionally filters open tasks with `!=`; requiring the user to additionally set up and
  maintain a note template just to work around that is more setup than a lenient default.
