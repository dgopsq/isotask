# Conventions

This design was decided on 2026-08-29.

## TypeScript rules

- Strict mode, no `any`, no non-null assertions (`!`). Use `import type { X } from "..."` for
  type-only imports.
- `readonly` everywhere in `domain`/`app`/`ports` — fields, arrays (`readonly T[]`), function
  parameters where practical.
- No classes in `domain/` or `app/`: functions and plain data only. Classes exist only where
  Obsidian's API demands them (`Plugin`, `BasesView`, `Modal`, `PluginSettingTab`), and those
  classes live in `adapters`/`views`/`ui`/`settings`/`main.ts`.
- Exhaustive `switch`: every `switch` over a union (e.g. `StatusKind`, `Priority`) must cover all
  cases; use a `never`-typed default to get a compile error on new cases instead of a runtime
  fallback.
- Branded primitives for domain identity (`TaskPath`, `IsoDate`, `IsoDateTime`, `Minutes`,
  `RRuleString`, `StatusId`, ...) — plain strings/numbers are never passed where a branded type is
  expected, so a raw path can't accidentally be treated as a validated one.

```ts
type IsoDate = string & { readonly __brand: "IsoDate" };
function isoDate(value: string): Result<IsoDate, TaskParseError> { /* validate, then cast */ }
```

- `Result<T, E>` and `Option<T>` are small in-house types (no dependency), used for anything that
  can fail or be absent in the domain/app layers instead of throwing or returning `null`/
  `undefined` ad hoc.

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
type Option<T> = { some: true; value: T } | { some: false };

function parseTask(fm: ParsedFrontmatter): Result<Task, TaskParseError[]> { /* ... */ }
```

- Frontmatter validation goes through `valibot` schemas that produce domain types — no hand-rolled
  ad hoc validation in adapters.

## File and naming conventions

- kebab-case filenames (`set-status.ts`, `task-create-modal.ts`).
- One module per concept — a file exports one primary thing (a function, a small related group of
  functions, or one class), not a grab-bag.
- Tests are colocated as `*.test.ts` next to the module they cover (e.g. `buckets.ts` +
  `buckets.test.ts`), not in a separate `__tests__` tree.

## DOM conventions

- Build DOM with `createEl`/`createDiv`/`createSpan` (Obsidian's helpers on `HTMLElement`); never
  `innerHTML` or `outerHTML`.
- Use `setIcon` for icons, `Setting` for settings-style rows (including inside modals where it
  fits), and `Menu` for context/dropdown menus — don't hand-roll these Obsidian already provides.
- CSS classes: kebab-case, prefixed `obtask-` (e.g. `obtask-feed-row`, `obtask-status-dot`). No
  inline `style=` attributes; put styling in `src/styles/*.css`.
- Use theme CSS variables, not literal colors. Common ones: `--background-primary`,
  `--background-secondary`, `--text-normal`, `--text-muted`, `--text-faint`,
  `--interactive-accent`, `--interactive-accent-hover`, `--color-red`, `--color-orange`,
  `--color-yellow`, `--color-green`, `--color-blue`, `--color-purple`.

## Obsidian API usage rules

- Frontmatter **writes**: always `app.fileManager.processFrontMatter(file, fn)`. Never construct
  YAML by hand or edit the frontmatter block via string manipulation.
- Frontmatter **reads**: always `app.metadataCache.getFileCache(file)?.frontmatter`. Don't re-read
  and re-parse the file body for data that's already in frontmatter.
- Vault paths: always pass user- or config-supplied path strings through `normalizePath` before
  use.
- Vault edits to note *bodies* (only needed for the recurrence-spawn create path): use
  `Vault.process`, not the deprecated `Vault.modify`.
- Event/interval registration: always `registerEvent`, `registerDomEvent`, `registerInterval` —
  never raw `addEventListener`/`setInterval` — so the `Plugin` base class tears them down
  automatically on unload (see `docs/ARCHITECTURE.md` composition root section).
- Never read `workspace.activeLeaf` (deprecated/unreliable); use the APIs the calling context
  already gives you (the command callback's checking context, the file-menu's `file` argument,
  etc).
- Always `this.app`, never the global `app`.

## Testing conventions

- `vitest` for `domain/` and `app/`. `app/` use-cases are tested against fake ports (in-memory
  `TaskStore`, fixed `Clock`, no-op `Notifier`) — no real Obsidian API in unit tests.
- Recurrence (`domain/recurrence.ts`) and buckets (`domain/buckets.ts`) use table-driven tests:
  one table of `{ input, now, expected }` rows per behavior, including DST transitions,
  leap-year dates (Feb 29), and week-boundary edge cases (Sunday vs. Monday week start, midnight
  boundaries).
- `pnpm dev:link <vault>` symlinks `main.js`, `styles.css` and `manifest.json` into
  `<vault>/.obsidian/plugins/obtask` for manual, exploratory testing; then `pnpm dev` and reload
  the plugin in Obsidian after each build.
- e2e (`wdio-obsidian-service`, launching a real Obsidian window) lives under `e2e/` and is not
  part of `pnpm check` — it's slow (downloads and boots real Obsidian) and needs a display, so it
  doesn't belong in the fast inner loop or in CI's default gate. Run it locally before a release or
  after touching a Bases view.

  **Running it**: `pnpm test:e2e`. This builds the plugin (`pnpm build`), regenerates the
  date-relative fixture notes (`tsx e2e/generate-fixtures.mts`), then runs `wdio run
  wdio.conf.mts`. `wdio-obsidian-service` downloads the latest stable Obsidian app + installer
  into `.obsidian-cache/` on first run (gitignored; the download is cached across runs) and opens
  a real, visible Obsidian window against a sandboxed copy of `e2e/vault/` — Obsidian doesn't
  support headless automation, so this can't run without a display (e.g. a bare CI runner without
  Xvfb).

  **Fixture generation**: `e2e/vault/` is checked in (a minimal vault with `.obsidian/`
  core-plugins config enabling `bases`/`properties`, and `Tasks.base` with the Feed view listed
  first so it's the default view). `e2e/vault/Tasks/` — the actual task notes — is gitignored:
  `e2e/generate-fixtures.mts` regenerates it on every `test:e2e` run via `e2e/fixtures.ts`'s
  `buildFixtures(now)`, which computes each note's due date relative to `now` (`date-fns`, Monday
  week start) and its expected feed bucket by calling the real `bucketFor` from
  `src/domain/buckets.ts` — so the notes and the assertions about them never hard-code a date or a
  bucket boundary, and the suite passes on any day it runs. `e2e/fixtures.ts` is imported by both
  the generator and the specs (single source of truth for fixture data); everything under `e2e/`
  runs via `tsx` (not plain `node`) so the `@/domain/**` path alias resolves the same way it does
  for `src/`.

  **Adding a spec**: drop a new `e2e/specs/<name>.e2e.ts` — `wdio.conf.mts`'s `specs` glob
  (`./e2e/specs/**/*.e2e.ts`) picks it up automatically. Import `describe`/`it`/`before` from
  `"mocha"` and `browser`/`expect` from `"@wdio/globals"` explicitly (don't rely on injected
  globals). Use `browser.executeObsidian(({ app }) => ...)` to drive the Obsidian API (e.g. open a
  base with `app.workspace.openLinkText(...)`), and prefer the plugin's existing `obtask-*` CSS
  classes as selectors over adding new ones. Switch a Bases view via its toolbar menu:
  `browser.$(".bases-toolbar-views-menu .text-icon-button").click()` opens it, then
  `browser.$(".bases-toolbar-menu-item-name=<View name>").click()` picks a view by name — that
  markup isn't public Bases API, so re-verify it (`pnpm test:e2e`) after an Obsidian version bump.
  When returning a plain object from `browser.execute(...)`, avoid a top-level `error` key — some
  layer in wdio-obsidian-service's execute round trip treats it as a command-level failure rather
  than data. `mocha` is pinned to the exact version `@wdio/mocha-framework` depends on
  (`^10.3.0`) rather than the newest release — mocha keeps module-level state used for the
  `import { describe } from "mocha"` pattern, and two different copies of the package (ours vs.
  the framework's own nested one) silently break it.

## Commit message style

Conventional commits: `<type>(<scope>): <summary>`, imperative mood, no trailing period.
Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`. Scope is usually a layer
or feature (`domain`, `app`, `calendar`, `feed`, `settings`, `adr`). Example:
`feat(domain): add recurrence anchor resolution`.

## Release checklist (from Obsidian's plugin guidelines)

- `pnpm check` passes (typecheck, lint, test, build).
- No `innerHTML`/`outerHTML` usage anywhere in `src/`.
- No global `app` reference — only `this.app`.
- No default hotkeys assigned to any command.
- All UI copy is sentence case.
- No Node.js or Electron APIs used directly (bundle targets the Obsidian sandbox, including
  mobile).
- No inline `style=` attributes; theme CSS variables only, verified in both light and dark themes.
- All registrations use `registerEvent`/`registerDomEvent`/`registerInterval`/`addCommand`/
  `registerBasesView` so `onunload` needs no manual cleanup.
- Mobile QA: touch interactions (long-press drag on the calendar, tap targets) verified on at
  least one mobile client.
- `manifest.json`/`versions.json` version bump via `pnpm version` before tagging a release.
- Bundle size check: `main.js` minified ≤ 150 kB (Event Calendar ~35 kB gz + rrule ~13 kB gz +
  tree-shaken date-fns + valibot is the budget basis).
