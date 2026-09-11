---
type: project
---
Static e2e fixture (checked in, unlike `Tasks/` which is regenerated per run):
a project note with no `color` frontmatter, resolved by "Later task"'s
`project: Design Revamp` field. Exercises the hash-fallback path of
`domain/project-color.ts#resolveDotColor`/`hashPaletteColor` — its feed row
dot should render some `isotask-color-*` class, just not a fixed one.
