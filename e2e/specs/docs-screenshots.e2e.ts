import { browser, expect } from "@wdio/globals";
import { after, before, describe, it } from "mocha";

import { fileURLToPath, mkdir } from "../node-io.ts";
import { cssClass } from "@/plugin-id";

/** Produces `docs/assets/feed.png`/`calendar.png`; runs only via `pnpm shots:docs`, excluded from `pnpm test:e2e`. */

const SELECT_TIMEOUT = 5_000;

const assetsDir = fileURLToPath(new URL("../../docs/assets/", import.meta.url));

async function saveDocAsset(name: string): Promise<void> {
	await mkdir(assetsDir, { recursive: true });
	// Status bar only exists once a file is active, so this runs per-screenshot, not in `before`.
	await browser.execute(() => document.querySelector(".status-bar")?.remove());
	// Screenshotting the leaf, not the window, crops out the collapsed sidebar rails.
	await browser.$(".workspace-leaf.mod-active").saveScreenshot(fileURLToPath(new URL(`../../docs/assets/${name}.png`, import.meta.url)));
}

/** WebDriver's own setWindowSize()/emulate() don't work against this Electron session. */
async function setWindowSize(width: number, height: number): Promise<void> {
	await browser.execute(
		(w: number, h: number) => {
			const req = (window as unknown as { require?: (m: string) => unknown }).require;
			if (typeof req !== "function") {
				throw new Error("window.require is unavailable — not an Electron renderer");
			}
			const electron = req("electron") as { remote: { getCurrentWindow: () => { setSize: (a: number, b: number) => void } } };
			electron.remote.getCurrentWindow().setSize(w, h);
		},
		width,
		height,
	);
	await browser.waitUntil(async () => (await browser.execute(() => window.innerWidth)) <= width, {
		timeout: SELECT_TIMEOUT,
		timeoutMsg: `the window never resized to ${String(width)}px wide`,
	});
}

describe("Docs screenshots", function () {
	before(async function () {
		await setWindowSize(1400, 900);
		await browser.execute(() => {
			document.body.classList.remove("theme-light");
			document.body.classList.add("theme-dark");
		});
		await browser.executeObsidian(({ app }) => {
			app.workspace.leftSplit.collapse();
			app.workspace.rightSplit.collapse();
		});
		// "My Tasks.base": nicer tab title than the DocsDemo folder it filters on.
		await browser.executeObsidian(({ app }) => app.workspace.openLinkText("My Tasks.base", "", false));
		await browser.$(`.${cssClass("feed")}`).waitForExist({ timeout: SELECT_TIMEOUT });
	});

	it("captures the feed view", async function () {
		await browser.$(`.${cssClass("feed__bucket")}`).waitForExist({ timeout: SELECT_TIMEOUT });
		const buckets = await browser.$$(`.${cssClass("feed__bucket")}`).getElements();
		expect(buckets.length).toBeGreaterThan(1);

		await saveDocAsset("feed");
	});

	it("captures the calendar week view", async function () {
		await browser.$(".workspace-leaf.mod-active .bases-toolbar-views-menu .text-icon-button").click();
		await browser.$(".bases-toolbar-menu-item-name=Calendar").click();
		await browser.$(`.${cssClass("calendar")} .ec`).waitForExist({ timeout: SELECT_TIMEOUT });

		await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType("bases");
			const leaf = leaves[0];
			if (leaf === undefined) {
				throw new Error("no bases leaf found");
			}
			const outerView = leaf.view as unknown as {
				controller: { view: { config: { set: (key: string, value: unknown) => void } } };
			};
			outerView.controller.view.config.set("initialView", "week");
		});
		await browser.$(`.${cssClass("calendar")} .ec-week-view`).waitForExist({ timeout: SELECT_TIMEOUT });

		const timedEventEl = browser.$(`.${cssClass("calendar")} .ec-time-grid .ec-body .ec-event`);
		await timedEventEl.waitForExist({ timeout: SELECT_TIMEOUT });

		const events = await browser.$$(`.${cssClass("event")}`).getElements();
		expect(events.length).toBeGreaterThan(1);

		await saveDocAsset("calendar");
	});

	it("captures the feed view on mobile", async function () {
		await setWindowSize(390, 844);
		await browser.executeObsidian(({ app }) => {
			(app as unknown as { emulateMobile: (v: boolean) => void }).emulateMobile(true);
		});
		// emulateMobile() tears down the active leaf, so the base has to be reopened.
		await browser.executeObsidian(({ app }) => app.workspace.openLinkText("My Tasks.base", "", false));
		await browser.$(`.${cssClass("feed")}`).waitForExist({ timeout: SELECT_TIMEOUT });
		await browser.$(`.${cssClass("feed__bucket")}`).waitForExist({ timeout: SELECT_TIMEOUT });

		await saveDocAsset("feed-mobile");
	});

	it("captures the calendar view on mobile", async function () {
		await browser.$(".workspace-leaf.mod-active .bases-toolbar-views-menu .text-icon-button").click();
		await browser.$(".bases-toolbar-menu-item-name=Calendar").click();
		await browser.$(`.${cssClass("calendar")} .ec`).waitForExist({ timeout: SELECT_TIMEOUT });

		await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType("bases");
			const leaf = leaves[0];
			if (leaf === undefined) {
				throw new Error("no bases leaf found");
			}
			const outerView = leaf.view as unknown as {
				controller: { view: { config: { set: (key: string, value: unknown) => void } } };
			};
			// Compact month renders the dot grid, the distinctive mobile shot.
			outerView.controller.view.config.set("initialView", "month");
		});

		const eventEl = browser.$(`.${cssClass("event")}`);
		await eventEl.waitForExist({ timeout: SELECT_TIMEOUT });

		await saveDocAsset("calendar-mobile");
	});

	after(async function () {
		await browser.executeObsidian(({ app }) => {
			(app as unknown as { emulateMobile: (v: boolean) => void }).emulateMobile(false);
		});
	});
});
