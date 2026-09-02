# 0015. Project color drives the card dot/bar

## Status

Accepted, 2026-08-31

## Context

Every card (feed row leading dot, calendar month dot, due ring, time-grid pill) has one leading
color slot. It used to be colored by priority; ADR 0014 moves priority to a text mark instead,
freeing that slot for a new meaning. Users scan a feed or calendar primarily by project — "what's
on Website redesign" — more than by priority, and a project already exists as a `[[wikilink]]`
frontmatter value pointing at a real note, unlike priority, which has no note of its own to carry
a setting.

## Decision

Color is a property of the **project note**, not the task: a project note may declare its own
`color` frontmatter value, either one of 8 palette names (`red orange yellow green cyan blue
purple pink`, mapped 1:1 to Obsidian's `--color-*` variables) or a `#rgb`/`#rrggbb` hex string,
parsed by `domain/project-color.ts#parseProjectColor`. `resolveDotColor` decides a task's dot, in
order: no `project` on the task -> neutral (`--text-faint`); the project note's `color` parses ->
that color; no `color` set, or one that doesn't parse (invalid input never errors, it just falls
through) -> a **frozen** djb2a hash of the project name onto the same 8-entry palette
(`hashPaletteColor`), so every project gets a consistent, distinguishable color for free.

Palette colors apply as one of 8 pre-declared static CSS classes. A hex color has no such class —
Obsidian's plugin guidelines forbid a plugin creating stylesheet rules at runtime — so it's applied
as a scoped `--obtask-dot-color` custom property directly on the element via `setCssProps`, at the
one place each renderer (feed row, calendar `eventDidMount`) actually holds the DOM node. Editing
is via `ui/project-color-modal.ts` (palette swatches, "Automatic" to clear the property, or a
custom hex field), writing through `processFrontMatter` on the *project* note; reachable from the
feed's project-link context menu, the task panel's swatch, and a new "Set project color…" command.
Feed/calendar views track which project note paths their last render depended on and re-render on
a `metadataCache` `changed` event for one of them, so editing a project's color updates every card
referencing it with no task note touched.

## Consequences

Positive:
- Coloring by project matches how users actually scan a task list, with zero required
  configuration — the hash fallback makes every project visually distinct immediately.
- A hex color covers a project a palette name can't express, without any settings UI to maintain.
- Reusing `metadataCache`'s `changed` event needs no bespoke change-notification of its own.

Negative:
- An on-screen calendar event's **hex** color repaints only on remount (`eventDidMount` is
  mount-only), not live like a palette class — a known limitation, not planned to be fixed unless
  Event Calendar exposes a per-event style-update hook.
- `metadataCache` fires no `changed` on rename, and a rename doesn't itself change frontmatter, so
  a renamed project's dot keeps following the note under its new name/path with no explicit
  transfer — matching the existing rename gotcha the codebase already lives with elsewhere.
- `hashPaletteColor` is frozen: any future change to it would silently recolor every project across
  every vault that sets no explicit `color` — locked in by exact-output tests.

### Addendum, 2026-08-31

The first negative consequence above (hex repaints only on remount) is fixed.
`event-calendar-renderer.ts` now keeps a `Map<eventId, HTMLElement>` of every element
`eventDidMount` has handed back; its `setEvents` walks that map on every later data update to set
or remove `--obtask-dot-color` directly on each still-connected element (pruning any entry whose
element Event Calendar has since torn down). A calendar event's hex color now repaints
live — hex -> hex, hex -> palette, and hex -> neutral — the same as a palette class already did;
no Event Calendar update hook turned out to be needed. `docs/DOMAIN-MODEL.md`'s "Project color"
section has been updated to match this. The other two negative consequences are unaffected.

### Addendum, 2026-09-02

The feed no longer renders a leading dot slot. Project color now paints the text of the project
chip/label in the feed row's meta area, visible only when the project property is enabled in the
Bases toolbar's Properties order. Rationale: a leading dot plus a separate uncolored project chip
was redundant, and the dot had no legend to explain what color meant. The label is self-describing.
Calendar cards (month dot, due ring, time-grid pill) are unchanged. The custom property
`--obtask-dot-color` keeps its name for continuity. `docs/DOMAIN-MODEL.md`'s "Project color"
section has been updated to match this.

## Alternatives considered

- **A settings-registered project → color map (like the status list).** Rejected: a project is
  identified by name/path, which renames freely and isn't enumerable ahead of time the way a fixed
  status list is — an entry would silently orphan on every rename, and the settings UI would need
  its own live project picker just to stay useful.
- **Keep priority driving dot color, add project color as a second dot.** Rejected: see ADR 0014
  — one card, one dot slot (on calendar cards; the feed's project color moved to the text of the
  label in the meta area, see addendum above).
- **Render a per-project `<style>` rule for hex colors.** Rejected outright: Obsidian's plugin
  guidelines (`eslint-plugin-obsidianmd`'s `no-forbidden-elements`) forbid a plugin creating
  stylesheet elements at runtime; `setCssProps` on the specific element is the sanctioned
  mechanism for a value only known at render time.
