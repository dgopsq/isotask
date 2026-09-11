---
color: red
---
Static e2e fixture (checked in, unlike `Tasks/` which is regenerated per run):
a project note with an explicit `color` frontmatter value, resolved by
"Overdue task"'s `project: Q3 Launch` field. Exercises the explicit-color
path of `domain/project-color.ts#resolveDotColor` — its feed row project label and
calendar event should render `isotask-color-red`.
