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
- e2e (`wdio-obsidian-service` against a fixture vault) is milestone M5, not part of the regular
  unit-test loop. `test-vault/` is a manual, gitignored vault with the plugin symlinked in via
  `pnpm dev:link <vault>` symlinks `main.js`, `styles.css` and `manifest.json` into `<vault>/.obsidian/plugins/obtask`; then `pnpm dev` and reload the plugin in Obsidian after each build.

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
