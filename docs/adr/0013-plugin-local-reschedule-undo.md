# 0013. Plugin-local undo for calendar reschedules

## Status

Accepted, 2026-08-30

## Context

A calendar drag or resize rewrites a task's `due`/`scheduled`/`duration` in one gesture, with no
confirmation step. A misdrop is easy and, until now, irreversible except by retyping the old date
from memory — the user's instinct is Cmd+Z, and nothing happened.

Obsidian exposes no application-level undo to hook into: `Editor.undo()`/`redo()` are CodeMirror
history on a focused editor, and `HistoryHandler` and `WorkspaceLeaf`'s `history` flag are
*navigation* back/forward, not content. Reschedules are written with `processFrontMatter`, a
vault-level write, and the task note is usually not open when it is dragged — so there is no
editor and no history for the write to land in.

## Decision

The plugin owns a bounded, session-only undo/redo stack for reschedules, split along the
functional-core/imperative-shell line: `domain/history.ts` is a pure generic `History<T>`
(`record`/`takeUndo`/`takeRedo`/`pushUndone`/`pushRedone`, oldest entries evicted past a limit of
20, `record` clearing the redo branch); `adapters/history/` holds the one mutable field; the
`RescheduleHistory` port is on `AppDeps`.

`rescheduleTask` reads `rawFrontmatter` before writing and returns a `RescheduleEntry` carrying the
inverse patch (`undo`) alongside what it wrote (`redo`). A key that did not exist before inverts to
`null`, which `TaskStore.updateProperties` treats as a removal.

Undo is **guarded, not blind**: before applying an inverse patch, `app/undo-reschedule.ts`
re-reads the note and compares every key against the value the gesture wrote. If any differs, the
note was edited in between; the entry is dropped and the user is told, rather than clobbering the
newer edit. Absent and `null` compare equal; a non-primitive value counts as changed.

The keystroke is claimed only while the calendar has focus, via a `Scope` parented to `app.scope`
and pushed/popped on `focusin`/`focusout`. Two palette commands expose the same use-cases with no
default hotkey, which is also the mobile path.

## Consequences

Positive:
- A misdropped event is one keystroke from being restored, with the exact prior values.
- The staleness check means undo can never silently overwrite a newer manual edit.
- The pure stack is testable without a vault, and is generic enough to cover other actions later.

Negative:
- Two undo systems now exist: Cmd+Z in the calendar does not chain with Cmd+Z in an editor, and
  undoing a reschedule then focusing the note's editor gives an unrelated history.
- The stack is memory-only, lost when the view is destroyed or Obsidian restarts, and an undo is
  itself a frontmatter write — it shows up in file history as a modification, not a reversal.
- Focus-scoped keys mean Cmd+Z does nothing until the calendar has been interacted with. A drag or
  resize has to take focus back explicitly, because Event Calendar's drag ghost drops focus to
  `document.body` — otherwise the keystroke is dead at the one moment an undo exists.

## Alternatives considered

- **Reuse Obsidian's undo.** Rejected as impossible, not merely awkward: there is no app-level
  history API, and the target note usually has no open editor to hold one (see Context).
- **An undo library** (`redux-undo`, `undo-manager`, immer's inverse patches). Rejected: the stack
  is ~40 lines of pure code, and no library helps with the two parts that are actually hard — the
  staleness check and inverting an absent key to `null`. A runtime dependency also costs bundle
  size in a plugin shipped as one `main.js`.
- **Blind undo with no staleness check.** Rejected: silently reverting an edit the user made after
  the drag is a worse failure than refusing to undo.
- **Persisting the stack across restarts.** Rejected for now: it invites applying a stale inverse
  to a note that has moved on across sessions, for a case (undo after a restart) nobody expects.
