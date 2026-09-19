# 0020. Reminders: the `remind` property, anchor, and ids

## Status

Accepted, 2026-09-18

Delivery-tiers paragraph superseded by ADR 0021 (2026-09-19); the property, anchor and id
decisions stand.

## Context

A task's `due`/`scheduled` sits in frontmatter, but nothing ever reminds the user of it.
Obsidian exposes no notification API a plugin can hook into, and mobile Obsidian has no
background execution, so a reminder can't simply be "a timer the plugin runs" — it has to be
pushed from somewhere that keeps running when the vault is closed. [ntfy](https://ntfy.sh) was
chosen as that push channel: self-hostable, no account, works from any device that can receive
a web push or poll a topic. The delivery mechanics (wave 2+) must work against plain `ntfy.sh`,
not just a bleeding-edge self-hosted instance, so this ADR's ids and semantics can't assume a
specific server version.

## Decision

- **`remind` frontmatter property**: a scalar or list of tokens — `none`; `0` (at the anchor);
  an offset `<n>m`/`<n>min`, `<n>h`, `<n>d`, `<n>w` before the anchor; or a full ISO local
  datetime (an absolute reminder, independent of the anchor). A bare number counts as minutes.
  `none` anywhere in a list wins over every other entry. Canonical serialized form is always a
  list of the largest unit that divides evenly (`domain/reminders.ts#formatReminderSpec`).
- **Anchor**: `scheduled` if present, else `due` — the reverse of `repeat`'s anchor (ADR 0005:
  `due`-then-`scheduled`). Recurrence anchors on the date a task is *due by*; a reminder anchors
  on when the user meant to *act*, which is `scheduled` when it's set.
- **Defaults**: with no `remind` property at all, every dated open task reminds once, at the
  anchor's own time if it has one, else at a configurable time-of-day (`ReminderDefaults`,
  default `09:00`). This is opt-out (`remind: none`), not opt-in, so existing vaults get
  reminders without editing every note.
- **Ids**: `isotask-<hex djb2a(path|anchorKind|canonicalSpec)>` — hashes the anchor's *kind*, not
  its date, so rescheduling `due`/`scheduled` keeps the id (a later push replaces, not duplicates).
- **Delivery tiers**, consumers of these ids in later PRs, named here so the id scheme is
  designed for all three up front: (1) live firing from a running desktop instance polling
  `dueReminders`; (2) opt-in schedule-ahead up to ~3 days via ntfy's `at`/`delay`, no
  replace/cancel; (3) opt-in ntfy ≥ 2.16 sequence ids, unlocking replace/cancel on reschedule.

## Consequences

Positive:
- Works against a plain `ntfy.sh` topic from day one (tier 1); tiers 2/3 are strictly additive.
- One id scheme serves all three tiers — no later migration of stored ids.
- Reminders default on, so the feature is immediately useful without per-task setup.

Negative:
- Tier 1 only fires while a desktop instance is running and polling; closing Obsidian (or
  mobile-only use) misses reminders until tier 2/3 ship.
- The anchor reversal (reminders: `scheduled`-then-`due`; recurrence: `due`-then-`scheduled`) is
  a second rule to keep straight when reading `transitions.ts` next to `reminders.ts`.

## Alternatives considered

- **Absolute reminders only (no offset).** Rejected: goes stale the moment `due`/`scheduled` is
  rescheduled — the whole point of an offset is that it moves with the anchor.
- **A separate reminder note/store.** Rejected: violates one-note-one-task (ADR 0002);
  frontmatter is the plugin's only data store.
- **Rely on ntfy ≥ 2.16 features unconditionally.** Rejected: excludes anyone on `ntfy.sh` or an
  older self-hosted server; tiering keeps a basic push working everywhere and treats the newer
  features as an upgrade, not a requirement.
