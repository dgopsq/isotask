import type { App } from "obsidian";

import { VIEW_TYPE_TASK_PANEL } from "@/plugin-id";

/**
 * Reveals the sidebar task panel (`task-panel-view.ts`), reusing an
 * already-open leaf of that type if there is one, else opening a new one in
 * the right sidebar. Shared by the "Open task panel" command
 * (`commands/register-commands.ts`), the ribbon icon, and the one-time
 * auto-open on first enable (both in `main.ts`).
 */
export async function revealTaskPanel(app: App): Promise<void> {
	const existing = app.workspace.getLeavesOfType(VIEW_TYPE_TASK_PANEL)[0];
	if (existing !== undefined) {
		await app.workspace.revealLeaf(existing);
		return;
	}
	// `getRightLeaf` can come back null (no right split available); fall
	// back to a main-area tab so the command never silently no-ops.
	const leaf = app.workspace.getRightLeaf(false) ?? app.workspace.getLeaf(true);
	await leaf.setViewState({ type: VIEW_TYPE_TASK_PANEL, active: true });
	await app.workspace.revealLeaf(leaf);
}
