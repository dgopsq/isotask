# 0002. Frontmatter marker identifies a task

## Status

Accepted, 2026-08-29

## Context

The plugin needs to decide, for an arbitrary note, whether it is a "task" it should manage. This
could be based on folder location, a tag, a frontmatter property, or some combination.

## Decision

A note is a task iff a configurable frontmatter key equals a configurable value (default
`type: task`). No folder or tag requirement. All task data — status, due, scheduled, duration,
repeat, project, tags, created, completed — lives in frontmatter properties using Obsidian's own
property types, so the Properties view and Bases editors work on task data unchanged.

## Consequences

Positive:
- Task-ness travels with the note regardless of where it lives in the vault or how it's tagged
  for other purposes; users keep their own folder/tag conventions.
- Frontmatter properties are natively typed, editable, and filterable by Obsidian and by Bases
  with zero plugin-specific UI for the base case.
- Trivially greppable/scriptable by other tools (Dataview, templater, etc.) since it's plain
  frontmatter, not a plugin-private format.

Negative:
- Requires every consuming view/command to run the frontmatter through the domain parser rather
  than trusting a folder or tag as a cheap pre-filter.
- Marker key/value being user-configurable means two vaults can define "task" differently;
  settings must be migrated carefully if the marker changes.

## Alternatives considered

- **Folder-based** (e.g. everything under `Tasks/`). Rejected: forces a folder convention on the
  user and breaks if a task note is filed elsewhere for organizational reasons unrelated to being
  a task.
- **Tag-based** (`#task`). Rejected: tags are also used for other taxonomies by users; conflates
  "this note is a task" with "this note is tagged task", and tags don't carry typed data the way
  a frontmatter property does.
