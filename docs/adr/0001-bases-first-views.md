# 0001. Bases-first views

## Status

Accepted, 2026-08-29

## Context

Obtask needs a feed view and a calendar view over task notes. Obsidian 1.10+ ships **Bases**: a
first-class mechanism for defining filtered/sorted/grouped views over notes via `.base` files,
with a `Plugin.registerBasesView` API for plugins to contribute custom view *renderers* while
Bases keeps ownership of filtering, sorting, grouping, and the toolbar. The plugin could instead
ignore Bases and own its own query/filter engine end to end via standalone `ItemView`s.

## Decision

Build both views as Bases view types (`obtask-feed`, `obtask-calendar`) registered via
`registerBasesView`. Bases owns which notes appear, order, grouping, and property visibility; the
plugin owns rendering and task actions only. Views never filter — see `docs/ARCHITECTURE.md`.

## Consequences

Positive:
- No bespoke query language, filter UI, or persistence for view configuration — Bases already has
  all of it, including a native options panel for view-specific settings.
- Consistent with Obsidian's own direction (Bases is a core feature as of 1.10); users' existing
  Bases skills and other Bases views (tables, boards) transfer directly.
- Smaller surface area to maintain and test.

Negative:
- Hard dependency on Obsidian >= 1.10 (Bases view API); no support for older Obsidian.
- View behavior is bounded by what Bases' view-options and entry model expose; anything Bases
  doesn't support (e.g. arbitrary per-row computed filters) isn't available to the views either.
- Floor raised to 1.13.0 on 2026-08-29 to use the declarative settings API (settings search);
  decided by the maintainer ("good to be on the edge").

### Addendum, 2026-08-30

The Bases toolbar (Sort/Filter/Properties/Search/New) is always shown for every registered view
type and cannot be hidden or replaced per view — so each control must either visibly apply in our
views, or its no-op must be documented rather than left to look like a bug. Filter/Properties/
Search/New already visibly apply. Sort did not: `groupIntoBuckets` re-sorted every bucket
regardless of `BasesViewConfig.getSort()`, making toolbar Sort silently inert in the feed. Fixed
by having the feed pass `order: "preserve"` (`buckets.ts#BucketOptions`) whenever a sort is
configured, keeping Bases' incoming order within each bucket instead of re-deriving one. The
calendar's no-op remains intentional and documented (`docs/DOMAIN-MODEL.md#feed-buckets`): events
are placed by time, not list position, so a toolbar sort has nothing to visibly change there.

## Alternatives considered

- **Standalone `ItemView`s with a custom query engine.** Rejected: duplicates filter/sort/group
  UI and persistence that Bases already provides for free, produces a second, inconsistent
  filtering mental model alongside Bases' native views, and is significantly more code to build
  and maintain for no functional gain over the current Obsidian version floor.
