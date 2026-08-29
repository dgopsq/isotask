# 0010. Lenient parse, canonical write

## Status

Accepted, 2026-08-29

## Context

Task frontmatter is hand-edited as free text in Obsidian's Properties panel, not through a
constrained input. In practice that produces unambiguous but non-canonical values: `"Done"` or
`"done "` for a status whose configured id is `done`, a status *label* (`"In progress"`) typed in
place of its id, `"45"` (a string) for a numeric `duration`, a scalar tag instead of a list, and
dates typed as `2026-09-01 09:00` instead of the canonical `2026-09-01T09:00`. `domain/frontmatter.ts`
previously rejected all of these outright, which made `parseTask` fail and the note disappear from
every Bases view over what is, to the user, an obviously correct value.

Obsidian's Properties panel has no `select`-style property type and no public API to constrain a
property's allowed values (verified against Obsidian 1.13.8 / API 1.13.1) — there is no way to stop
these variants from being typed in the first place, so the domain has to tolerate them after the
fact instead.

## Decision

`domain/canonicalize.ts` exports `canonicalizeFrontmatter(raw, keys, statuses)`, a pure function
that, for each configured property key, either leaves the raw value untouched or computes its
canonical form plus a `CanonicalFix` (`key`, `from`, `to`, `reason`) describing the change. Rules
cover whitespace, status case/label folding, priority case folding, numeric-string durations, a
scalar-to-list `tags` fix, and space/seconds-tolerant date formats — see
`docs/DOMAIN-MODEL.md`'s "Lenient parse, canonical write" section for the exact list.
`domain/frontmatter.ts`'s `parseTask` runs this first and validates the canonicalized frontmatter,
so `TaskParseError`s now only fire on values the canonicalizer could not resolve.

The plugin never writes this patch back to the note automatically. `canonicalizeFrontmatter`'s
output is exposed so a future, explicitly user-triggered linting command can offer the fix (e.g. a
command-palette action or a per-task menu item) — parsing a note is never allowed to have the side
effect of rewriting it.

`TaskParseError`'s `unknown-status` and `invalid-priority` variants gain an `allowed: readonly
string[]` field (the configured status ids / the `Priority` list) so a future UI can offer the
valid choices directly instead of only reporting that the value was wrong.

## Consequences

Positive:
- A typo'd case, an extra space, or a label typed instead of an id no longer makes a task vanish
  from the feed or calendar.
- The fix-reporting shape (`CanonicalFix`) gives a future linter everything it needs — which key,
  what it would become, why — without re-deriving any of this logic.
- `canonicalizeFrontmatter` is pure and total: idempotent on already-canonical input, and it never
  touches a key it doesn't recognize or a key not present in `PropertyKeys`.

Negative:
- Two representations of "this frontmatter" now exist during a parse (raw, canonicalized), which a
  future reader of `frontmatter.ts` needs to keep straight.
- The accepted-variant list is a judgment call about what's "unambiguous"; widening it later
  (e.g. more date formats) is a domain change that competes with keeping parsing predictable.

## Alternatives considered

- **Enforce valid values at write time via a constrained property type.** Rejected: Obsidian has no
  `select`/enum property type and no public API to restrict what a property field accepts (checked
  against Obsidian 1.13.8 / API 1.13.1) — there is nothing in the platform to enforce this against.
- **Auto-rewrite the note's frontmatter the moment a lenient value is parsed.** Rejected: turns a
  read (opening a view) into a silent write, which is surprising and risks fighting the user mid-edit
  in the Properties panel; a user-triggered fix keeps writes deliberate.
- **Keep strict parsing and only improve the error message.** Rejected: still makes the task
  disappear from views for values a human would read as unambiguous, which is the actual problem.
