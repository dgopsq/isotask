# 0021. Reminders require ntfy >= 2.16 and reconcile from every client

## Status

Accepted, 2026-09-19. Supersedes the delivery-tiers paragraph of ADR 0020.

## Context

ADR 0020 named three delivery tiers so the id scheme would fit all of them, but only tier 1 (live
firing from a running desktop instance) shipped, and it has real gaps: it only fires while a
desktop instance is open and polling, so mobile-only use or a closed laptop misses reminders
entirely; it has no cancel, so a task completed after its reminder was queued still pings; and its
per-device ledger lets two desktops on the same topic double-push. ntfy >= 2.16 adds sequence ids
(`X-Message-ID`): a publish under a known id replaces the held message instead of duplicating it,
a held message can be cancelled by id, and held/recent messages can be listed back — exactly what
a reconcile-from-any-client design needs, with no per-device ledger.

## Decision

Reminders require an ntfy server running >= 2.16 (ntfy.sh qualifies); there is no lower-tier
fallback. Every client — desktop or foreground mobile — runs `app/reconcile-reminders.ts`: poll
the topic for known held/recent messages, compute the desired set (every reminder instance with
fire time in `(now - catchUpMinutes, now + lookaheadHours]` over open tasks) with
`domain/reminder-plan.ts#planReminders`, sending the reminder id as the ntfy sequence id. A
desired reminder unknown to the server, or known under a different time, is published —
immediately (no `Delay`) within a minute of now (the catch-up path), otherwise delayed to its fire
time; republishing under the same id replaces the held message, which is how a moved
`due`/`scheduled` reschedules its reminder. Held messages with our id prefix that are no longer
desired (task done/deleted, `remind` removed) are cancelled by id; foreign ids are untouched. The
poll response is the ledger, so `LocalState` and the fired-reminder local-storage ledger are
deleted, and mobile's "Notice instead of push" path is gone. Reconcile runs once indexing settles
after startup, every 15 minutes, on focus/visibility, and debounced 5 s after a task note changes,
is deleted, or is renamed. Lookahead (default 72 h) is clamped to ntfy's 3-day `Delay` cap
(self-hosted raises it via `message-delay-limit`); an undocumented 400 on a delayed publish
halves it for the session (floor 1 h) and notices once.

## Consequences

Positive:
- Reminders fire the same way whether the client was closed for a day or never closed, and two
  clients on the same topic converge instead of double-pushing: the poll is the ledger.
- Reschedule and cancel both work: a moved anchor replaces its held message, a completed or
  deleted task's held message is cancelled before it fires.

Negative:
- Anyone below ntfy 2.16 cannot use reminders at all; the requirement is stated in settings and
  the README, not auto-detected (see alternatives).
- Two clients reconciling within the same few hundred ms can both publish the same id — at worst
  a duplicate alert, since the second publish is a replace. A delivered notification is not
  recalled if the task is completed afterwards.

## Alternatives considered

- **Keep the tiers, auto-detect 2.16 and upgrade silently.** Rejected: a pre-2.16 server ignores
  `X-Message-ID` without error, so only a throwaway probe detects it, and a normal reconcile can't
  run that probe every cycle without risking a duplicate on that same server.
- **Ship tier 2 (schedule-ahead, no sequence ids) instead.** Rejected: without replace/cancel, a
  task finished or rescheduled after its reminder is queued still fires at the old time.
- **Keep tier 1 as a fallback when the server is older.** Rejected: two code paths and two ledgers
  to keep honest, for a mode that already misses reminders whenever the desktop is closed.
