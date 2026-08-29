# Roadmap

This design was decided on 2026-08-29. Milestones are sequential; each depends on the previous
one being functionally complete.

## M0 — Bootstrap

- [ ] Toolchain (package.json, tsconfig, esbuild config, eslint, vitest) in place.
- [ ] Repo docs and ADRs written (this doc set).
- [ ] Layer skeleton (`domain`, `ports`, `app`, `adapters`, `views`, `ui`, `settings`, `styles`)
      created with the import-boundary lint rules enforced.
- [ ] Domain types (`Task`, `TaskDraft`, `TaskParseError`, branded primitives) implemented.
- [ ] Frontmatter parser implemented and tested.
- [ ] Feed buckets (`domain/buckets.ts`) implemented and tested.
- [ ] Recurrence (`domain/recurrence.ts`) implemented and tested.
- [ ] Stub `obtask-feed`/`obtask-calendar` views registered (no real rendering yet).

## M1 — Core actions

- [ ] Settings type, defaults, migration, and `SettingsTab`.
- [ ] `TaskStore` adapter over Vault/MetadataCache/`processFrontMatter`.
- [ ] Create task / convert note to task commands.
- [ ] Set status / complete task / cycle status commands.
- [ ] Set due date / set scheduled date / set recurrence commands.
- [ ] Completion-triggers-spawn wired end to end (`app/setStatus.ts` -> recurrence -> `TaskStore.create`).

## M2 — Feed view

- [ ] Full feed rendering: outer Bases groups, inner time buckets, row layout (status control,
      title link, date/priority chips, project link, tags).
- [ ] Feed view options (date source, show empty buckets, show completed at bottom).
- [ ] Row actions: status menu, date modal.
- [ ] "Create tasks base" command generates `Tasks.base`.

## M3 — Calendar (read-only)

- [ ] `CalendarRenderer` port finalized.
- [ ] Event Calendar (`@event-calendar/core`) adapter implementing the port.
- [ ] Event derivation (`scheduled`/`due` events per the `events` view option).
- [ ] Theming: Event Calendar CSS variables mapped to Obsidian theme variables
      (`src/styles/calendar.css`); priority-to-color mapping.
- [ ] Calendar view options (initial view, events source, first day of week).

## M4 — Calendar interactions

- [ ] Click event -> open note.
- [ ] Drag/resize (desktop) -> `rescheduleTask` use-case.
- [ ] Long-press + drag (touch) -> same reschedule path.
- [ ] Click empty slot -> create-task modal pre-filled with the clicked date.
- [ ] Touch QA pass.

## M5 — Release

- [ ] Mobile QA across the full feature set.
- [ ] e2e suite (`wdio-obsidian-service`) against a fixture vault.
- [ ] GitHub Actions release workflow triggered on tag.
- [ ] Community plugin submission.

## Later ideas (not scheduled)

- Natural-language recurrence input.
- `recurs_from` link chain (linking a spawned occurrence back to its series).
- Time estimate property.
- Archive folder on completion.
- Daily-note "today" embed.
- URI handler (`obsidian://obtask/new`).
- Kanban Bases view (Bases can already do a kanban-ish board via `groupBy`).
- Live Preview status widget on task links.
