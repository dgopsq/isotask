# 0018. Reconcile `completed` with `status` on any metadata change

## Status

Accepted, 2026-09-13

## Context

`completed` is only ever written by `domain/transitions.ts#applyStatusChange`, called from
`app/set-status.ts` — the plugin's own status-setting use case, reached via the feed toggle, the
task panel, menus, and commands. When a user (or an AI agent) instead edits `status: done` directly
in frontmatter — the Properties view, an external editor, `git`, an Obsidian CLI script — none of
that runs: `completed` stays unset and, for a recurring task, no next occurrence spawns. The reverse
also drifts: hand-editing `status` back to an open value leaves a stale `completed` behind.

## Decision

The plugin listens for `metadataCache` `changed` on every task note and reconciles `completed`
with `status`, regardless of what wrote the change:

```
status kind   completed   -> action
done          absent      -> apply the done transition (completed = now, spawn if repeat+anchor)
open          present     -> clear completed (patch { [keys.completed]: null })
done          present     -> no-op (already consistent)
open          absent      -> no-op (already consistent)
```

`domain/completion-drift.ts#completionDrift` is the pure decision function (`Task` + the
configured `StatusConfig[]` in, `"complete" | "reopen" | "none"` out). The "complete" case reuses
`domain/transitions.ts#applyStatusChange` — the same patch/spawn computation `app/set-status.ts`
uses — rather than duplicating it: `applyStatusChange` gained a `force?: boolean` input that skips
its existing same-status short-circuit (the task is already at its done status; only `completed`
and the spawn are missing). `app/set-status.ts`'s write/spawn/idempotency logic was factored into
`makeWriteStatusTransition`, called by both `makeSetStatus` and the new
`app/reconcile-completion.ts#makeReconcileCompletion`. The "reopen" case just writes the null patch
directly — no transition or spawn involved. A task that fails to parse (`invalid-task`) is ignored,
same as every other read-time parse error elsewhere in the plugin.

`adapters/obsidian/completion-watcher.ts#registerCompletionWatcher` wires this to
`plugin.app.metadataCache.on("changed", ...)`, filtering to markdown task notes and guarding
re-entrancy with an in-flight `Set<TaskPath>` — `reconcile`'s own write re-fires `changed` for the
same path before the call resolves, and by then `completed` already matches `status`, so the
re-entrant event is a safe no-op even without the guard, which exists to avoid two concurrent reads
of the same note racing each other's write.

This only reacts while Obsidian is running: there is deliberately no vault scan on plugin load, per
the plugin's existing narrow-enumeration policy (`README.md`'s "What the plugin reads", commit
62dcd8f). A note edited while Obsidian is closed (synced in externally, edited via CLI with the
vault unopened) only reconciles once it's next opened and the file's metadata is (re)cached — which
happens for every note Obsidian indexes on startup, not only ones a Bases view queries, but the
watcher itself is still a live-event listener, not a scan the plugin runs itself.

## Consequences

Positive:
- `status: done` set anywhere frontmatter can be edited now behaves identically to using the
  plugin's own toggle — `completed` and recurrence spawning both follow, closing the gap this ADR
  was written for.
- No duplicated transition logic: the same `applyStatusChange` + `makeWriteStatusTransition` code
  path serves both the plugin's own UI and external edits, so the idempotent-spawn and
  completed-patch behavior can't drift between the two.

Negative:
- Reconciliation is event-driven only; a change made while Obsidian isn't running takes effect on
  the next metadata cache update for that note, not immediately when the file changes on disk.
- Every task note's every metadata change now runs one extra read + drift check, even when nothing
  is actually inconsistent — cheap (in-memory cache reads, no vault enumeration) but non-zero.

## Alternatives considered

- **Scan the vault for drifted tasks on plugin load.** Rejected: the plugin has an explicit,
  documented policy of never enumerating the vault beyond what a picker or an open Bases view
  needs (README "What the plugin reads", commit 62dcd8f's "narrow vault enumeration") — a startup
  scan of every note is exactly the kind of unbounded read that policy rules out.
- **Duplicate the patch/spawn logic inside `reconcile-completion.ts` instead of extending
  `applyStatusChange`.** Rejected: recurrence spawning and its idempotency check are fiddly enough
  (see ADR 0005) that two copies would inevitably drift; a `force` flag is a smaller surface than a
  second implementation.
