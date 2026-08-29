import { browser, expect } from "@wdio/globals";
import { before, describe, it } from "mocha";

describe("Calendar view", function () {
	before(async function () {
		await browser.executeObsidian(({ app }) => app.workspace.openLinkText("Tasks.base", "", false));
		await browser.$(".obtask-feed").waitForExist({ timeout: 15_000 });

		// Switch from the default "Feed" view to "Calendar" through the Bases
		// view switcher UI: a toolbar button (`.bases-toolbar-views-menu`) opens
		// a menu (`.bases-toolbar-menu-item`) listing each configured view by
		// its name (per e2e/vault/Tasks.base — "Feed", "Calendar", "All tasks").
		await browser.$(".workspace-leaf.mod-active .bases-toolbar-views-menu .text-icon-button").click();
		await browser.$(".bases-toolbar-menu-item-name=Calendar").click();

		await browser.$(".obtask-calendar").waitForExist({ timeout: 15_000 });
	});

	it("renders the calendar placeholder mentioning the task count", async function () {
		const el = browser.$(".obtask-calendar");
		await expect(el).toExist();
		await expect(el).toHaveText("task(s) in view", { containing: true });
	});
});
