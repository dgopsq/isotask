# 0017. Two status kinds: open and done

## Status

Accepted, 2026-09-02

## Context

The original status model (ADR 0012's era) shipped four kinds — `open`, `active`, `done`,
`cancelled` — plus a full status-management UI: a settings modal to add/edit/reorder/delete
statuses, a status dropdown on task creation and the task panel, a "Set status…" command backed
by a fuzzy suggest modal, and a "Cycle status" command that walked the configured list in order.
In practice only one distinction was ever load-bearing anywhere in the domain or UI: is the task
done or not. `isTerminal` collapsed `done`/`cancelled` to the same boolean; recurrence only ever
spawned on entering `done`; the feed's status control only ever rendered checked/unchecked. The
`active` and `cancelled` kinds, and every affordance for picking a status by hand, existed without
a use that depended on the distinction. Diego decided (2026-09-02) to cut the model down to what
was actually used.

## Decision

`StatusKind` is `"open" | "done"`. `isTerminal(kind)` is now simply `kind === "done"`. Every
user-facing way to pick or configure a status is removed: the settings "Manage statuses…" modal,
the "Set status…" and "Cycle status" commands, the create-task modal's status dropdown, and the
task panel's status dropdown are all gone. The sole remaining status control is a single toggle —
"Mark as done" / "Reopen" in menus, a "Done" toggle in the task panel, the feed's existing
checkbox-style status circle — driven by `domain/status.ts#toggleStatus`, which is unchanged in
shape (still resolves to the first configured `open`/`done` status). A new task always gets the
first configured `open` status; there is no way to create a task with any other status.

The `status` frontmatter string and the internal configured-status list (`StatusConfig[]`, with
`id`/`label`/`kind`/`icon`) are kept as-is, and remain data in settings with no UI to edit them —
the domain abstraction (multiple named statuses collapsing to two kinds) survives for a possible
future extension, but nothing in this plugin currently offers a way to add a third status. A
status value that doesn't resolve to any configured id is still an `unknown-status` parse error,
shown in the feed's Errors group — unchanged from before. `StatusConfigSchema.kind` in
`domain/settings.ts` is restricted to `v.picklist(["open", "done"])`; a persisted status list
containing any other kind (including a pre-upgrade `active`/`cancelled` entry) fails validation as
a whole and falls back to `DEFAULT_STATUSES`.

## Consequences

Positive:
- Removes a large surface of UI (a modal, two commands, two dropdowns) that had no behavior
  depending on the distinctions it offered.
- `isTerminal` and `toggleStatus` become simpler and have fewer states to reason about or test.
- The status list staying data-only (rather than being deleted outright) keeps `findStatus`,
  `firstOpenStatus`, `firstDoneStatus`, and the whole `StatusConfig` plumbing unchanged, so a
  future reintroduction of a third kind wouldn't require re-threading every call site.

Negative:
- There is no way to "cancel without spawning a recurrence occurrence" anymore — `cancelled`'s one
  distinct behavior (terminal, but never spawns) is gone along with the kind. The equivalent move
  today is to delete the note, or to remove `repeat` before marking it done.
- A pre-upgrade `data.json` with a custom status list that includes an `active`/`cancelled` kind
  silently reverts to `DEFAULT_STATUSES` on next load (per `domain/settings.ts`'s existing
  whole-list-fallback behavior, ADR-independent) rather than migrating those entries — any custom
  labels/icons on such a list are lost.

## Alternatives considered

- **Keep the four kinds, just remove the UI.** Rejected: the domain code (`isTerminal`,
  `nextStatusInCycle`, the four-way CSS modifiers) still had to carry cases for `active`/
  `cancelled` that nothing produced, which is the same maintenance cost as the kinds without the
  matching benefit of a real behavioral difference.
- **Drop the status list and `StatusConfig` entirely, hardcoding `"todo"`/`"done"` ids.** Rejected:
  the property-key setting for `status` and the parse/canonicalize machinery already key off
  `StatusConfig`; hardcoding would remove the (currently unused, but cheap-to-keep) ability to
  rename the two default ids/labels via settings, for no simplification benefit big enough to
  justify the churn.
