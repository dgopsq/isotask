# Agent instructions

## What this is

Isotask is an Obsidian plugin: one markdown note = one task, all task data lives in frontmatter
properties, and every view (feed, calendar) is registered as an Obsidian Bases view. The plugin
adds semantics (status, due, recurrence) and renderers on top of Bases; it owns no data store and
no query language.

## Hard rules

- Strict TypeScript. No `any`. No non-null assertions (`!`). Prefer `import type` for type-only
  imports.
- Functional core / imperative shell: `src/domain` and `src/app` are pure functions over
  immutable, `readonly` data. Side effects (filesystem, Obsidian API, DOM, timers) live only in
  `src/adapters`, `src/views`, `src/ui`, `src/settings`, `src/commands`, `src/main.ts`.
- Layer import boundaries (ESLint-enforced):
  - `src/domain`, `src/ports`, `src/app` must never import `obsidian`, `electron`,
    `@event-calendar/*`, or anything under `src/adapters`, `src/views`, `src/ui`, `src/settings`,
    `src/commands`.
  - Only `src/adapters/calendar/**` may import `@event-calendar/*`. No other file imports it.
- No `innerHTML` anywhere. Use `createEl`/`createDiv`/`createSpan` and Obsidian's `Setting`/`Menu`
  helpers.
- Obsidian plugin guideline compliance (checked at release, see `docs/CONVENTIONS.md`):
  `this.app`, never the global `app`; all listeners via `registerEvent`/`registerDomEvent`/
  `registerInterval`; `normalizePath` for user-supplied paths; no default hotkeys; sentence-case
  UI text; no Node/Electron APIs; no inline styles; frontmatter writes go through
  `app.fileManager.processFrontMatter`, never manual body edits (except spawning a recurrence
  occurrence, which creates a new note).
- CSS: theme variables only (`--background-primary`, `--text-normal`, `--interactive-accent`,
  `--color-*`, …). No hardcoded colors.
- All plugin-defined CSS classes are prefixed `isotask-`.
- The plugin must work on mobile (touch interactions, no desktop-only APIs).

## Commands

- `pnpm dev` — esbuild watch build.
- `pnpm build` — typecheck + production build.
- `pnpm typecheck` — `tsc -noEmit`.
- `pnpm lint` / `pnpm lint:fix` — ESLint.
- `pnpm test` / `pnpm test:watch` — vitest.
- `pnpm test:e2e` — full e2e suite (builds first; `E2E_SCREENSHOT=1` saves screenshots).
- `E2E_GREP="<pattern>" pnpm test:e2e --spec <substring>` — targeted e2e for debug loops:
  grep filters tests by name, `--spec` skips other spec files (each spec file boots its own
  Obsidian window). ~7s instead of ~30s; run the FULL suite once before committing.
- `pnpm check` — typecheck + lint + test + build. Run before finishing any task.

## Where things live

```
src/
  domain/      pure types, frontmatter parse/serialise, statuses, buckets, recurrence, transitions
  ports/       interfaces: Clock, TaskStore, Notifier, CalendarRenderer, PathResolver
  app/         use-cases: createTask, setStatus, rescheduleTask, convertNoteToTask, generateBaseFile
  adapters/
    obsidian/  TaskStore, Clock, Notifier, settings persistence — implement the ports
    calendar/event-calendar/  CalendarRenderer implementation (only importer of @event-calendar/*)
  views/bases/feed/      isotask-feed BasesView (thin: entries -> domain -> render -> dispatch)
  views/bases/calendar/  isotask-calendar BasesView
  views/task-panel/      sidebar ItemView: task fields as a form for the active note
  ui/          DOM renderers + modals (TaskCreateModal, DateModal, RecurrencePicker, StatusMenu)
  commands/    registerCommands: wires every plugin command to an app/ use-case
  settings/    SettingsTab, settings type + defaults + migration
  styles/      isotask.css, calendar.css (theme-variable mappings only)
  main.ts      composition root: builds adapters, registers views/commands/menus/settings
```

## Docs map

- `docs/ARCHITECTURE.md` — hexagonal layout, data flow diagrams, port interfaces, composition
  root, why views never filter.
- `docs/DOMAIN-MODEL.md` — frontmatter schema, statuses, recurrence semantics, feed buckets,
  calendar event derivation, parse-error policy.
- `docs/CONVENTIONS.md` — TypeScript, naming, DOM, Obsidian API, testing, commit style, release
  checklist.
- `docs/ROADMAP.md` — milestones M0–M5 and later ideas.
- `docs/adr/` — architecture decision records, index in `docs/adr/README.md`.

## Workflow expectations

- **Worktrees + PRs**: every task happens on a branch in its own worktree, never directly on
  `main`. `pnpm wt feat/<name>` creates `../isotask.worktrees/feat-<name>` (branched off `main`)
  and installs dependencies there in seconds — pnpm hardlinks from its global store (no
  duplicated packages) and the Obsidian e2e cache is shared across worktrees
  (`~/.cache/isotask/obsidian-cache`, override with `OBSIDIAN_CACHE`). Finish with `pnpm check`
  and the full `pnpm test:e2e`, push, open a PR (`gh pr create`), merge via PR only, then
  `pnpm wt rm <branch>`.
- Run `pnpm check` before finishing any task.
- Do not run `pnpm test:e2e` locally for changes that touch only comments, docs, assets, or scripts
  outside `src/` (e.g. screenshot post-processing under `e2e/`). CI runs the suite on every PR;
  `pnpm typecheck` + `pnpm lint` is enough there. Prioritise speed.
- Add or extend vitest tests for anything in `src/domain` or `src/app`.
- Write an ADR (`docs/adr/NNNN-title.md`, see `docs/adr/README.md` for format) for any change to
  the data model, statuses semantics, recurrence semantics, or a new runtime dependency.
- Keep `docs/DOMAIN-MODEL.md` in sync with `src/domain` whenever the frontmatter schema, statuses,
  or recurrence rules change.

## Plans/specs note

Implementation plans and design specs are kept outside this repo in the maintainer's private
notes store; the repo holds durable docs and ADRs only.
