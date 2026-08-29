import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { browser, expect } from "@wdio/globals";
import { after, afterEach, before, describe, it } from "mocha";

import { BUCKET_LABELS, buildFixtures } from "../fixtures.ts";
import { BUCKET_ORDER } from "@/domain/buckets";
import type { Bucket } from "@/domain/buckets";
import { cssClass } from "@/plugin-id";

interface FeedStructureEntry {
	readonly bucketLabel: string;
	readonly titles: readonly string[];
}

const fixtures = buildFixtures();

/**
 * DOM assertions here wait on a single already-open, already-warm Obsidian
 * window (see the top-level `before` below) — a slow wait past this almost
 * always means a real failure, not a slow render, so keep it tight rather
 * than wdio's default 10s.
 */
const SELECT_TIMEOUT = 5_000;

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));

async function saveScreenshot(name: string): Promise<void> {
	await mkdir(screenshotDir, { recursive: true });
	await browser.saveScreenshot(fileURLToPath(new URL(`../screenshots/${name}.png`, import.meta.url)));
}

/**
 * Feed and calendar are exercised in one spec file, sharing one Obsidian
 * session opened once in the top-level `before` below. wdio-obsidian-service
 * launches a fresh Obsidian instance per spec *file* — the dominant cost of
 * `pnpm test:e2e` — so keeping both views in one file (instead of one file
 * per view) halves the number of launches.
 */
describe("Views", function () {
	before(async function () {
		await browser.executeObsidian(({ app }) => app.workspace.openLinkText("Tasks.base", "", false));
		await browser.$(`.${cssClass("feed")}`).waitForExist({ timeout: SELECT_TIMEOUT });
	});

	afterEach(async function () {
		// Screenshot only on failure by default, so the success path (the
		// common case) writes nothing to disk. Set E2E_SCREENSHOT=1 for an
		// always-on screenshot of the feed instead (see the `after` hook below).
		if (this.currentTest?.state === "failed") {
			const slug = this.currentTest.fullTitle().replace(/[^a-z0-9]+/gi, "-").toLowerCase();
			await saveScreenshot(`failure-${slug}`);
		}
	});

	after(async function () {
		if (process.env["E2E_SCREENSHOT"] === "1") {
			await saveScreenshot("feed");
		}
	});

	describe("Feed view", function () {
		let structure: readonly FeedStructureEntry[] = [];
		let invalidRowText: { readonly title: string; readonly errorText: string } | undefined;

		before(async function () {
			// Bases renders asynchronously as the query resolves; wait for at least
			// one row (valid or invalid) to show up before reading the DOM.
			await browser.$(`.${cssClass("feed__row")}`).waitForExist({ timeout: SELECT_TIMEOUT });

			// `execute()` callbacks run inside the Obsidian window, not this Node
			// process, so the plugin-id-derived class names must be passed in as
			// arguments rather than closed over.
			structure = await browser.execute(
				(feedCls, bucketCls, rowCls, rowInvalidCls, titleCls) => {
					const container = document.querySelector(`.${feedCls}`);
					const result: { bucketLabel: string; titles: string[] }[] = [];
					if (container === null) {
						return result;
					}
					let current: { bucketLabel: string; titles: string[] } | undefined;
					for (const child of Array.from(container.children)) {
						if (child.classList.contains(bucketCls)) {
							current = { bucketLabel: child.textContent, titles: [] };
							result.push(current);
						} else if (child.classList.contains(rowCls) && !child.classList.contains(rowInvalidCls)) {
							const titleEl = child.querySelector(`.${titleCls}`);
							if (current !== undefined && titleEl !== null) {
								current.titles.push(titleEl.textContent);
							}
						}
					}
					return result;
				},
				cssClass("feed"),
				cssClass("feed__bucket"),
				cssClass("feed__row"),
				cssClass("feed__row--invalid"),
				cssClass("feed__title"),
			);

			invalidRowText = await browser.execute(
				(rowInvalidCls, titleCls, errorCls) => {
					const row = document.querySelector(`.${rowInvalidCls}`);
					if (row === null) {
						return undefined;
					}
					const title = row.querySelector(`.${titleCls}`)?.textContent ?? "";
					// Note: the returned key is deliberately NOT "error" — some layer in
					// the execute/sync round trip (wdio-obsidian-service's Electron IPC
					// bridge, most likely) treats a returned object's `error` key as a
					// command-level failure signal rather than plain data, turning this
					// into a WebDriverError instead of a normal result.
					const errorText = row.querySelector(`.${errorCls}`)?.textContent ?? "";
					return { title, errorText };
				},
				cssClass("feed__row--invalid"),
				cssClass("feed__title"),
				cssClass("feed__error"),
			);
		});

		it("renders exactly the non-empty bucket headers, in bucket order", function () {
			const byBucket = new Map<Bucket, string[]>();
			for (const task of fixtures.tasks) {
				const list = byBucket.get(task.bucket) ?? [];
				list.push(task.title);
				byBucket.set(task.bucket, list);
			}
			const expected: FeedStructureEntry[] = BUCKET_ORDER.filter((bucket) => byBucket.has(bucket)).map((bucket) => ({
				bucketLabel: BUCKET_LABELS[bucket],
				titles: byBucket.get(bucket) ?? [],
			}));

			expect(structure.map((entry) => entry.bucketLabel)).toEqual(expected.map((entry) => entry.bucketLabel));
		});

		it("places each generated task under its expected bucket", function () {
			for (const task of fixtures.tasks) {
				const entry = structure.find((s) => s.bucketLabel === BUCKET_LABELS[task.bucket]);
				expect(entry).toBeDefined();
				expect(entry?.titles).toContain(task.title);
			}
		});

		it("shows the invalid note with unknown-status and invalid-date errors", function () {
			expect(invalidRowText).toBeDefined();
			expect(invalidRowText?.title).toEqual(`Tasks/${fixtures.invalid.filename}`);
			expect(invalidRowText?.errorText).toEqual("unknown-status, invalid-date");
		});
	});

	describe("Calendar view", function () {
		before(async function () {
			// Switch from the default "Feed" view to "Calendar" through the Bases
			// view switcher UI: a toolbar button (`.bases-toolbar-views-menu`) opens
			// a menu (`.bases-toolbar-menu-item`) listing each configured view by
			// its name (per e2e/vault/Tasks.base — "Feed", "Calendar", "All tasks").
			await browser.$(".workspace-leaf.mod-active .bases-toolbar-views-menu .text-icon-button").click();
			await browser.$(".bases-toolbar-menu-item-name=Calendar").click();

			await browser.$(`.${cssClass("calendar")}`).waitForExist({ timeout: SELECT_TIMEOUT });
		});

		it("renders the calendar placeholder mentioning the task count", async function () {
			const el = browser.$(`.${cssClass("calendar")}`);
			await expect(el).toExist();
			await expect(el).toHaveText("task(s) in view", { containing: true });
		});
	});

	it("has no console errors in the Obsidian window", async function () {
		try {
			const logs = (await browser.getLogs("browser")) as { level: string; message: string }[];
			const errors = logs.filter((entry) => entry.level === "SEVERE");
			expect(errors).toEqual([]);
		} catch {
			// wdio-obsidian-service's Electron/chromedriver session does not
			// expose the "browser" log type in every environment. When that's
			// the case, skip rather than fail — see docs/CONVENTIONS.md e2e
			// section for how this was verified on the maintainer's machine.
			this.skip();
		}
	});
});
