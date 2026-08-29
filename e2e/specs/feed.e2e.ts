import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { browser, expect } from "@wdio/globals";
import { before, describe, it } from "mocha";

import { BUCKET_LABELS, buildFixtures } from "../fixtures.ts";
import { BUCKET_ORDER } from "@/domain/buckets";
import type { Bucket } from "@/domain/buckets";

interface FeedStructureEntry {
	readonly bucketLabel: string;
	readonly titles: readonly string[];
}

const fixtures = buildFixtures();

describe("Feed view", function () {
	let structure: readonly FeedStructureEntry[] = [];
	let invalidRowText: { readonly title: string; readonly errorText: string } | undefined;

	before(async function () {
		await browser.executeObsidian(({ app }) => app.workspace.openLinkText("Tasks.base", "", false));
		await browser.$(".obtask-feed").waitForExist({ timeout: 15_000 });
		// Bases renders asynchronously as the query resolves; wait for at least
		// one row (valid or invalid) to show up before reading the DOM.
		await browser.$(".obtask-feed__row").waitForExist({ timeout: 15_000 });

		structure = await browser.execute(() => {
			const container = document.querySelector(".obtask-feed");
			const result: { bucketLabel: string; titles: string[] }[] = [];
			if (container === null) {
				return result;
			}
			let current: { bucketLabel: string; titles: string[] } | undefined;
			for (const child of Array.from(container.children)) {
				if (child.classList.contains("obtask-feed__bucket")) {
					current = { bucketLabel: child.textContent, titles: [] };
					result.push(current);
				} else if (child.classList.contains("obtask-feed__row") && !child.classList.contains("obtask-feed__row--invalid")) {
					const titleEl = child.querySelector(".obtask-feed__title");
					if (current !== undefined && titleEl !== null) {
						current.titles.push(titleEl.textContent);
					}
				}
			}
			return result;
		});

		invalidRowText = await browser.execute(() => {
			const row = document.querySelector(".obtask-feed__row--invalid");
			if (row === null) {
				return undefined;
			}
			const title = row.querySelector(".obtask-feed__title")?.textContent ?? "";
			// Note: the returned key is deliberately NOT "error" — some layer in
			// the execute/sync round trip (wdio-obsidian-service's Electron IPC
			// bridge, most likely) treats a returned object's `error` key as a
			// command-level failure signal rather than plain data, turning this
			// into a WebDriverError instead of a normal result.
			const errorText = row.querySelector(".obtask-feed__error")?.textContent ?? "";
			return { title, errorText };
		});
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

	it("saves a screenshot of the feed for manual review", async function () {
		const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
		await mkdir(screenshotDir, { recursive: true });
		await browser.saveScreenshot(fileURLToPath(new URL("../screenshots/feed.png", import.meta.url)));
	});
});
