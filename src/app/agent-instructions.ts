import type { IsotaskSettings } from "@/domain/settings";
import { firstDoneStatus, firstOpenStatus } from "@/domain/status";

/** Public surface exposed on the plugin instance for AI agents/scripts (`app.plugins.plugins.isotask.api`). */
export interface IsotaskApi {
	readonly version: 1;
	readonly agentInstructions: () => string;
}

function statusLine(id: string, kind: string, label: string): string {
	return `  - \`${id}\` = ${kind} "${label}"`;
}

/** Renders from the CONFIGURED settings, never the hardcoded defaults, so this always matches what the vault actually expects. */
export function renderAgentInstructions(settings: IsotaskSettings, guideUrl: string): string {
	const keys = settings.propertyKeys;
	const folder = settings.taskFolder.length > 0 ? settings.taskFolder : "(vault root)";
	const openStatus = firstOpenStatus(settings.statuses);
	const doneStatus = firstDoneStatus(settings.statuses);
	const openId = openStatus.some ? openStatus.value.id : "(none configured)";
	const doneId = doneStatus.some ? doneStatus.value.id : "(none configured)";
	const statusLines = settings.statuses.map((status) => statusLine(status.id, status.kind, status.label)).join("\n");

	return `# Isotask: how to create and manage task notes in this vault

Full guide: ${guideUrl}

## What makes a note a task

A note is a task when its frontmatter has \`${keys.markerKey}: ${keys.markerValue}\`. New task
notes go in the \`${folder}\` folder. The tasks base file is \`${settings.tasksBasePath}\`.

## Frontmatter properties

- \`${keys.status}\`: one of the status ids below; missing means \`${openId}\`.
${statusLines}
- \`${keys.priority}\`: \`normal\`, \`high\`, or \`urgent\`; absent means \`normal\`.
- \`${keys.due}\`: date, ISO local wall-clock \`YYYY-MM-DD\` or \`YYYY-MM-DDTHH:mm\` — never a
  timezone suffix.
- \`${keys.scheduled}\`: same format as \`${keys.due}\`.
- \`${keys.duration}\`: minutes, only meaningful together with a timed (\`THH:mm\`) \`${keys.scheduled}\`.
- \`${keys.repeat}\`: an RRULE body with no \`DTSTART\`, e.g. \`FREQ=WEEKLY;BYDAY=MO\`. Anchored on
  \`${keys.due}\` if set, else \`${keys.scheduled}\`.
- \`${keys.project}\`: a wikilink string, e.g. \`"[[Project note]]"\`.
- \`${keys.tags}\`: a list of tags.
- \`${keys.created}\`: datetime; set this yourself to now when creating a task.
- \`${keys.completed}\`: datetime; never set this yourself, the plugin fills it in.
- \`${keys.remind}\`: reminder(s) before \`${keys.due}\`/\`${keys.scheduled}\` — \`none\`, \`0\`, an
  offset (\`15m\`, \`2h\`, \`1d\`, \`1w\`), or a full datetime; absent uses the vault's default.

## Example

\`\`\`markdown
---
${keys.markerKey}: ${keys.markerValue}
${keys.status}: ${openId}
${keys.due}: 2026-09-20
${keys.created}: 2026-09-13T09:00
---
Buy milk.
\`\`\`

## Recipes

- **Create**: add a new note in \`${folder}\` with the frontmatter above.
- **Complete**: set \`${keys.status}\` to \`${doneId}\`. While Obsidian is running, the plugin fills
  in \`${keys.completed}\` and, for a recurring task, creates the next occurrence named by the
  template \`${settings.spawnFilenameTemplate}\`.
- **Reopen**: set \`${keys.status}\` back to \`${openId}\`. The plugin clears \`${keys.completed}\`.
- **Reschedule**: change \`${keys.due}\` and/or \`${keys.scheduled}\`.

## Check your work

Malformed task notes show up in the feed view's "Errors" group, with a reason.
`;
}
