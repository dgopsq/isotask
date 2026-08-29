# Roadmap

This design was decided on 2026-08-29. Milestones are sequential; each depends on the previous
one being functionally complete.

## M0 — Bootstrap

- [x] Toolchain (package.json, tsconfig, esbuild config, eslint, vitest) in place.
- [x] Repo docs and ADRs written (this doc set).
- [x] Layer skeleton (`domain`, `ports`, `adapters`, `views`, `settings`, `styles`) created with the
      import-boundary lint rules enforced. (`app` and `ui` are created in M1, once there's a
      use-case to put in them.)
- [x] Domain types (`Task`, `TaskParseError`, branded primitives) implemented.
- [x] Frontmatter parser (`parseTask`/`isTaskNote`) implemented and tested.
- [x] Feed buckets (`domain/buckets.ts`) implemented and tested.
- [x] Settings type, defaults and `parseSettings` (valibot, per-field fallback to defaults).
- [x] Minimal `SettingsTab` (task folder, marker key/value, week start).
- [x] `obtask-feed`/`obtask-calendar` Bases views registered and rendering directly from parsed
      tasks (bucket headers + plain rows for the feed; a placeholder count for the calendar) — no
      row actions/menus yet.
- [x] `adapters/obsidian/bases-entries.ts`: maps `BasesEntry[]` to parsed `Task[]` via
      `metadataCache.getFileCache(file)?.frontmatter`.
- [x] e2e with `wdio-obsidian-service` (`e2e/`): launches a real Obsidian window against a fixture
      vault, opens `Tasks.base`, and exercises the Feed and Calendar Bases views. Fixture task
      notes are date-relative (generated per run, see `docs/CONVENTIONS.md`). Not part of
      `pnpm check` — run explicitly via `pnpm test:e2e`.

Deliberately deferred out of M0 (see below): `domain/recurrence.ts`, `domain/transitions.ts`,
`domain/calendar-events.ts`, the whole `app` layer and its use-cases, the `TaskStore` adapter, the
calendar renderer adapter, `ui`, `commands`, and `calendar.css`. `@event-calendar/core` and `rrule`
are not in `package.json` yet — added back when the calendar adapter and recurrence land.

## M1 — Core actions

- [x] `app` layer: use-cases as factory functions over ports (`createTask`, `setStatus`,
      `cycleStatus`, `convertNote`, `setDate`, `setDuration`, `setRecurrence`, plus the pure
      `generateBase#renderTasksBase`), each tested against in-memory fakes (`app/test/fakes.ts`).
      `rescheduleTask` is deferred to M4, where the calendar drag/resize interaction that needs it
      lands.
- [x] Recurrence (`domain/recurrence.ts`, `domain/transitions.ts`) implemented and tested; `rrule`
      is in `package.json`.
- [x] `TaskStore` adapter (`adapters/obsidian/task-store.ts`) over Vault/MetadataCache/
      `processFrontMatter`.
- [x] `ui/` modals and menus: `CreateTaskModal`, `DateModal`, `RecurrenceModal`,
      `StatusSuggestModal`, `status-menu.ts#buildStatusMenu`.
- [x] Create task / convert note to task commands.
- [x] Set status / complete task / cycle status commands.
- [x] Set due date / set scheduled date / set recurrence commands.
- [x] Completion-triggers-spawn wired end to end (`app/set-status.ts` -> `domain/transitions.ts`
      -> `TaskStore.create`).
- [x] Status list is user-configurable in `SettingsTab` (`StatusesModal`: add/edit/reorder/delete).
- [x] File-menu "Set status" entries and the feed row's clickable status control (`Menu` +
      `buildStatusMenu`) for task notes.
- [x] "Create tasks base" / "Open tasks base" commands (`app/generate-base.ts#renderTasksBase`).

## M2 — Feed view

- [x] Full feed rendering: outer Bases groups, inner time buckets, row layout (status control,
      title link, date/priority chips, project link, tags) — upgrading the M0 plain-row rendering.
- [x] Feed view options (date source, show empty buckets, show completed at bottom).
- [x] Row actions: status menu, date modal.
- [x] "Create tasks base" command generates `Tasks.base` (landed in M1).

## M3 — Calendar (read-only)

- [ ] `domain/calendar-events.ts`: `eventsForTask` (pure, tested).
- [ ] `CalendarRenderer` port finalized (already sketched in `src/ports/calendar-renderer.ts`).
- [ ] Event Calendar (`@event-calendar/core`) adapter implementing the port in
      `src/adapters/calendar/` (see that directory's `README.md`); add `@event-calendar/core` back
      to `package.json`.
- [ ] Event derivation (`scheduled`/`due` events per the `events` view option).
- [ ] Theming: Event Calendar CSS variables mapped to Obsidian theme variables
      (`src/styles/calendar.css`); priority-to-color mapping.
- [ ] Calendar view options (initial view, events source, first day of week) — replacing the M0
      placeholder view.

## M4 — Calendar interactions

- [ ] Click event -> open note.
- [ ] Drag/resize (desktop) -> `rescheduleTask` use-case.
- [ ] Long-press + drag (touch) -> same reschedule path.
- [ ] Click empty slot -> create-task modal pre-filled with the clicked date.
- [ ] Touch QA pass.

## M5 — Release

- [ ] Mobile QA across the full feature set.
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
