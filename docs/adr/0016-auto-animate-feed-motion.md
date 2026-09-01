# 0016. Feed interaction motion via @formkit/auto-animate and keyed row reconciliation

## Status

Accepted, 2026-09-01

## Context

The plugin had zero motion; all interaction feedback was instantaneous. The most valuable
animation — a task row visibly travelling to its new bucket after a status/date change, plus
enter/exit of rows — was impossible because the feed view rebuilt its entire DOM on every
`onDataUpdated` (`viewContainerEl.empty()` + re-render), so no element survived a data update
for any FLIP-style animation to track. No change to statuses/recurrence semantics is involved;
this is presentation-layer, but it adds a runtime dependency, which per AGENTS.md requires an ADR.

## Decision

(1) The feed view now renders into an inner `.obtask-feed__list` element and reconciles keyed
top-level children (rows keyed by task path, headers/placeholders by group+bucket) across renders,
reusing row elements and re-rendering only their contents; per-row Obsidian `Component`s own row
listeners. (2) `@formkit/auto-animate` (v0.10.0, ~3 kB min+gzip, zero dependencies, MIT) is
attached to that list element; it observes direct-child mutations only (`childList: true`, no
subtree) and derives move (FLIP), add, and remove animations automatically, respecting
`prefers-reduced-motion` by default. Duration 180ms. Static hover/press feedback elsewhere
stays plain CSS.

## Consequences

Positive:
- Reordering is now animated; a task row visibly travels to its new bucket after status/date
  change, delivering strong interaction feedback at near-zero code cost.
- Element reuse reduces DOM churn and preserves scroll position across updates.
- Auto-animate handles enter/exit animations automatically, including reduced-motion respect.

Negative:
- New runtime dependency bundled by esbuild; no network access, plain DOM APIs, mobile-safe
  (MutationObserver and Web Animations API are available in Obsidian's Electron and iOS/Android
  WebViews). The library inline-sets `position: relative` on a static parent; `styles/obtask.css`
  sets it on `.obtask-feed__list` instead to keep the no-inline-styles rule intact.
- Exit animations briefly re-insert an absolutely-positioned copy of a removed row; the
  reconciler tracks its own keyed map, not live children, so this is benign but needs documenting.

## Alternatives considered

- **CSS-only.** Rejected: cannot animate list reorder at all — elements don't survive re-render,
  and CSS has no FLIP mechanism.
- **Hand-rolled FLIP via Web Animations API.** Rejected: no new dependency, but ~50+ lines to own
  including enter/exit handling and reduced-motion respect, for exactly what the 3 kB library does.
- **Larger animation libraries** (motion.dev, animejs). Rejected: orchestration power the plugin
  doesn't need, at multiples of the bundle cost.
