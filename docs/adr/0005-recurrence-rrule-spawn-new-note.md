# 0005. Recurrence via RRULE, spawn a new note

## Status

Accepted, 2026-08-29

## Context

Isotask needs recurring tasks (e.g. "every Monday"). Two design axes: (a) what grammar describes
the recurrence, and (b) what happens to the note when a recurring task is completed — advance the
existing note in place, or create a new note for the next occurrence and keep the completed one as
history.

## Decision

Recurrence is expressed as an RFC 5545 RRULE body (no `DTSTART`; anchor = `due` else `scheduled`),
parsed/evaluated with the `rrule` npm package (~13 kB gz, no `Temporal` dependency). Completing a
recurring task spawns the **next occurrence as a new note**, copying the completed note's body as
the series template; the completed note is left untouched as history. Filename and spawn rules
are in `docs/DOMAIN-MODEL.md`.

## Consequences

Positive:
- RRULE is a well-understood, testable, standard grammar; `rrule` is a mature, actively
  maintained library with no exotic runtime requirements.
- Spawn-new-note keeps a full history of completed occurrences as separate notes (each with its
  own `completed` timestamp, its own body edits from that occurrence), which advance-in-place
  cannot represent.
- No `Temporal` dependency — Obsidian's Electron shell and mobile WebKit/Chromium builds cannot be
  assumed to have native `Temporal` (see ADR 0008).

Negative:
- Each occurrence is a new file; a long-running daily task accumulates many notes over time
  (mitigated by future "archive folder on completion", a later idea).
- Editing a future occurrence's body independently of the series template requires deliberate
  per-note edits (there's no cross-occurrence body sync) — acceptable since each occurrence is
  meant to be its own record.

## Alternatives considered

- **Advance-in-place** (mutate the same note's `due`/`scheduled` forward, no new file). Rejected:
  destroys the record of when each occurrence was actually completed, which conflicts with the
  goal of task notes as durable history.
- **Natural-language recurrence grammar** ("every other Tuesday"). Rejected for v1: harder to
  parse unambiguously and round-trip through a raw-RRULE fallback field; deferred as a later idea
  once the RRULE-based core is proven (see `docs/ROADMAP.md`).
- **`rschedule`.** Rejected: unmaintained at the time of this decision.
- **`rrule-temporal`.** Rejected: depends on `Temporal`, either natively or via polyfill; Chromium
  versions below 144 (which Obsidian's mobile/desktop Electron builds can still ship) lack native
  `Temporal`, and a polyfill adds weight the plain `rrule` package avoids entirely.
