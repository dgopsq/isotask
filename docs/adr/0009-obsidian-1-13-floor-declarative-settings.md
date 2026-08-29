# 0009. Obsidian 1.13 floor, declarative settings

## Status

Accepted, 2026-08-29

## Context

`ObtaskSettingTab` implemented the deprecated imperative `display()` override because the
declarative `getSettingDefinitions()` API (settings search, inline validation, `SettingGroup`)
needs Obsidian 1.13.0, while `minAppVersion` was 1.10.0 (set by the Bases API, see ADR 0001). The
maintainer decided to raise the floor rather than keep straddling both APIs: "good to be on the
edge."

## Decision

Raise `minAppVersion` to `1.13.0` and rewrite `ObtaskSettingTab` to implement
`getSettingDefinitions()`, `getControlValue()`, and `setControlValue()` instead of `display()`.
The three existing settings (task folder, marker key/value, week start) are unchanged; they now
read and write through `deps.getSettings`/`deps.setSettings` from `getControlValue`/
`setControlValue` rather than being wired up by hand inside `display()`.

## Consequences

Positive:
- Settings tab now appears in Obsidian's settings search for free.
- Removes the deprecated-API warning and the `eslint-plugin-obsidianmd` rule override it required.
- Less code: no manual `containerEl.empty()` / `Setting` wiring per field.

Negative:
- Drops support for Obsidian < 1.13.0; users on older releases can no longer install the plugin.

## Alternatives considered

- **Keep `display()`, stay on 1.10.0.** Rejected: leaves the plugin on a deprecated API
  indefinitely and forgoes settings search for no compatibility benefit the maintainer wanted.
