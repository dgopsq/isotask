# Agent guide: writing tasks into an isotask vault

You are an AI agent (Claude Code, an MCP filesystem server, the Obsidian CLI, or similar) with
write access to an Obsidian vault that uses the **isotask** plugin (`dgopsq/isotask`). You never
see the plugin's source — this file is the whole contract. Read it, then write plain markdown
notes; the plugin does the rest.

## What a task note is

One markdown note = one task. A note is a task purely by frontmatter marker: the key `type` set
to the value `task` (both the key and the value are renameable per-vault, see below). No folder,
tag, or filename convention is required, though a vault typically keeps tasks in a `Tasks` folder.
Every other field lives in frontmatter too — there is no separate database and no query language.

## Get the vault-specific contract first

Property keys, status ids, and the task folder are all renameable per vault. Before writing
anything, get the actual values for this vault:

- Obsidian CLI (desktop, Obsidian running):
  `obsidian eval code="app.plugins.plugins.isotask.api.agentInstructions()"`
- Or ask the user to run the **Copy agent instructions** command from Obsidian's command palette
  and paste the result to you.

Both return the live property keys, configured statuses, and task folder for that vault. If
neither is available (no running Obsidian, no CLI), fall back to the defaults in this file — they
match a freshly installed, unconfigured vault.

## Frontmatter reference (defaults)

| key | type / format | required | notes |
|-----|----------------|----------|-------|
| `type` | text | yes | marker; must equal `task`. Key and value both renameable. |
| `status` | text | no | id from the vault's configured status list. Default open id `todo`, done id `done`. Missing/empty defaults to the first open status — not an error. |
| `priority` | text | no | `normal` \| `high` \| `urgent`. Absent means `normal`. |
| `due` | date/datetime | no | `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. Never a timezone suffix — local wall-clock only. |
| `scheduled` | date/datetime | no | same format as `due`. A timed `scheduled` plus `duration` makes a real calendar block. |
| `duration` | number | no | minutes. Only meaningful with a timed `scheduled`. |
| `repeat` | text | no | RRULE body, no `DTSTART` (e.g. `FREQ=WEEKLY;BYDAY=MO`). Anchored on `due`, else `scheduled`; without either, it never spawns. |
| `project` | text (wikilink) | no | `"[[Project note]]"`. |
| `tags` | list | no | standard Obsidian tags. |
| `created` | datetime | yes | same format as `due`. Set by the plugin on creation through its own UI — if you create a note by hand, set it yourself to the current local time. |
| `completed` | datetime | no | set only when a status enters "done". Do not write this yourself — see Rules. |
| `remind` | text / list | no | reminder(s) before the task's anchor (`scheduled` if set, else `due`). `none`, `0`, an offset (`15m`, `2h`, `1d`, `1w`), or a full datetime. Absent uses the vault's default (usually one reminder per dated task). |

## Canonical example note

```markdown
---
type: task
status: todo
due: 2026-09-20
priority: high
project: "[[Website relaunch]]"
tags: [marketing]
created: 2026-09-13T09:00
---
Draft the launch announcement email.
```

## Recipes

**Create a task.** Write a new note anywhere in the tasks folder with at least `type: task`,
`status: <an open id>`, and `created: <now>`. Add `due`/`scheduled`/`priority`/`project`/`tags` as
needed.

**List open tasks.** Read frontmatter of notes in the tasks folder and keep those whose marker
matches and whose `status` resolves to an open-kind id (missing counts as open). Alternatively,
read the generated base file (default `Tasks.base`) for the vault's own marker/status filters.

**Complete a task.** Set `status` to a done id (default `done`). Leave `completed` alone — the
plugin fills it in on its own, while Obsidian is running.

**Reopen a task.** Set `status` to an open id (default `todo`). The plugin clears `completed`.

**Reschedule.** Edit `due` and/or `scheduled` in place. No other field needs to change.

**Add recurrence.** Set `repeat` to an RRULE body (no `DTSTART`), and make sure `due` or
`scheduled` is set — that's the anchor the recurrence is computed from.

**Set a reminder.** Add `remind` with one or more tokens, e.g. `remind: [1d, 15m]` to remind a
day before and 15 minutes before the task's `scheduled` (or `due` if no `scheduled`). Use
`remind: none` to silence the vault's default reminder for one task.

**Recurring-task rule.** Completing a recurring task (setting its `status` to a done id) spawns
the next occurrence as a new note, but only while Obsidian is running — the plugin does this, you
don't need to. If you must set `completed` yourself because Obsidian is closed (e.g. bulk-editing
files directly), you must also create the next occurrence note yourself: copy the completed note,
clear `completed`, set `status` to an open id, shift `due`/`scheduled` by one RRULE interval, and
name it from the spawn template (default `{{title}} {{due}}`).

## Rules

- Dates are always local wall-clock `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` — never append `Z` or a
  UTC offset.
- Use status ids exactly as configured (get them from `agentInstructions()`), not labels.
- Always set `created` yourself when writing a note by hand.
- Never write `completed` yourself unless Obsidian is closed and you also spawn the next
  occurrence (see above) — otherwise let the plugin own it.
- Never remove or change the marker property on a task note.

## How to check your work

Open the vault's feed view (or its base file) and look at the **Errors** group. Any note that
looks like a task but fails to parse (unrecognized `status`, unparseable `due`/`scheduled`, …)
lands there with the reason. An empty Errors group means everything you wrote parsed correctly.
