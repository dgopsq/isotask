import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { browser, expect } from "@wdio/globals";
import { addDays, format, parseISO } from "date-fns";
import { after, afterEach, before, describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";

import { BUCKET_LABELS, buildFixtures } from "../fixtures.ts";
import { BUCKET_ORDER } from "@/domain/buckets";
import type { Bucket } from "@/domain/buckets";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import type { ObtaskSettings } from "@/domain/settings";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { StatusId } from "@/domain/task";
import { priorityChipClass } from "@/domain/task";
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

/** Saves a screenshot to an arbitrary absolute path (for the "New/Search (Bases toolbar)" review screenshots, which live outside `e2e/screenshots/`). */
async function saveScreenshotAt(absolutePath: string): Promise<void> {
	await mkdir(dirname(absolutePath), { recursive: true });
	await browser.saveScreenshot(absolutePath);
}

/**
 * Shared helpers for the "Actions" suite below (M1 command flows). All state
 * assertions read the vault/metadata cache via `executeObsidian` rather than
 * the DOM — DOM is used only to drive modal interaction, per
 * `docs/CONVENTIONS.md`'s e2e section.
 */

async function openFile(path: string): Promise<void> {
	await browser.executeObsidian(({ app }, p: string) => app.workspace.openLinkText(p, "", false), path);
	await browser.waitUntil(async () => (await activeFilePath()) === path, {
		timeout: SELECT_TIMEOUT,
		timeoutMsg: `${path} never became the active file`,
	});
}

async function activeFilePath(): Promise<string | null> {
	return browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path ?? null);
}

async function frontmatterOf(path: string): Promise<Record<string, unknown> | undefined> {
	return browser.executeObsidian(({ app }, p: string) => {
		const file = app.vault.getFileByPath(p);
		if (file === null) {
			return undefined;
		}
		return app.metadataCache.getFileCache(file)?.frontmatter;
	}, path);
}

async function readFileContent(path: string): Promise<string | undefined> {
	return browser.executeObsidian(async ({ app }, p: string) => {
		const file = app.vault.getFileByPath(p);
		if (file === null) {
			return undefined;
		}
		return app.vault.cachedRead(file);
	}, path);
}

/** Polls a frontmatter field until `predicate` matches — commands dispatch their app/ use-case as a fire-and-forget promise (`checkCallback` is synchronous), so the write lands after `executeObsidianCommand` already resolved. */
async function waitForFrontmatter(path: string, key: string, predicate: (value: unknown) => boolean, timeoutMsg: string): Promise<void> {
	await browser.waitUntil(
		async () => {
			const fm = await frontmatterOf(path);
			return predicate(fm?.[key]);
		},
		{ timeout: SELECT_TIMEOUT, timeoutMsg },
	);
}

/** Clicks a feed row's date chip by the row's title text (there's no per-row selector to key off otherwise). Native `.click()` inside the Obsidian window fires the same listeners a real click would. */
async function clickFeedDateChip(title: string): Promise<void> {
	const clicked = await browser.execute(
		(rowCls, titleCls, dateCls, wantedTitle) => {
			for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
				const titleEl = row.querySelector(`.${titleCls}`);
				if (titleEl?.textContent === wantedTitle) {
					const chip = row.querySelector(`.${dateCls}`);
					if (chip instanceof HTMLElement) {
						chip.click();
						return true;
					}
				}
			}
			return false;
		},
		cssClass("feed__row"),
		cssClass("feed__title"),
		cssClass("feed__date"),
		title,
	);
	if (!clicked) {
		throw new Error(`date chip for "${title}" not found in the feed`);
	}
}

/** Clicks a feed row's priority control by the row's title text — same technique as `clickFeedDateChip`. */
async function clickFeedPriorityControl(title: string): Promise<void> {
	const clicked = await browser.execute(
		(rowCls, titleCls, priorityCls, wantedTitle) => {
			for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
				const titleEl = row.querySelector(`.${titleCls}`);
				if (titleEl?.textContent === wantedTitle) {
					const control = row.querySelector(`.${priorityCls}`);
					if (control instanceof HTMLElement) {
						control.click();
						return true;
					}
				}
			}
			return false;
		},
		cssClass("feed__row"),
		cssClass("feed__title"),
		cssClass("feed__priority"),
		title,
	);
	if (!clicked) {
		throw new Error(`priority control for "${title}" not found in the feed`);
	}
}

/** Reads the active Bases leaf's `FeedBasesView.config.getOrder()` — same internal `leaf.view.controller.view` path as the "Feed view options" probe (see that describe block's doc comment). */
async function getFeedOrder(): Promise<string[]> {
	return browser.executeObsidian(({ app }) => {
		const leaves = app.workspace.getLeavesOfType("bases");
		const leaf = leaves[0];
		if (leaf === undefined) {
			throw new Error("no bases leaf found");
		}
		const outerView = leaf.view as unknown as { controller: { view: { config: { getOrder: () => string[] } } } };
		return outerView.controller.view.config.getOrder();
	});
}

/**
 * Sets the active Bases leaf's Properties order. Prefers `config.setOrder()`
 * — undocumented (not in `obsidian.d.ts`, which declares only `getOrder`),
 * but present at runtime and, unlike `config.set("order", ...)`, actually
 * updates what `getOrder()` reads back (verified empirically: `set("order")`
 * silently no-ops on this build). Falls back to `config.set("order", ...)`
 * if `setOrder` isn't there, per the task's fallback instruction — reports
 * which path ran via the returned `usedSetOrder`.
 */
async function setFeedOrder(order: readonly string[]): Promise<{ readonly usedSetOrder: boolean }> {
	return browser.executeObsidian(
		({ app }, orderArg: string[]) => {
			const leaves = app.workspace.getLeavesOfType("bases");
			const leaf = leaves[0];
			if (leaf === undefined) {
				throw new Error("no bases leaf found");
			}
			const outerView = leaf.view as unknown as {
				controller: {
					view: {
						config: {
							setOrder?: (order: string[]) => void;
							set: (key: string, value: unknown) => void;
						};
					};
				};
			};
			const config = outerView.controller.view.config;
			if (typeof config.setOrder === "function") {
				config.setOrder(orderArg);
				return { usedSetOrder: true };
			}
			config.set("order", orderArg);
			return { usedSetOrder: false };
		},
		[...order],
	);
}

/**
 * Dispatches a synthetic `contextmenu` event on a feed row, found by its
 * title text — real right-click simulation is unreliable in this Electron
 * build (same rationale as the date-input `dispatchEvent` calls above), so
 * this drives the row's own `contextmenu` listener directly instead.
 */
async function rightClickFeedRow(title: string): Promise<void> {
	const dispatched = await browser.execute(
		(rowCls, titleCls, wantedTitle) => {
			for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
				const titleEl = row.querySelector(`.${titleCls}`);
				if (titleEl?.textContent === wantedTitle) {
					const rect = row.getBoundingClientRect();
					row.dispatchEvent(
						new MouseEvent("contextmenu", {
							bubbles: true,
							cancelable: true,
							clientX: rect.left + 10,
							clientY: rect.top + 5,
						}),
					);
					return true;
				}
			}
			return false;
		},
		cssClass("feed__row"),
		cssClass("feed__title"),
		title,
	);
	if (!dispatched) {
		throw new Error(`row for "${title}" not found in the feed`);
	}
}

async function inputAt(modalCls: string, type: string, index: number): Promise<WebdriverIO.Element> {
	const els = await browser.$$(`.${modalCls} input[type="${type}"]`).getElements();
	const el = els[index];
	if (el === undefined) {
		throw new Error(`No input[type="${type}"] at index ${String(index)} in .${modalCls}`);
	}
	return el;
}

/**
 * Polls the shared `.suggestion-item` popover (used by both `FuzzySuggestModal`
 * and `AbstractInputSuggest`, see "Set status via suggest modal" above) for an
 * item whose text contains `text`, returning it once found and displayed.
 */
async function waitForSuggestionItem(text: string): Promise<WebdriverIO.Element> {
	let found: WebdriverIO.Element | undefined;
	await browser.waitUntil(
		async () => {
			const items = await browser.$$(".suggestion-item").getElements();
			for (const item of items) {
				if ((await item.getText()).includes(text) && (await item.isDisplayed())) {
					found = item;
					return true;
				}
			}
			return false;
		},
		{ timeout: SELECT_TIMEOUT, timeoutMsg: `suggestion item containing "${text}" never appeared` },
	);
	if (found === undefined) {
		throw new Error(`suggestion item containing "${text}" never appeared`);
	}
	return found;
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
			expect(invalidRowText?.errorText).toEqual(
				'Unknown status "banana" (allowed: todo, in-progress, done, cancelled), Invalid due "not-a-date"',
			);
		});

		it("renders the priority, project and tags chips for the extended fixture task", async function () {
			const task = fixtures.tasks[0];
			if (task === undefined) {
				throw new Error("expected fixtures.tasks[0] (Overdue task) to exist");
			}

			const chipInfo = await browser.execute(
				(rowCls, titleCls, priorityCls, projectCls, tagCls, wantedTitle) => {
					for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
						const titleEl = row.querySelector(`.${titleCls}`);
						if (titleEl?.textContent !== wantedTitle) {
							continue;
						}
						const priorityEl = row.querySelector(`.${priorityCls}`);
						const projectEl = row.querySelector(`.${projectCls}`);
						const tagEls = Array.from(row.querySelectorAll(`.${tagCls}`));
						return {
							priorityText: priorityEl?.textContent ?? null,
							priorityClasses: priorityEl === null ? [] : Array.from(priorityEl.classList),
							projectText: projectEl?.textContent ?? null,
							tagTexts: tagEls.map((el) => el.textContent),
						};
					}
					return null;
				},
				cssClass("feed__row"),
				cssClass("feed__title"),
				cssClass("feed__priority"),
				cssClass("feed__project"),
				cssClass("feed__tag"),
				task.title,
			);

			expect(chipInfo).not.toBeNull();
			expect(chipInfo?.priorityText).toEqual("High");
			expect(chipInfo?.priorityClasses).toContain(cssClass(priorityChipClass("high")));
			expect(chipInfo?.projectText).toEqual("Q3 Launch");
			expect(chipInfo?.tagTexts).toEqual(["#work", "#urgent"]);
		});

		it("date chip opens DateModal pre-filled and dispatches setDate on save", async function () {
			const task = fixtures.tasks[0];
			if (task === undefined) {
				throw new Error("expected fixtures.tasks[0] (Overdue task) to exist");
			}
			const path = `Tasks/${task.filename}`;

			await clickFeedDateChip(task.title);

			const modalCls = cssClass("date-modal");
			await browser.$(`.${modalCls}`).waitForExist({ timeout: SELECT_TIMEOUT });

			const initialInputValue = await browser.execute((cls) => {
				const input = document.querySelector(`.${cls} input[type="date"]`);
				return input instanceof HTMLInputElement ? input.value : null;
			}, modalCls);
			expect(initialInputValue).toEqual(task.frontmatter["due"]);

			// Same "set + dispatch input/change" technique as the "Create task
			// modal" test below: wdio's character-by-character setValue is
			// unreliable against input[type="date"] in this Electron build.
			const newDue = format(addDays(parseISO(fixtures.today), 10), "yyyy-MM-dd");
			await browser.execute(
				(cls, value) => {
					const input = document.querySelector(`.${cls} input[type="date"]`);
					if (input instanceof HTMLInputElement) {
						input.value = value;
						input.dispatchEvent(new Event("input", { bubbles: true }));
						input.dispatchEvent(new Event("change", { bubbles: true }));
					}
				},
				modalCls,
				newDue,
			);

			await browser.$(`.${modalCls} button.mod-cta`).click();

			await waitForFrontmatter(path, "due", (v) => v === newDue, `${path} due date never updated via the feed's date chip`);
			const fm = await frontmatterOf(path);
			expect(fm?.["due"]).toEqual(newDue);
		});

		it("priority control opens buildPriorityMenu and dispatches setPriority on pick", async function () {
			// Defaults to "normal" (no explicit `priority` in its frontmatter,
			// per `e2e/fixtures.ts`), so picking "High" is an observable change.
			const task = fixtures.tasks[2];
			if (task === undefined) {
				throw new Error("expected fixtures.tasks[2] (This week or next week task) to exist");
			}
			const path = `Tasks/${task.filename}`;

			await clickFeedPriorityControl(task.title);

			for (const label of ["Low", "Normal", "High", "Urgent"]) {
				await browser.$(`.menu-item-title=${label}`).waitForDisplayed({ timeout: SELECT_TIMEOUT });
			}

			if (process.env["E2E_SCREENSHOT"] === "1") {
				await saveScreenshot("feed-priority-menu");
			}

			await browser.$(".menu-item-title=High").click();

			await waitForFrontmatter(path, "priority", (v) => v === "high", `${path} priority never updated via the feed's priority control`);
			const fm = await frontmatterOf(path);
			expect(fm?.["priority"]).toEqual("high");

			// The Bases view re-renders on the metadata cache's own "resolved"
			// event, which can lag a tick behind `waitForFrontmatter`'s cache
			// read above — poll the row's text rather than reading it once.
			let rowPriorityText: string | null = null;
			await browser.waitUntil(
				async () => {
					rowPriorityText = await browser.execute(
						(rowCls, titleCls, priorityCls, wantedTitle) => {
							for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
								const titleEl = row.querySelector(`.${titleCls}`);
								if (titleEl?.textContent === wantedTitle) {
									return row.querySelector(`.${priorityCls}`)?.textContent ?? null;
								}
							}
							return null;
						},
						cssClass("feed__row"),
						cssClass("feed__title"),
						cssClass("feed__priority"),
						task.title,
					);
					return rowPriorityText === "High";
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: `${task.title}'s priority chip never re-rendered as "High"` },
			);
			expect(rowPriorityText).toEqual("High");
		});

		it("right-click on a row opens buildTaskEditMenu with a Project… entry", async function () {
			const task = fixtures.tasks[3];
			if (task === undefined) {
				throw new Error("expected fixtures.tasks[3] (Later task) to exist");
			}

			await rightClickFeedRow(task.title);

			const projectItem = browser.$(".menu-item-title=Project…");
			await projectItem.waitForDisplayed({ timeout: SELECT_TIMEOUT });
			expect(await projectItem.isDisplayed()).toBe(true);

			if (process.env["E2E_SCREENSHOT"] === "1") {
				await saveScreenshot("feed-row-context-menu");
			}

			// Closes the menu without picking anything, so it doesn't leak into
			// later tests sharing this window.
			await browser.keys("Escape");
		});
	});

	/**
	 * Probe-style test (docs/CONVENTIONS.md "Probing Obsidian's live DOM/CSS")
	 * answering the M2 plan's open question: does editing a Bases-native view
	 * option (the `dateSource`/`showEmptyBuckets`/`completedAtBottom` options
	 * registered in `views/bases/register.ts`) actually trigger a re-render
	 * without any extra plumbing? Empirically: yes — `BasesViewConfig.set()`
	 * alone (no manual `onDataUpdated()` call) is enough; Bases owns config
	 * reactivity and calls back into the view itself. `feed-view.ts` needed no
	 * change for this. Does not drive Bases' own view-options panel UI (that's
	 * Bases' DOM, not obtask's) — flips the option programmatically instead,
	 * via an internal (undocumented, not in `obsidian.d.ts`) path found by
	 * inspecting the runtime "bases" leaf's prototype chain: the leaf's own
	 * view wraps a `controller` whose `.view` is the actual registered
	 * `FeedBasesView` instance, which exposes the public `config.set()` API.
	 */
	describe("Feed view options", function () {
		it("re-renders automatically when showEmptyBuckets changes via config.set()", async function () {
			const emptyBucketCls = cssClass("feed__bucket-empty");

			const before = await browser.execute((cls) => document.querySelectorAll(`.${cls}`).length, emptyBucketCls);
			expect(before).toEqual(0);

			await browser.executeObsidian(({ app }) => {
				const leaves = app.workspace.getLeavesOfType("bases");
				const leaf = leaves[0];
				if (leaf === undefined) {
					throw new Error("no bases leaf found");
				}
				const outerView = leaf.view as unknown as {
					controller: { view: { config: { set: (key: string, value: unknown) => void } } };
				};
				outerView.controller.view.config.set("showEmptyBuckets", true);
			});

			await browser.$(`.${emptyBucketCls}`).waitForExist({ timeout: SELECT_TIMEOUT });

			const after = await browser.execute((cls) => document.querySelectorAll(`.${cls}`).length, emptyBucketCls);
			expect(after).toBeGreaterThan(0);
		});

		/**
		 * `domain/feed-row.ts#feedRowColumns` maps the Bases toolbar's
		 * "Properties" order (`BasesViewConfig.getOrder()`) to which extra
		 * columns a feed row renders. `setOrder` isn't declared on
		 * `BasesViewConfig` in `obsidian.d.ts` (only `getOrder`/`getSort`/
		 * `get`/`set`/`getDisplayName`), but it exists at runtime and is what
		 * `getFeedOrder`/`setFeedOrder` (above) actually use — probed here
		 * because `config.set("order", [...])`, the documented-shape
		 * fallback, was tried first and silently no-ops on this build
		 * (`getOrder()` doesn't reflect it). Narrowing the order to
		 * `file.name`/status only should drop every date chip while the
		 * status control stays.
		 */
		it("date chips follow the Bases toolbar's Properties order (setOrder)", async function () {
			const dateCls = cssClass("feed__date");
			const statusCls = cssClass("feed__status");

			await browser.$(`.${dateCls}`).waitForExist({ timeout: SELECT_TIMEOUT });
			const before = await browser.execute((cls) => document.querySelectorAll(`.${cls}`).length, dateCls);
			expect(before).toBeGreaterThan(0);

			const previousOrder = await getFeedOrder();

			try {
				const { usedSetOrder } = await setFeedOrder(["file.name", "note.status"]);
				expect(usedSetOrder).toBe(true);

				await browser.waitUntil(
					async () => (await browser.execute((cls) => document.querySelectorAll(`.${cls}`).length, dateCls)) === 0,
					{ timeout: SELECT_TIMEOUT, timeoutMsg: "feed__date chips never disappeared after narrowing Properties to file.name/status" },
				);

				const [dateCount, statusCount] = await Promise.all([
					browser.execute((cls) => document.querySelectorAll(`.${cls}`).length, dateCls),
					browser.execute((cls) => document.querySelectorAll(`.${cls}`).length, statusCls),
				]);
				expect(dateCount).toEqual(0);
				expect(statusCount).toBeGreaterThan(0);

				if (process.env["E2E_SCREENSHOT"] === "1") {
					await saveScreenshot("feed-properties");
				}
			} finally {
				// Restores the fixture's Feed view to its original Properties
				// order so this spec (and `e2e/vault/Tasks.base` on disk, since
				// Bases persists `.base`-view config back to the file) is left
				// untouched for later tests / `git status`.
				await setFeedOrder(previousOrder);
				await browser.$(`.${dateCls}`).waitForExist({ timeout: SELECT_TIMEOUT });
			}
		});

		/**
		 * Screenshots for the "New/Search (Bases toolbar)" work: the feed at
		 * its default Properties order (chips visible), and again after
		 * widening the order with an extra generic property (`file.mtime`,
		 * not one of the feed's first-class columns — see "Properties (Bases
		 * toolbar)" in `docs/DOMAIN-MODEL.md`) to show the muted generic
		 * chip it renders. Always taken (not gated behind `E2E_SCREENSHOT`)
		 * since they're the deliverable here, not just a debugging aid.
		 */
		it("captures the feed at its default order and again with a generic chip", async function () {
			const screenshotOutDir = "/Users/dgopsq/.claude/jobs/4adbd2c8/tmp";

			await browser.$(`.${cssClass("feed__row")}`).waitForExist({ timeout: SELECT_TIMEOUT });
			await saveScreenshotAt(`${screenshotOutDir}/feed-default-order.png`);

			const defaultOrder = await getFeedOrder();
			try {
				const genericCls = cssClass("feed__generic");
				const { usedSetOrder } = await setFeedOrder([...defaultOrder, "file.mtime"]);
				expect(usedSetOrder).toBe(true);

				await browser.$(`.${genericCls}`).waitForExist({ timeout: SELECT_TIMEOUT });
				await saveScreenshotAt(`${screenshotOutDir}/feed-generic-chip.png`);
			} finally {
				await setFeedOrder(defaultOrder);
				await browser.$(`.${cssClass("feed__date")}`).waitForExist({ timeout: SELECT_TIMEOUT });
			}
		});
	});

	describe("Search (Bases toolbar)", function () {
		async function setSearchQuery(query: string): Promise<void> {
			await browser.executeObsidian(({ app }, q: string) => {
				const leaves = app.workspace.getLeavesOfType("bases");
				const leaf = leaves[0];
				if (leaf === undefined) {
					throw new Error("no bases leaf found");
				}
				const outerView = leaf.view as unknown as { controller: { updateSearchQuery: (query: string) => void } };
				outerView.controller.updateSearchQuery(q);
			}, query);
		}

		async function feedRowTitles(): Promise<string[]> {
			return browser.execute(
				(rowCls, titleCls) =>
					Array.from(document.querySelectorAll(`.${rowCls}`)).map((row) => row.querySelector(`.${titleCls}`)?.textContent ?? ""),
				cssClass("feed__row"),
				cssClass("feed__title"),
			);
		}

		afterEach(async function () {
			// Never leave a search query applied for a later test in this file.
			await setSearchQuery("");
			await browser.waitUntil(async () => (await feedRowTitles()).length > 0, { timeout: SELECT_TIMEOUT });
		});

		it("narrows the feed to rows matching the query, then restores every row once cleared", async function () {
			const before = await feedRowTitles();
			expect(before.length).toBeGreaterThan(0);

			await setSearchQuery("Team");
			await browser.waitUntil(
				async () => {
					const titles = await feedRowTitles();
					return titles.length > 0 && titles.length < before.length;
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: 'feed row count never dropped after searching "Team"' },
			);

			const filtered = await feedRowTitles();
			for (const title of filtered) {
				expect(title.toLowerCase()).toContain("team");
			}

			await setSearchQuery("");
			await browser.waitUntil(async () => (await feedRowTitles()).length === before.length, {
				timeout: SELECT_TIMEOUT,
				timeoutMsg: "feed row count never restored after clearing the search query",
			});
		});
	});

	/**
	 * Simulates exactly what the Bases toolbar's `+ New` button produces
	 * against `Tasks.base`'s filters (`type == "task"`, every status filter a
	 * `!=` — see `app/generate-base.ts`): a note with the marker property and
	 * no `status` at all. Per ADR 0012 this must parse as a normal open task,
	 * not the red "could not be parsed" row it was before that decision.
	 */
	describe("New (Bases toolbar)", function () {
		const path = "Tasks/Toolbar new.md";

		afterEach(async function () {
			await browser.executeObsidian(async ({ app }, p: string) => {
				const file = app.vault.getFileByPath(p);
				if (file !== null) {
					await app.fileManager.trashFile(file);
				}
			}, path);
		});

		it("parses a status-less note as an open task with the first configured open status", async function () {
			await browser.executeObsidian(async ({ app }, p: string) => {
				await app.vault.create(p, "---\ntype: task\n---\n");
			}, path);

			await browser.waitUntil(
				async () => {
					const titles = await browser.execute(
						(rowCls, rowInvalidCls, titleCls) =>
							Array.from(document.querySelectorAll(`.${rowCls}:not(.${rowInvalidCls})`)).map(
								(row) => row.querySelector(`.${titleCls}`)?.textContent ?? "",
							),
						cssClass("feed__row"),
						cssClass("feed__row--invalid"),
						cssClass("feed__title"),
					);
					return titles.includes("Toolbar new");
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: '"Toolbar new" never rendered as a valid (non-invalid) feed row' },
			);

			const statusLabel = await browser.execute(
				(rowCls, rowInvalidCls, titleCls, statusLabelCls, wantedTitle) => {
					for (const row of Array.from(document.querySelectorAll(`.${rowCls}:not(.${rowInvalidCls})`))) {
						const titleEl = row.querySelector(`.${titleCls}`);
						if (titleEl?.textContent === wantedTitle) {
							return row.querySelector(`.${statusLabelCls}`)?.textContent ?? null;
						}
					}
					return null;
				},
				cssClass("feed__row"),
				cssClass("feed__row--invalid"),
				cssClass("feed__title"),
				cssClass("feed__status-label"),
				"Toolbar new",
			);
			expect(statusLabel).toEqual("To do");
		});
	});

	/**
	 * `.ec` is Event Calendar's own root class (rendered inside our
	 * `.obtask-calendar` wrapper — see `calendar-view.ts`); `.ec-event` is
	 * its per-event element, which carries the extra classes
	 * `event-calendar-mapping.ts#toEventCalendarEvent` attaches
	 * (`obtask-event`, `obtask-event--due`/`--scheduled`,
	 * `obtask-priority-*`) alongside Event Calendar's own. Reads every
	 * rendered event's title text + full class list in one pass so a test
	 * can filter/assert without a second round trip into the Obsidian window.
	 */
	async function readCalendarEvents(): Promise<{ readonly title: string; readonly className: string }[]> {
		return browser.execute(
			(eventCls) =>
				Array.from(document.querySelectorAll(`.${eventCls}`)).map((el) => ({
					title: el.querySelector(".ec-event-title")?.textContent ?? "",
					className: el.className,
				})),
			cssClass("event"),
		);
	}

	/**
	 * The week/day all-day row's chips, in DOM order (which is also their
	 * on-screen top-to-bottom order — see `sortCalendarEvents`,
	 * `domain/calendar-events.ts`). `time` reads `event-content.ts`'s custom
	 * `.obtask-event-time` label (empty string for a date-only chip, which
	 * carries no such element), separately from `.ec-event-title`'s own
	 * text — the title is no longer prefixed with the time, see ADR 0011's
	 * update and the "renders a timed due..." test below.
	 */
	async function readAllDayChips(): Promise<{ readonly time: string; readonly title: string }[]> {
		return browser.execute(
			(eventCls, timeCls) =>
				Array.from(document.querySelectorAll(`.ec-all-day .${eventCls}`)).map((el) => ({
					time: el.querySelector(`.${timeCls}`)?.textContent ?? "",
					title: el.querySelector(".ec-event-title")?.textContent ?? "",
				})),
			cssClass("event"),
			cssClass("event-time"),
		);
	}

	/**
	 * `.ec-toolbar`/`.ec-button`/`.ec-active` are Event Calendar's own class
	 * names for its header toolbar (confirmed against the vendored source,
	 * `@event-calendar/core/src/{Toolbar,Buttons}.svelte` and
	 * `storage/options.js`'s `theme` defaults — not documented in the
	 * package's public API surface). `prev`/`next` are icon-only buttons
	 * (an `<i>` child, no text node) labelled via `aria-label`/`title`
	 * instead of visible text; every other toolbar button (today, and the
	 * one per registered view) renders its `buttonText[...]` value as plain
	 * text. This regression-tests the `buttonText` bug fixed in `fcc7e6b`
	 * (`event-calendar-renderer.ts`): Event Calendar *replaces* its default
	 * `buttonText` map with the one passed in, so an incomplete map rendered
	 * blank buttons — and nothing in the e2e suite asserted visible text
	 * before this test existed.
	 */
	async function readToolbarButtons(): Promise<
		{ readonly text: string; readonly ariaLabel: string | null; readonly title: string | null; readonly isActive: boolean }[]
	> {
		return browser.execute(
			(calendarCls) =>
				Array.from(document.querySelectorAll(`.${calendarCls} .ec-toolbar .ec-button`)).map((el) => ({
					text: el.textContent,
					ariaLabel: el.getAttribute("aria-label"),
					title: el.getAttribute("title"),
					isActive: el.classList.contains("ec-active"),
				})),
			cssClass("calendar"),
		);
	}

	describe("Calendar view", function () {
		before(async function () {
			// Switch from the default "Feed" view to "Calendar" through the Bases
			// view switcher UI: a toolbar button (`.bases-toolbar-views-menu`) opens
			// a menu (`.bases-toolbar-menu-item`) listing each configured view by
			// its name (per e2e/vault/Tasks.base — "Feed", "Calendar", "All tasks").
			await browser.$(".workspace-leaf.mod-active .bases-toolbar-views-menu .text-icon-button").click();
			await browser.$(".bases-toolbar-menu-item-name=Calendar").click();

			await browser.$(`.${cssClass("calendar")} .ec`).waitForExist({ timeout: SELECT_TIMEOUT });
		});

		after(async function () {
			if (process.env["E2E_SCREENSHOT"] === "1") {
				await saveScreenshot("calendar");
			}
		});

		it("renders the Event Calendar root inside .obtask-calendar, in the default month view", async function () {
			await expect(browser.$(`.${cssClass("calendar")} .ec`)).toExist();
			// Month view renders an `.ec-day-grid` grid and no `.ec-week-view` —
			// the inverse of the "week" assertion below.
			await expect(browser.$(`.${cssClass("calendar")} .ec-day-grid`)).toExist();
			await expect(browser.$(`.${cssClass("calendar")} .ec-week-view`)).not.toExist();
		});

		it("renders non-blank toolbar button labels, with Month active by default", async function () {
			const buttons = await readToolbarButtons();
			expect(buttons.length).toBeGreaterThan(0);

			// Every button carries a visible label, one way or another: plain
			// text for todo/view buttons, aria-label (mirrored onto title) for
			// the icon-only prev/next pair.
			for (const button of buttons) {
				expect(button.text.trim().length > 0 || (button.ariaLabel ?? "").trim().length > 0).toBe(true);
			}

			const prev = buttons.find((b) => b.ariaLabel === "Previous");
			const next = buttons.find((b) => b.ariaLabel === "Next");
			expect(prev).toBeDefined();
			expect(prev?.title).toEqual("Previous");
			expect(next).toBeDefined();
			expect(next?.title).toEqual("Next");

			// The text-bearing buttons, in render order: today, then the
			// per-view buttons (see `headerToolbar` in
			// event-calendar-renderer.ts — prev/next render between "today"
			// and the view buttons but carry no text, so they fall out here).
			const textLabels = buttons.map((b) => b.text.trim()).filter((t) => t.length > 0);
			expect(textLabels).toEqual(["Today", "Month", "Week", "Day"]);

			const active = buttons.filter((b) => b.isActive);
			expect(active).toHaveLength(1);
			expect(active[0]?.text.trim()).toEqual("Month");
		});

		it("renders the due-today fixture task as a due event with its priority class", async function () {
			await browser.waitUntil(
				async () => (await readCalendarEvents()).some((e) => e.title === "Today task"),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Today task event never appeared" },
			);

			const events = await readCalendarEvents();
			const dueEvent = events.find((e) => e.title === "Today task" && e.className.includes(cssClass("event--due")));
			expect(dueEvent).toBeDefined();
			expect(dueEvent?.className).toContain(cssClass(priorityChipClass("normal")));

			// The `after` screenshot captures whatever state the last test
			// leaves (the week view, after switching `initialView` to "week");
			// this one shows the month view with events for visual checks.
			if (process.env["E2E_SCREENSHOT"] === "1") {
				await saveScreenshot("calendar-month");

				// A separate hover screenshot: moves the mouse onto one event so
				// the `:hover` background (`--background-modifier-border`, not
				// the accent-tinted `--background-modifier-active-hover`) is
				// actually visible in the capture, not just in the stylesheet.
				// `moveTo()` alone doesn't *prove* the hover fired — a prior
				// version of this test saved a screenshot right after `moveTo()`
				// with no assertion, and it turned out pixel-identical to
				// `calendar-month.png` (the hover never actually landed on the
				// element by the time the capture ran). So: read the hovered
				// event's own `background-color` and a second, untouched
				// event's, and assert they differ *before* trusting the
				// screenshot — a real signal that `:hover` actually applied,
				// not just that `moveTo()` resolved.
				const eventEls = await browser.$$(`.${cssClass("event")}`).getElements();
				await expect(eventEls).toBeElementsArrayOfSize({ gte: 2 });
				const [hoveredEl, otherEl] = eventEls;
				if (hoveredEl === undefined || otherEl === undefined) {
					throw new Error("expected at least two calendar events for the hover comparison");
				}

				await hoveredEl.moveTo();
				// `:hover` is a live CSS pseudo-class, not something that
				// commits on a rAF/transition — the 150ms pause guards against
				// the (Electron/chromedriver) input event and the subsequent
				// style read racing each other, not against any CSS animation.
				await browser.pause(150);

				const hoveredColor = await hoveredEl.getCSSProperty("background-color");
				const otherColor = await otherEl.getCSSProperty("background-color");
				expect(hoveredColor.value).not.toEqual(otherColor.value);

				await saveScreenshot("calendar-hover");
			}
		});

		/**
		 * "Today task" carries both `due` (today) and `scheduled`
		 * (`fixtures.todayTaskScheduled`) — see `e2e/fixtures.ts`. Default
		 * `events: both` renders one event per field; switching to
		 * `events: scheduled` (same `config.set()` path M2 proved re-renders
		 * with no extra plumbing — see the "Feed view options" describe
		 * block above) should drop the due event and keep the scheduled one.
		 */
		it("re-renders with only the scheduled event when the events option changes to scheduled", async function () {
			await browser.executeObsidian(({ app }) => {
				const leaves = app.workspace.getLeavesOfType("bases");
				const leaf = leaves[0];
				if (leaf === undefined) {
					throw new Error("no bases leaf found");
				}
				const outerView = leaf.view as unknown as {
					controller: { view: { config: { set: (key: string, value: unknown) => void } } };
				};
				outerView.controller.view.config.set("events", "scheduled");
			});

			await browser.waitUntil(
				async () => !(await readCalendarEvents()).some((e) => e.className.includes(cssClass("event--due"))),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "due event never disappeared after switching to events: scheduled" },
			);

			const events = await readCalendarEvents();
			const scheduledEvent = events.find(
				(e) => e.title === "Today task" && e.className.includes(cssClass("event--scheduled")),
			);
			expect(scheduledEvent).toBeDefined();
			expect(events.some((e) => e.className.includes(cssClass("event--due")))).toBe(false);
		});

		it("switches the Event Calendar view class when initialView changes to week", async function () {
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

			// Event Calendar's `timeGridWeek` view themes its root with
			// `ec-time-grid ec-week-view` (confirmed against the vendored
			// source, `@event-calendar/core/src/plugins/time-grid/index.js`) —
			// `.ec-week-view` is the class unique to that view in this app
			// (the only other views registered are `dayGridMonth`/`timeGridDay`).
			await browser.$(`.${cssClass("calendar")} .ec-week-view`).waitForExist({ timeout: SELECT_TIMEOUT });
			await expect(browser.$(`.${cssClass("calendar")} .ec-day-grid`)).not.toExist();

			// Visual check for the week view's time-grid rendering (event
			// padding/inset in the all-day row against a narrower, timed-slot
			// layout) — see calendar.css's Obsidian-style pass. The previous
			// test left `events: scheduled`, whose only event falls outside
			// this week (`todayTaskScheduled` is `today + 3`), so restore
			// `events: both` first to get "Today task"'s due event (today,
			// always inside this week) back into frame.
			if (process.env["E2E_SCREENSHOT"] === "1") {
				await browser.executeObsidian(({ app }) => {
					const leaves = app.workspace.getLeavesOfType("bases");
					const leaf = leaves[0];
					if (leaf === undefined) {
						throw new Error("no bases leaf found");
					}
					const outerView = leaf.view as unknown as {
						controller: { view: { config: { set: (key: string, value: unknown) => void } } };
					};
					outerView.controller.view.config.set("events", "both");
				});
				await browser.waitUntil(
					async () => (await readCalendarEvents()).some((e) => e.title === "Today task"),
					{ timeout: SELECT_TIMEOUT, timeoutMsg: "Today task event never reappeared for the week screenshot" },
				);

				// "Team sync" (`scheduled` + `duration`, today 09:00) is the
				// only fixture that renders as a genuine timed block in the
				// time grid, not just an all-day marker — see fixtures.ts.
				// `.ec-body` (the time-grid's scrollable slot area, see
				// calendar.css's own scoping) is required here, not just
				// `.ec-time-grid .ec-event` — the all-day row is *also* nested
				// under `.ec-time-grid` as a sibling of `.ec-body`, so the
				// looser selector matches an all-day event first. `height:
				// "auto"` renders the full 00:00-24:00 grid (see the EC option
				// notes above `EventCalendarRenderer`), so without scrolling,
				// 09:00 can land below the fold and the screenshot would miss
				// the very block this test exists to check.
				const timedEventEl = browser.$(`.${cssClass("calendar")} .ec-time-grid .ec-body .ec-event`);
				await timedEventEl.waitForExist({ timeout: SELECT_TIMEOUT });
				// Scroll only the time grid's own scroll container
				// (`.ec-main`, `overflow: auto` in the vendored stylesheet) to
				// its very top, not `scrollIntoView` on the target block —
				// Event Calendar auto-scrolls that container to the current
				// wall-clock time on mount, and centering the target in the
				// viewport (a prior version of this screenshot did) scrolls the
				// all-day row (ADR 0011's new home for point events, in normal
				// document flow just above the hour grid, not pinned) almost
				// entirely out of frame. Scrolling to the top instead keeps the
				// all-day row AND the whole morning (including "Team
				// sync"/09:00 and "Standup"/11:00) in view within one capture.
				await browser.execute((calendarCls) => {
					const main = document.querySelector(`.${calendarCls} .ec-main`);
					if (main !== null) {
						main.scrollTop = 0;
					}
				}, cssClass("calendar"));

				await saveScreenshot("calendar-week");
			}
		});

		/**
		 * Day view's time grid is the same `.ec-time-grid` theme as week
		 * (just one column instead of seven — see the `ec-week-view` test
		 * above), so it renders the same timed blocks with the same
		 * `@container obtask-event` height-query rule (`calendar.css`) that
		 * hides `.ec-event-time` in a too-short block. "Team sync" (1-hour,
		 * `slotHeight: 32` -> ~32px block) is below the rule's 3.5em/~42px
		 * threshold and must hide its time line; "Planning session"
		 * (2-hour, ~64px block, `e2e/fixtures.ts`) is above it and must
		 * show a non-empty one.
		 */
		it("hides the time line in a too-short timed block but shows it in a tall one (day view)", async function () {
			await browser.executeObsidian(({ app }) => {
				const leaves = app.workspace.getLeavesOfType("bases");
				const leaf = leaves[0];
				if (leaf === undefined) {
					throw new Error("no bases leaf found");
				}
				const outerView = leaf.view as unknown as {
					controller: { view: { config: { set: (key: string, value: unknown) => void } } };
				};
				outerView.controller.view.config.set("initialView", "day");
			});

			await browser.$(`.${cssClass("calendar")} .ec-day-view`).waitForExist({ timeout: SELECT_TIMEOUT });

			const timedEventEl = browser.$(`.${cssClass("calendar")} .ec-time-grid .ec-body .ec-event`);
			await timedEventEl.waitForExist({ timeout: SELECT_TIMEOUT });

			// Scroll the time grid's own scroll container to the top, same
			// reasoning as the week-view screenshot above: EC auto-scrolls to
			// the current wall-clock time on mount, which can push the
			// morning/afternoon blocks used here out of frame.
			await browser.execute((calendarCls) => {
				const main = document.querySelector(`.${calendarCls} .ec-main`);
				if (main !== null) {
					main.scrollTop = 0;
				}
			}, cssClass("calendar"));

			async function timeLineOf(title: string): Promise<{ readonly display: string; readonly text: string | null } | null> {
				return browser.execute(
					(bodyCls, titleCls, timeCls, wantedTitle) => {
						for (const body of Array.from(document.querySelectorAll(`.${bodyCls}`))) {
							const titleEl = body.querySelector(`.${titleCls}`);
							if (titleEl?.textContent !== wantedTitle) {
								continue;
							}
							const timeEl = body.querySelector(`.${timeCls}`);
							if (timeEl === null) {
								return null;
							}
							return { display: getComputedStyle(timeEl).display, text: timeEl.textContent };
						}
						return null;
					},
					"ec-event-body",
					"ec-event-title",
					"ec-event-time",
					title,
				);
			}

			const teamSyncTime = await timeLineOf("Team sync");
			expect(teamSyncTime).not.toBeNull();
			expect(teamSyncTime?.display).toEqual("none");

			const planningTime = await timeLineOf("Planning session");
			expect(planningTime).not.toBeNull();
			expect(planningTime?.display).not.toEqual("none");
			expect((planningTime?.text ?? "").trim().length).toBeGreaterThan(0);

			if (process.env["E2E_SCREENSHOT"] === "1") {
				await saveScreenshot("calendar-day");
			}
		});

		/**
		 * "Deadline call" (`due: <today>T14:30`, no `scheduled` — see
		 * `e2e/fixtures.ts`) is a timed `due` fixture. Per ADR 0011, a
		 * zero-duration point event (a timed `due`, or a timed `scheduled`
		 * with no `duration`) renders as an all-day chip rather than a
		 * colliding marker in the time-grid body; per the follow-up fix, its
		 * time is shown as a separate `.obtask-event-time` label
		 * (`event-content.ts`) rather than prefixed onto the title — this
		 * asserts both the chip placement (present in `.ec-all-day`, absent
		 * from `.ec-time-grid .ec-body`) and that split rendering (the time
		 * label reads "14:30", the title reads exactly "Deadline call").
		 * Restores `events: both` itself (rather than depending on the
		 * previous, screenshot-only restore) since the "re-renders with only
		 * the scheduled event..." test earlier in this file may have left
		 * `events: scheduled`, which would hide "Deadline call"'s due event
		 * (and this whole assertion) entirely.
		 */
		it("renders a timed due as an all-day chip with a separate muted time label, not a time-grid marker", async function () {
			await browser.executeObsidian(({ app }) => {
				const leaves = app.workspace.getLeavesOfType("bases");
				const leaf = leaves[0];
				if (leaf === undefined) {
					throw new Error("no bases leaf found");
				}
				const outerView = leaf.view as unknown as {
					controller: { view: { config: { set: (key: string, value: unknown) => void } } };
				};
				outerView.controller.view.config.set("events", "both");
			});

			await browser.waitUntil(
				async () => (await readCalendarEvents()).some((e) => e.title === "Deadline call"),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Deadline call's all-day chip never appeared" },
			);

			const chips = await readAllDayChips();
			const deadlineChip = chips.find((c) => c.title === "Deadline call");
			expect(deadlineChip).toBeDefined();
			expect(deadlineChip?.time).toBe("14:30");

			const timeGridTitles = await browser.execute(() =>
				Array.from(document.querySelectorAll(".ec-time-grid .ec-body .ec-event-title")).map((el) => el.textContent),
			);
			expect(timeGridTitles.some((title) => title.includes("Deadline call"))).toBe(false);
		});

		/**
		 * "Early ping" (09:15), "Late ping" (11:45) and "Deadline call"
		 * (14:30) are three timed-`due` fixtures today (`e2e/fixtures.ts`),
		 * alongside at least one date-only due-today fixture ("Today task").
		 * Event Calendar normalises all-day events' `start` to midnight
		 * before its own (stable) sort, so same-day chips at different times
		 * of day would tie there and keep insertion order — this is what
		 * `domain/calendar-events.ts#sortCalendarEvents` (applied in
		 * `calendar-view.ts` before events reach the renderer) actually
		 * fixes: date-only chips first, then timed chips in time order.
		 * Runs on the day view left active by the previous test, whose
		 * all-day row holds only today's chips (a broader view would also
		 * capture other days' chips, whose relative order isn't this test's
		 * concern).
		 */
		it("orders today's all-day chips: date-only first, then timed chips by time of day", async function () {
			const chips = await readAllDayChips();

			const earlyIndex = chips.findIndex((c) => c.title === "Early ping");
			const lateIndex = chips.findIndex((c) => c.title === "Late ping");
			const deadlineIndex = chips.findIndex((c) => c.title === "Deadline call");
			expect(earlyIndex).toBeGreaterThanOrEqual(0);
			expect(lateIndex).toBeGreaterThanOrEqual(0);
			expect(deadlineIndex).toBeGreaterThanOrEqual(0);
			expect(earlyIndex).toBeLessThan(lateIndex);
			expect(lateIndex).toBeLessThan(deadlineIndex);

			expect(chips[earlyIndex]?.time).toBe("09:15");
			expect(chips[lateIndex]?.time).toBe("11:45");
			expect(chips[deadlineIndex]?.time).toBe("14:30");

			// Every date-only chip (no `.obtask-event-time` label, e.g. "Today
			// task") comes before every timed chip — checked as "the last
			// date-only chip's index is before the first timed chip's index"
			// rather than a hard-coded date-only title list, since which
			// other fixtures land in today's all-day row isn't this test's
			// concern.
			const dateOnlyIndexes = chips.map((c, i) => (c.time === "" ? i : -1)).filter((i) => i >= 0);
			const timedIndexes = chips.map((c, i) => (c.time !== "" ? i : -1)).filter((i) => i >= 0);
			expect(dateOnlyIndexes.length).toBeGreaterThan(0);
			expect(Math.max(...dateOnlyIndexes)).toBeLessThan(Math.min(...timedIndexes));
		});

		/**
		 * M4 "calendar interactions" (docs/ROADMAP.md, commits 47c9558, 866dc09,
		 * ec9cd87): clicking an event opens its note, clicking an empty
		 * day-grid cell opens the create-task modal pre-filled with that date,
		 * and dragging an event reschedules the underlying task. Each test
		 * below is self-contained about which calendar option it needs
		 * (explicit `config.set("initialView", "month")`) rather than relying
		 * on whatever state the tests above happened to leave the shared
		 * `CalendarBasesView` in.
		 */
		async function setCalendarInitialView(view: "month" | "week" | "day"): Promise<void> {
			await browser.executeObsidian(
				({ app }, v: string) => {
					const leaves = app.workspace.getLeavesOfType("bases");
					const leaf = leaves[0];
					if (leaf === undefined) {
						throw new Error("no bases leaf found");
					}
					const outerView = leaf.view as unknown as {
						controller: { view: { config: { set: (key: string, value: unknown) => void } } };
					};
					outerView.controller.view.config.set("initialView", v);
				},
				view,
			);
		}

		/**
		 * Re-opens Tasks.base and switches to the Calendar view — used to
		 * restore the calendar after a test navigates away from it (clicking
		 * an event opens its note via `openLinkText(path, "", false)`, which
		 * replaces the leaf's Bases view with the plain note). Mirrors the
		 * top-level `before` hook + this describe's own `before` above.
		 */
		async function reopenCalendarView(): Promise<void> {
			await browser.executeObsidian(({ app }) => app.workspace.openLinkText("Tasks.base", "", false));
			await browser.$(`.${cssClass("feed")}`).waitForExist({ timeout: SELECT_TIMEOUT });

			// Re-clicks the views-menu toggle until the "Calendar" item shows up
			// — a single click occasionally lands before the toolbar has
			// finished re-attaching its handlers right after `openLinkText`
			// swaps the leaf's view back to a freshly mounted Bases file (the
			// menu opens then immediately closes, unlike this describe's own
			// `before` hook above, which does this exact click sequence once
			// against an already-settled window).
			const calendarMenuItem = browser.$(".bases-toolbar-menu-item-name=Calendar");
			await browser.waitUntil(
				async () => {
					if (await calendarMenuItem.isDisplayed().catch(() => false)) {
						return true;
					}
					await browser.$(".workspace-leaf.mod-active .bases-toolbar-views-menu .text-icon-button").click();
					return calendarMenuItem.isDisplayed().catch(() => false);
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: 'the "Calendar" view menu item never appeared' },
			);
			await calendarMenuItem.click();

			await browser.$(`.${cssClass("calendar")} .ec`).waitForExist({ timeout: SELECT_TIMEOUT });
		}

		/**
		 * Reads a raw frontmatter scalar out of a note's on-disk text (not the
		 * parsed `metadataCache`) — the most direct proof that a drag actually
		 * reached `app.fileManager.processFrontMatter` and landed on disk, per
		 * AGENTS.md's frontmatter-write rule. wdio-obsidian-service copies
		 * `e2e/vault/` into a temporary sandbox per run (`wdio.conf.mts`'s doc
		 * comment), so the file has to be read from `obsidianPage.getVaultPath()`,
		 * not the checked-in `e2e/vault/` path. Strips optional surrounding
		 * quotes since Obsidian's own YAML serialiser is free to add them on a
		 * rewrite, unlike `e2e/fixtures.ts`'s bare-scalar generator.
		 */
		async function frontmatterValueOnDisk(vaultRelativePath: string, key: string): Promise<string | undefined> {
			const content = await readFile(join(obsidianPage.getVaultPath(), vaultRelativePath), "utf8");
			const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(content);
			return match?.[1]?.trim().replace(/^["']|["']$/g, "");
		}

		it("clicking a calendar event opens the task note, then returns to the calendar view", async function () {
			await setCalendarInitialView("month");
			await browser.$(`.${cssClass("calendar")} .ec-day-grid`).waitForExist({ timeout: SELECT_TIMEOUT });

			await browser.waitUntil(
				async () => (await readCalendarEvents()).some((e) => e.title === "Today task" && e.className.includes(cssClass("event--due"))),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Today task's due event never appeared for the click-to-open test" },
			);

			const events = await readCalendarEvents();
			const index = events.findIndex((e) => e.title === "Today task" && e.className.includes(cssClass("event--due")));
			expect(index).toBeGreaterThanOrEqual(0);

			// Same technique as the hover screenshot above: read via
			// `readCalendarEvents()` (execute round trip), act via the matching
			// index into a `$$` array of real elements.
			const eventEls = await browser.$$(`.${cssClass("event")}`).getElements();
			const eventEl = eventEls[index];
			if (eventEl === undefined) {
				throw new Error("could not resolve the Today task due event element");
			}
			await eventEl.click();

			await browser.waitUntil(async () => (await activeFilePath()) === "Tasks/Today task.md", {
				timeout: SELECT_TIMEOUT,
				timeoutMsg: "clicking the event never opened Tasks/Today task.md",
			});

			await reopenCalendarView();
		});

		it("clicking an empty day-grid cell opens the create-task modal pre-filled with that date", async function () {
			await setCalendarInitialView("month");
			await browser.$(`.${cssClass("calendar")} .ec-day-grid`).waitForExist({ timeout: SELECT_TIMEOUT });
			await browser.waitUntil(async () => (await readCalendarEvents()).length > 0, {
				timeout: SELECT_TIMEOUT,
				timeoutMsg: "no calendar events rendered before locating an empty day cell",
			});

			// Finds a `.ec-day` cell whose rect doesn't overlap any rendered
			// event's rect. Events overlay the day grid as a separate,
			// absolutely positioned layer (`@event-calendar/core`'s own
			// `View.svelte` renders `.ec-day` cells and events in two sibling
			// containers, not events nested inside their day cell), so "empty"
			// has to be read from geometry rather than `cell.querySelector`.
			// Each cell's date comes from its `<time datetime="...">` child
			// (`BaseDay.svelte`/`Day.svelte`).
			const emptyCell = await browser.execute(
				(calendarCls, eventCls) => {
					const cells = Array.from(document.querySelectorAll(`.${calendarCls} .ec-day-grid .ec-day`));
					const eventRects = Array.from(document.querySelectorAll(`.${calendarCls} .ec-day-grid .${eventCls}`)).map((el) =>
						el.getBoundingClientRect(),
					);
					for (let i = 0; i < cells.length; i++) {
						const cell = cells[i];
						if (cell === undefined) {
							continue;
						}
						const dateAttr = cell.querySelector("time[datetime]")?.getAttribute("datetime");
						if (dateAttr === null || dateAttr === undefined) {
							continue;
						}
						const rect = cell.getBoundingClientRect();
						const overlapsEvent = eventRects.some(
							(er) => !(er.right <= rect.left || er.left >= rect.right || er.bottom <= rect.top || er.top >= rect.bottom),
						);
						if (!overlapsEvent) {
							return { index: i, date: dateAttr };
						}
					}
					return null;
				},
				cssClass("calendar"),
				cssClass("event"),
			);
			if (emptyCell === null) {
				throw new Error("could not find an empty day-grid cell to click");
			}

			const dayCells = await browser.$$(`.${cssClass("calendar")} .ec-day-grid .ec-day`).getElements();
			const dayCell = dayCells[emptyCell.index];
			if (dayCell === undefined) {
				throw new Error("could not resolve the empty day cell element");
			}
			await dayCell.click();

			const modalCls = cssClass("create-task-modal");
			await browser.$(`.${modalCls}`).waitForExist({ timeout: SELECT_TIMEOUT });

			// The default `events: both` view option pre-fills `scheduled`, not
			// `due` (`CalendarBasesView#prefillForSlot`), which pulls "More
			// options" open automatically (`hasMoreOptionsPrefill`) — so the
			// *second* `input[type="date"]` in the modal (Due is always
			// rendered first, and stays empty here) is the pre-filled
			// Scheduled field.
			const scheduledInput = await inputAt(modalCls, "date", 1);
			expect(await scheduledInput.getValue()).toEqual(emptyCell.date);

			await browser.keys("Escape");
			await browser.$(`.${modalCls}`).waitForExist({ timeout: SELECT_TIMEOUT, reverse: true });
		});

		/**
		 * Drags "Today task"'s due event (today, month view) to an empty cell
		 * in the same grid row using wdio's low-level pointer Actions API — plain
		 * `.click()`/`execute()`-dispatched events don't work here because
		 * Event Calendar's drag (`Interaction` plugin, `Action.svelte`) is
		 * driven entirely off real `pointerdown`/`pointermove`/`pointerup`,
		 * not a `click` or HTML5 drag-and-drop event. Verified via the note's
		 * on-disk frontmatter (not `metadataCache`) — the most direct proof
		 * the drag reached `processFrontMatter` and landed on disk.
		 */
		it("dragging an event to a different day reschedules the task", async function () {
			await setCalendarInitialView("month");
			await browser.$(`.${cssClass("calendar")} .ec-day-grid`).waitForExist({ timeout: SELECT_TIMEOUT });

			await browser.waitUntil(
				async () => (await readCalendarEvents()).some((e) => e.title === "Today task" && e.className.includes(cssClass("event--due"))),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Today task's due event never appeared for the drag test" },
			);

			// Resolves viewport-relative center coordinates for the source
			// event and an empty target cell, rather than WebdriverIO element
			// handles: the pointerdown below flips the library's event display
			// to `"ghost"`/`"preview"` (`Action.svelte#move`), which re-renders
			// the source chip's own DOM node mid-gesture — a `move({ origin:
			// <element> })` pointing at that same element handle later in the
			// same action chain then fails with a stale element reference.
			// Plain coordinates sidestep that entirely.
			//
			// The target is picked as an empty cell in the *same grid row* as
			// the source (`Math.abs(rect.top - sourceRect.top)`), rather than
			// a fixed "tomorrow" offset: month view can span several rows
			// taller than the Obsidian window, and a fixed offset landed in
			// the next row down on a run where "today" fell on the last day
			// of its row (a Sunday, Monday-first week) — off-screen, which
			// wdio's pointer actions refuse ("move target out of bounds").
			// Same-row keeps the whole gesture within the visible viewport
			// regardless of which weekday the suite happens to run on.
			const dragPlan = await browser.execute(
				(calendarCls, eventCls, dueCls, excludeDate) => {
					const events = Array.from(document.querySelectorAll(`.${calendarCls} .${eventCls}`));
					const sourceEl = events.find(
						(el) => el.querySelector(".ec-event-title")?.textContent === "Today task" && el.classList.contains(dueCls),
					);
					if (sourceEl === undefined) {
						return null;
					}
					const sourceRect = sourceEl.getBoundingClientRect();
					const eventRects = events.map((el) => el.getBoundingClientRect());

					const cells = Array.from(document.querySelectorAll(`.${calendarCls} .ec-day-grid .ec-day`));
					const targetEl = cells.find((cell) => {
						const dateAttr = cell.querySelector("time[datetime]")?.getAttribute("datetime");
						if (dateAttr === null || dateAttr === undefined || dateAttr === excludeDate) {
							return false;
						}
						const rect = cell.getBoundingClientRect();
						if (Math.abs(rect.top - sourceRect.top) > rect.height / 2) {
							return false;
						}
						return !eventRects.some(
							(er) => !(er.right <= rect.left || er.left >= rect.right || er.bottom <= rect.top || er.top >= rect.bottom),
						);
					});
					if (targetEl === undefined) {
						return null;
					}
					const targetDate = targetEl.querySelector("time[datetime]")?.getAttribute("datetime");
					if (targetDate === null || targetDate === undefined) {
						return null;
					}
					const targetRect = targetEl.getBoundingClientRect();
					return {
						date: targetDate,
						source: { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 },
						target: { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 },
					};
				},
				cssClass("calendar"),
				cssClass("event"),
				cssClass("event--due"),
				fixtures.today,
			);
			if (dragPlan === null) {
				throw new Error("could not resolve Today task's due event and an empty same-row day cell for the drag");
			}
			const { date: targetDate, source, target } = dragPlan;

			// A real mouse-pointer drag: down on the event, a short intermediate
			// move to clear `eventDragMinDistance` (5px) and flip the library
			// into its dragging state, then a move onto the target cell before
			// releasing. `elementsFromPoint` (not `elementFromPoint`) is how the
			// library finds the day cell underneath the visually-on-top event
			// chip (`lib/dom.js#getElementWithPayload`), which is what makes
			// dragging the chip itself work at all.
			await browser
				.action("pointer", { parameters: { pointerType: "mouse" } })
				.move({ x: Math.round(source.x), y: Math.round(source.y), origin: "viewport" })
				.down({ button: 0 })
				.pause(50)
				.move({ x: Math.round(source.x) + 10, y: Math.round(source.y) + 10, origin: "viewport", duration: 100 })
				.move({ x: Math.round(target.x), y: Math.round(target.y), origin: "viewport", duration: 250 })
				.pause(50)
				.up({ button: 0 })
				.perform();

			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Today task.md", "due")) === targetDate,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: `Today task's on-disk "due" never became ${targetDate} after the drag` },
			);

			expect(await frontmatterValueOnDisk("Tasks/Today task.md", "due")).toEqual(targetDate);
		});

		/**
		 * Drags "Today task"'s due-event chip (month view) to an empty cell in
		 * the same grid row — same gesture as the "dragging an event to a
		 * different day reschedules the task" test above, reused (rather than
		 * duplicated) by the undo/redo tests below, for which the drag is only
		 * a means to have something to undo/redo. `currentDue` (rather than a
		 * fixed `fixtures.today`) is excluded from the candidate target cells
		 * since an earlier test in this suite has already moved "Today task"'s
		 * due date once. Returns the target cell's date.
		 */
		async function dragTodayTaskDueToEmptyCellSameRow(currentDue: string): Promise<string> {
			const dragPlan = await browser.execute(
				(calendarCls, eventCls, dueCls, excludeDate) => {
					const events = Array.from(document.querySelectorAll(`.${calendarCls} .${eventCls}`));
					const sourceEl = events.find(
						(el) => el.querySelector(".ec-event-title")?.textContent === "Today task" && el.classList.contains(dueCls),
					);
					if (sourceEl === undefined) {
						return null;
					}
					const sourceRect = sourceEl.getBoundingClientRect();
					const eventRects = events.map((el) => el.getBoundingClientRect());
					const cells = Array.from(document.querySelectorAll(`.${calendarCls} .ec-day-grid .ec-day`));
					const targetEl = cells.find((cell) => {
						const dateAttr = cell.querySelector("time[datetime]")?.getAttribute("datetime");
						if (dateAttr === null || dateAttr === undefined || dateAttr === excludeDate) {
							return false;
						}
						const rect = cell.getBoundingClientRect();
						if (Math.abs(rect.top - sourceRect.top) > rect.height / 2) {
							return false;
						}
						return !eventRects.some(
							(er) => !(er.right <= rect.left || er.left >= rect.right || er.bottom <= rect.top || er.top >= rect.bottom),
						);
					});
					if (targetEl === undefined) {
						return null;
					}
					const targetDate = targetEl.querySelector("time[datetime]")?.getAttribute("datetime");
					if (targetDate === null || targetDate === undefined) {
						return null;
					}
					const targetRect = targetEl.getBoundingClientRect();
					return {
						date: targetDate,
						source: { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 },
						target: { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 },
					};
				},
				cssClass("calendar"),
				cssClass("event"),
				cssClass("event--due"),
				currentDue,
			);
			if (dragPlan === null) {
				throw new Error('could not resolve "Today task"\'s due event and an empty same-row day cell for the drag');
			}
			const { date, source, target } = dragPlan;

			await browser
				.action("pointer", { parameters: { pointerType: "mouse" } })
				.move({ x: Math.round(source.x), y: Math.round(source.y), origin: "viewport" })
				.down({ button: 0 })
				.pause(50)
				.move({ x: Math.round(source.x) + 10, y: Math.round(source.y) + 10, origin: "viewport", duration: 100 })
				.move({ x: Math.round(target.x), y: Math.round(target.y), origin: "viewport", duration: 250 })
				.pause(50)
				.up({ button: 0 })
				.perform();

			return date;
		}

		/**
		 * M4 follow-up: undo/redo (docs/ROADMAP.md, `app/undo-reschedule.ts`,
		 * `src/commands/register-commands.ts`'s "Undo/redo last calendar
		 * reschedule" commands). Drives them through the command palette
		 * (`executeObsidianCommand`, same technique as every other command
		 * test in this file's "Actions" suite) rather than a keybinding —
		 * see the Cmd+Z test below for the keyboard path, which the same
		 * `deps.history` instance backs regardless of which one is used.
		 */
		it('undoes and redoes a drag through the "Undo/redo last calendar reschedule" commands', async function () {
			await setCalendarInitialView("month");
			await browser.$(`.${cssClass("calendar")} .ec-day-grid`).waitForExist({ timeout: SELECT_TIMEOUT });
			await browser.waitUntil(
				async () => (await readCalendarEvents()).some((e) => e.title === "Today task" && e.className.includes(cssClass("event--due"))),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Today task's due event never appeared for the undo/redo command test" },
			);

			const originalDue = await frontmatterValueOnDisk("Tasks/Today task.md", "due");
			if (originalDue === undefined) {
				throw new Error('Today task has no on-disk "due" to compare against');
			}

			const targetDate = await dragTodayTaskDueToEmptyCellSameRow(originalDue);
			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Today task.md", "due")) === targetDate,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: `Today task's on-disk "due" never became ${targetDate} after the drag` },
			);

			await browser.executeObsidianCommand("obtask:undo-reschedule");
			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Today task.md", "due")) === originalDue,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: '"Undo last calendar reschedule" never restored the original due date' },
			);
			expect(await frontmatterValueOnDisk("Tasks/Today task.md", "due")).toEqual(originalDue);

			await browser.executeObsidianCommand("obtask:redo-reschedule");
			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Today task.md", "due")) === targetDate,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: '"Redo last calendar reschedule" never re-applied the dragged due date' },
			);
			expect(await frontmatterValueOnDisk("Tasks/Today task.md", "due")).toEqual(targetDate);
		});

		/**
		 * Same history, driven by the keybinding instead of the command
		 * palette (`calendar-view.ts`'s `Scope.register(["Mod"], "z", ...)`).
		 * The calendar's container is `tabIndex = -1` and the scope is only
		 * pushed onto `app.keymap` on `focusin` (see the constructor's doc
		 * comment) — a click somewhere *inside* the container is required
		 * before the key chord is claimed. The click lands on a week-day
		 * column header cell (`.ec-col-head`), which carries no click handler
		 * of its own (unlike an event or an empty day-grid cell, which would
		 * navigate away or open the create-task modal) but is still a
		 * descendant of the container, so the click bubbles focus up to it.
		 */
		it("undoes a drag with Cmd+Z after clicking inside the calendar container", async function () {
			await setCalendarInitialView("month");
			await browser.$(`.${cssClass("calendar")} .ec-day-grid`).waitForExist({ timeout: SELECT_TIMEOUT });
			await browser.waitUntil(
				async () => (await readCalendarEvents()).some((e) => e.title === "Today task" && e.className.includes(cssClass("event--due"))),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Today task's due event never appeared for the Cmd+Z test" },
			);

			const originalDue = await frontmatterValueOnDisk("Tasks/Today task.md", "due");
			if (originalDue === undefined) {
				throw new Error('Today task has no on-disk "due" to compare against');
			}

			const targetDate = await dragTodayTaskDueToEmptyCellSameRow(originalDue);
			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Today task.md", "due")) === targetDate,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: `Today task's on-disk "due" never became ${targetDate} after the drag` },
			);

			await browser.$(`.${cssClass("calendar")} .ec-header .ec-col-head`).click();

			// "Mod" resolves to Cmd on macOS, Ctrl elsewhere — mirrors what
			// `Scope.register(["Mod"], "z", ...)` itself claims.
			const modifier = process.platform === "darwin" ? "Meta" : "Control";
			await browser.keys([modifier, "z"]);
			await browser.keys([modifier]);

			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Today task.md", "due")) === originalDue,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Cmd+Z (after a click inside the calendar) never restored the original due date" },
			);
			expect(await frontmatterValueOnDisk("Tasks/Today task.md", "due")).toEqual(originalDue);
		});

		/**
		 * Explicit M4 ROADMAP item with no prior coverage: resizing a timed
		 * `scheduled` block's bottom edge (`Event Calendar`'s `.ec-resizer`
		 * handle, only rendered on a `durationEditable` — i.e. genuinely
		 * timed — block, see `event-calendar-mapping.ts`) writes a new
		 * `duration`, leaving `scheduled` (the anchor) untouched. "Planning
		 * session" (`scheduled` today 13:00, `duration` 120 — `e2e/fixtures.ts`)
		 * is the target: tall enough (64px) that its resize handle is easy to
		 * grab distinctly from the block above it. `scrollIntoView` is needed
		 * first — `height: "auto"` renders the full 00:00-24:00 grid
		 * (`event-calendar-renderer.ts`), which is taller than the Obsidian
		 * window, so afternoon blocks like this one start out below the fold.
		 */
		it("resizes a scheduled block's bottom edge, changing its duration (week view)", async function () {
			await setCalendarInitialView("week");
			await browser.$(`.${cssClass("calendar")} .ec-week-view`).waitForExist({ timeout: SELECT_TIMEOUT });

			const originalDuration = await frontmatterValueOnDisk("Tasks/Planning session.md", "duration");
			expect(originalDuration).toEqual("120");

			const plan = await browser.execute((calendarCls) => {
				const events = Array.from(document.querySelectorAll(`.${calendarCls} .ec-time-grid .ec-body .ec-event`));
				const source = events.find((el) => el.querySelector(".ec-event-title")?.textContent === "Planning session");
				const resizer = source === undefined ? undefined : source.querySelector(".ec-resizer");
				if (source === undefined || resizer === null || resizer === undefined) {
					return null;
				}
				resizer.scrollIntoView({ block: "center" });
				const resizerRect = resizer.getBoundingClientRect();
				const slots = Array.from(document.querySelectorAll(`.${calendarCls} .ec-time-grid .ec-slot`));
				const targetSlot = slots.find((el) => el.querySelector("time[datetime]")?.getAttribute("datetime")?.includes("T16:00:00"));
				if (targetSlot === undefined) {
					return null;
				}
				const slotRect = targetSlot.getBoundingClientRect();
				return {
					resizer: { x: resizerRect.left + resizerRect.width / 2, y: resizerRect.top + resizerRect.height / 2 },
					targetY: slotRect.top + slotRect.height / 2,
				};
			}, cssClass("calendar"));
			if (plan === null) {
				throw new Error("could not resolve Planning session's resize handle or the 16:00 target slot");
			}

			await browser
				.action("pointer", { parameters: { pointerType: "mouse" } })
				.move({ x: Math.round(plan.resizer.x), y: Math.round(plan.resizer.y), origin: "viewport" })
				.down({ button: 0 })
				.pause(50)
				.move({ x: Math.round(plan.resizer.x), y: Math.round(plan.resizer.y) + 10, origin: "viewport", duration: 100 })
				.move({ x: Math.round(plan.resizer.x), y: Math.round(plan.targetY), origin: "viewport", duration: 250 })
				.pause(50)
				.up({ button: 0 })
				.perform();

			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Planning session.md", "duration")) !== originalDuration,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Planning session's on-disk duration never changed after the resize" },
			);

			const newDuration = await frontmatterValueOnDisk("Tasks/Planning session.md", "duration");
			expect(newDuration).toBeDefined();
			expect(Number(newDuration)).toBeGreaterThan(120);
			// A resize is a duration change only — the anchor itself never moves.
			expect(await frontmatterValueOnDisk("Tasks/Planning session.md", "scheduled")).toEqual(`${fixtures.today}T13:00`);
		});

		/**
		 * Complements the resize test above with the other timed-block
		 * gesture — a move, not a resize — asserted against the rule from
		 * `docs/DOMAIN-MODEL.md`'s "Reschedule semantics": "`duration` is
		 * written only by a resize." "Team sync" (`scheduled` today 09:00,
		 * `duration` 60) is dragged sideways to a different day at the same
		 * time-of-day (same `y`, only `x` changes) — `fromEventCalendarDrop`'s
		 * `!drop.allDay` branch reports no `end` for a plain move (`end`
		 * equals `start` for a point-in-time drop), so `reschedule-task.ts`
		 * never includes `duration` in the write.
		 */
		it("drags a timed scheduled block to a different day, leaving its duration untouched (week view)", async function () {
			await setCalendarInitialView("week");
			await browser.$(`.${cssClass("calendar")} .ec-week-view`).waitForExist({ timeout: SELECT_TIMEOUT });

			const originalScheduled = await frontmatterValueOnDisk("Tasks/Team sync.md", "scheduled");
			const originalDuration = await frontmatterValueOnDisk("Tasks/Team sync.md", "duration");
			expect(originalScheduled).toEqual(`${fixtures.today}T09:00`);
			expect(originalDuration).toEqual("60");

			const plan = await browser.execute((calendarCls) => {
				const events = Array.from(document.querySelectorAll(`.${calendarCls} .ec-time-grid .ec-body .ec-event`));
				const source = events.find((el) => el.querySelector(".ec-event-title")?.textContent === "Team sync");
				if (source === undefined) {
					return null;
				}
				source.scrollIntoView({ block: "center" });
				const sourceRect = source.getBoundingClientRect();
				const sourceY = sourceRect.top + sourceRect.height / 2;
				const headers = Array.from(document.querySelectorAll(`.${calendarCls} .ec-header .ec-col-head`));
				const targetHeader = headers.find((h) => {
					const r = h.getBoundingClientRect();
					return !(sourceRect.left >= r.left - 1 && sourceRect.left < r.right + 1);
				});
				if (targetHeader === undefined) {
					return null;
				}
				const targetDate = targetHeader.querySelector("time[datetime]")?.getAttribute("datetime");
				if (targetDate === null || targetDate === undefined) {
					return null;
				}
				const targetRect = targetHeader.getBoundingClientRect();
				return {
					source: { x: sourceRect.left + sourceRect.width / 2, y: sourceY },
					target: { x: targetRect.left + targetRect.width / 2, y: sourceY },
					targetDate,
				};
			}, cssClass("calendar"));
			if (plan === null) {
				throw new Error("could not resolve Team sync or a different day column to drag it to");
			}

			await browser
				.action("pointer", { parameters: { pointerType: "mouse" } })
				.move({ x: Math.round(plan.source.x), y: Math.round(plan.source.y), origin: "viewport" })
				.down({ button: 0 })
				.pause(50)
				.move({ x: Math.round(plan.source.x) + 10, y: Math.round(plan.source.y), origin: "viewport", duration: 100 })
				.move({ x: Math.round(plan.target.x), y: Math.round(plan.target.y), origin: "viewport", duration: 250 })
				.pause(50)
				.up({ button: 0 })
				.perform();

			const expectedScheduled = `${plan.targetDate}T09:00`;
			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Team sync.md", "scheduled")) === expectedScheduled,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: `Team sync's on-disk "scheduled" never became ${expectedScheduled} after the drag` },
			);

			expect(await frontmatterValueOnDisk("Tasks/Team sync.md", "scheduled")).toEqual(expectedScheduled);
			expect(await frontmatterValueOnDisk("Tasks/Team sync.md", "duration")).toEqual(originalDuration);
		});

		/**
		 * Week/day view coverage for the all-day-row drag path (the only
		 * existing drag test — "dragging an event to a different day
		 * reschedules the task" above — runs in month view). "Early ping"
		 * (a timed `due`, no `scheduled`, rendered as an all-day chip per
		 * ADR 0011) is dragged sideways within the week view's all-day row to
		 * a different day — per "Reschedule semantics" in
		 * `docs/DOMAIN-MODEL.md`, moving an all-day chip to another day
		 * changes only the day, so its `09:15` time-of-day must survive.
		 * Asserts both the on-disk `due` and the re-rendered chip's own time
		 * label (`readAllDayChips`), since the rendered label is what a user
		 * actually sees as proof the time carried over.
		 */
		it("drags an all-day due chip to a different day in week view, preserving its time-of-day", async function () {
			await setCalendarInitialView("week");
			await browser.$(`.${cssClass("calendar")} .ec-week-view`).waitForExist({ timeout: SELECT_TIMEOUT });
			await browser.waitUntil(async () => (await readCalendarEvents()).some((e) => e.title === "Early ping"), {
				timeout: SELECT_TIMEOUT,
				timeoutMsg: "Early ping never appeared in week view",
			});

			const originalDue = await frontmatterValueOnDisk("Tasks/Early ping.md", "due");
			expect(originalDue).toEqual(`${fixtures.today}T09:15`);

			const plan = await browser.execute((calendarCls) => {
				const chips = Array.from(document.querySelectorAll(`.${calendarCls} .ec-all-day .ec-event`));
				const source = chips.find((el) => el.querySelector(".ec-event-title")?.textContent === "Early ping");
				if (source === undefined) {
					return null;
				}
				// Earlier tests in this suite scroll the calendar's own scroll
				// container to reach afternoon time-grid blocks — bring the
				// all-day row (and its header, above it) back into view first.
				source.scrollIntoView({ block: "center" });
				const sourceRect = source.getBoundingClientRect();
				// The all-day row's own `.ec-day` cells carry no `time[datetime]`
				// (that's only rendered by the column *header* row's `DayHeader`,
				// see `docs/CONVENTIONS.md`'s DOM-probing note) — read the target
				// date off a header cell instead, and reuse the source chip's own
				// `y` (same all-day row) for the drop coordinate.
				const headers = Array.from(document.querySelectorAll(`.${calendarCls} .ec-header .ec-col-head`));
				const targetHeader = headers.find((h) => {
					const r = h.getBoundingClientRect();
					return !(sourceRect.left >= r.left - 1 && sourceRect.left < r.right + 1);
				});
				if (targetHeader === undefined) {
					return null;
				}
				const targetDate = targetHeader.querySelector("time[datetime]")?.getAttribute("datetime");
				if (targetDate === null || targetDate === undefined) {
					return null;
				}
				const targetRect = targetHeader.getBoundingClientRect();
				return {
					source: { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 },
					target: { x: targetRect.left + targetRect.width / 2, y: sourceRect.top + sourceRect.height / 2 },
					targetDate,
				};
			}, cssClass("calendar"));
			if (plan === null) {
				throw new Error("could not resolve Early ping's chip or a different day column to drag it to");
			}

			await browser
				.action("pointer", { parameters: { pointerType: "mouse" } })
				.move({ x: Math.round(plan.source.x), y: Math.round(plan.source.y), origin: "viewport" })
				.down({ button: 0 })
				.pause(50)
				.move({ x: Math.round(plan.source.x) + 10, y: Math.round(plan.source.y), origin: "viewport", duration: 100 })
				.move({ x: Math.round(plan.target.x), y: Math.round(plan.target.y), origin: "viewport", duration: 250 })
				.pause(50)
				.up({ button: 0 })
				.perform();

			const expectedDue = `${plan.targetDate}T09:15`;
			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Early ping.md", "due")) === expectedDue,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: `Early ping's on-disk "due" never became ${expectedDue} after the drag` },
			);
			expect(await frontmatterValueOnDisk("Tasks/Early ping.md", "due")).toEqual(expectedDue);

			const chips = await readAllDayChips();
			const moved = chips.find((c) => c.title === "Early ping");
			expect(moved).toBeDefined();
			expect(moved?.time).toBe("09:15");
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

/**
 * M1 command flows (`docs/ROADMAP.md`). A second top-level `describe` in
 * this same spec *file* — not a separate `e2e/specs/actions.e2e.ts` — so the
 * suite still costs exactly one Obsidian launch: wdio-obsidian-service
 * launches a fresh instance per spec *file* regardless of whether two files
 * target the same vault (see the "Views" doc comment above and
 * `docs/CONVENTIONS.md`'s e2e section), so a second file would double the
 * suite's wall time for no isolation benefit.
 *
 * Tests below intentionally chain: several reuse and build on the mutated
 * state left by an earlier test in this same file (e.g. "Cycle status" and
 * "Set status via suggest modal" both act on `Tasks/Today task.md`, in that
 * order) rather than each resetting the fixture — this mirrors a real
 * editing session and halves the number of `openFile` round-trips. Each
 * `before` still explicitly (re)opens the file it needs rather than
 * assuming it's already active, so reordering `it`s within a block (mocha
 * doesn't guarantee `it` order under some reporters/retries) can't silently
 * operate on the wrong file.
 */
describe("Actions", function () {
	afterEach(async function () {
		if (this.currentTest?.state === "failed") {
			const slug = this.currentTest.fullTitle().replace(/[^a-z0-9]+/gi, "-").toLowerCase();
			await saveScreenshot(`failure-${slug}`);
		}
	});

	describe("Complete recurring task", function () {
		const originalPath = `Tasks/${fixtures.recurring.filename}`;
		// `nextOccurrence` (domain/recurrence.ts) evaluates FREQ=WEEKLY with no
		// BYDAY against the anchor's own weekday, i.e. anchor + 7 days — mirrors
		// the calculation without duplicating the rrule library.
		const spawnDue = format(addDays(parseISO(fixtures.recurring.due), 7), "yyyy-MM-dd");
		const spawnPath = `Tasks/${fixtures.recurring.title} ${spawnDue}.md`;

		before(async function () {
			await openFile(originalPath);
		});

		it("marks the original done and spawns the next occurrence", async function () {
			await browser.executeObsidianCommand("obtask:complete-task");

			await waitForFrontmatter(originalPath, "status", (v) => v === "done", "original task never reached status=done");
			const originalFm = await frontmatterOf(originalPath);
			expect(originalFm?.["status"]).toEqual("done");
			expect(typeof originalFm?.["completed"]).toEqual("string");

			// Wait for the metadata cache to have parsed the spawned note's
			// frontmatter, not just for the file to exist (see the "Create task
			// modal" test below for why file-existence alone can race the cache).
			await waitForFrontmatter(spawnPath, "status", (v) => v === "todo", `${spawnPath} was never spawned`);
			const spawnFm = await frontmatterOf(spawnPath);
			expect(spawnFm?.["status"]).toEqual("todo");
			expect(spawnFm?.["due"]).toEqual(spawnDue);
			expect(spawnFm?.["repeat"]).toEqual("FREQ=WEEKLY");
			expect(spawnFm?.["completed"]).toBeUndefined();
			expect(typeof spawnFm?.["created"]).toEqual("string");

			const spawnBody = await readFileContent(spawnPath);
			expect(spawnBody?.includes(fixtures.recurring.body)).toBe(true);
		});

		it("does not spawn a duplicate when completed again", async function () {
			// The original is already status=done; re-running complete-task is a
			// same-status no-op in applyStatusChange (domain/transitions.ts), so
			// no second spawn should appear.
			await browser.executeObsidianCommand("obtask:complete-task");

			// There's no state transition to poll for here (it's a no-op), so
			// give the fire-and-forget command a moment to have run by polling
			// a condition that's already true — the original file count.
			await browser.waitUntil(
				async () => {
					const count = await browser.executeObsidian(({ app }) =>
						app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Tasks/Recurring task")).length,
					);
					return count === 2;
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "expected exactly one original + one spawned recurring note" },
			);

			const count = await browser.executeObsidian(({ app }) =>
				app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Tasks/Recurring task")).length,
			);
			expect(count).toEqual(2);
		});
	});

	describe("Cycle status", function () {
		const path = "Tasks/Today task.md";

		before(async function () {
			await openFile(path);
		});

		/**
		 * `nextStatusInCycle` (domain/status.ts) walks statuses in *configured*
		 * (array) order — confirmed both by the source doc comment and its
		 * table-driven unit test (`domain/status.test.ts`). With the default
		 * statuses, the cycle is todo -> in-progress -> done -> cancelled -> todo.
		 */
		it("cycles through every status in configured order, setting/clearing completed at terminal transitions", async function () {
			await browser.executeObsidianCommand("obtask:cycle-status");
			await waitForFrontmatter(path, "status", (v) => v === "in-progress", "expected status=in-progress after 1st cycle");
			let fm = await frontmatterOf(path);
			expect(fm?.["status"]).toEqual("in-progress");
			expect(fm?.["completed"]).toBeUndefined();

			await browser.executeObsidianCommand("obtask:cycle-status");
			await waitForFrontmatter(path, "status", (v) => v === "done", "expected status=done after 2nd cycle");
			fm = await frontmatterOf(path);
			expect(fm?.["status"]).toEqual("done");
			expect(typeof fm?.["completed"]).toEqual("string");

			await browser.executeObsidianCommand("obtask:cycle-status");
			await waitForFrontmatter(path, "status", (v) => v === "cancelled", "expected status=cancelled after 3rd cycle");
			fm = await frontmatterOf(path);
			expect(fm?.["status"]).toEqual("cancelled");
			expect(typeof fm?.["completed"]).toEqual("string");

			await browser.executeObsidianCommand("obtask:cycle-status");
			await waitForFrontmatter(path, "status", (v) => v === "todo", "expected status=todo after 4th cycle");
			fm = await frontmatterOf(path);
			expect(fm?.["status"]).toEqual("todo");
			expect(fm?.["completed"]).toBeUndefined();
		});
	});

	describe("Convert note to task", function () {
		const path = "Plain.md";

		before(async function () {
			await browser.executeObsidian(async ({ app }, p: string) => {
				await app.vault.create(p, "Just a plain note, no frontmatter.\n");
			}, path);
			await openFile(path);
		});

		it("adds the task marker, an open status and a created date", async function () {
			await browser.executeObsidianCommand("obtask:convert-note-to-task");

			await waitForFrontmatter(path, "type", (v) => v === "task", "note was never converted (type: task missing)");
			const fm = await frontmatterOf(path);
			expect(fm?.["type"]).toEqual("task");
			expect(fm?.["status"]).toEqual("todo");
			expect(typeof fm?.["created"]).toEqual("string");
		});
	});

	describe("Create task modal", function () {
		const modalCls = cssClass("create-task-modal");
		const dueDate = format(addDays(parseISO(fixtures.today), 1), "yyyy-MM-dd");
		const createdPath = "Tasks/E2E created.md";

		it("creates a task from the modal and opens it", async function () {
			await browser.executeObsidianCommand("obtask:create-task");
			await browser.$(`.${modalCls}`).waitForExist({ timeout: SELECT_TIMEOUT });

			const titleInput = await inputAt(modalCls, "text", 0);
			await titleInput.setValue("E2E created");

			// `input[type="date"]`'s wdio setValue (character-by-character key
			// simulation) is unreliable against Chromium's native date picker in
			// this Electron build, so the value is set and the change dispatched
			// directly via a DOM script instead (per docs/CONVENTIONS.md's e2e
			// section: pass serializable args in, query the DOM inside the
			// callback, since execute() runs in the Obsidian window, not Node).
			await browser.execute(
				(cls, value) => {
					const input = document.querySelector(`.${cls} input[type="date"]`);
					if (input instanceof HTMLInputElement) {
						input.value = value;
						input.dispatchEvent(new Event("input", { bubbles: true }));
						input.dispatchEvent(new Event("change", { bubbles: true }));
					}
				},
				modalCls,
				dueDate,
			);

			await browser.$(`.${modalCls} button.mod-cta`).click();

			// Wait for the metadata cache to have parsed the new file's
			// frontmatter, not just for the file to exist: `store.create` writes
			// the note in two steps (create, then `processFrontMatter`), and the
			// cache updates asynchronously after each vault write.
			await waitForFrontmatter(createdPath, "type", (v) => v === "task", `${createdPath} frontmatter never became a task`);

			const fm = await frontmatterOf(createdPath);
			expect(fm?.["type"]).toEqual("task");
			expect(fm?.["status"]).toEqual("todo");
			expect(fm?.["due"]).toEqual(dueDate);
			expect(typeof fm?.["created"]).toEqual("string");

			await browser.waitUntil(async () => (await activeFilePath()) === createdPath, {
				timeout: SELECT_TIMEOUT,
				timeoutMsg: `${createdPath} never became the active file`,
			});
		});

		it("suggests an existing note in the Project field and fills in its basename on selection", async function () {
			await browser.executeObsidianCommand("obtask:create-task");
			await browser.$(`.${modalCls}`).waitForExist({ timeout: SELECT_TIMEOUT });

			// Project lives behind "More options" — there's exactly one toggle
			// in this modal, so its `.checkbox-container` is unambiguous.
			await browser.$(`.${modalCls} .checkbox-container`).click();

			const projectInput = browser.$(`.${modalCls} input[placeholder="Project name or [[link]]"]`);
			await projectInput.waitForExist({ timeout: SELECT_TIMEOUT });

			// First letters of the "Overdue task" fixture note's title (see
			// e2e/fixtures.ts) — enough to narrow the suggester to one match.
			await projectInput.setValue("Overdue");

			const suggestion = await waitForSuggestionItem("Overdue task");
			expect(await suggestion.isDisplayed()).toBe(true);

			if (process.env["E2E_SCREENSHOT"] === "1") {
				await saveScreenshot("create-task-modal-note-suggest");
			}

			await suggestion.click();

			await browser.waitUntil(async () => (await projectInput.getValue()) === "Overdue task", {
				timeout: SELECT_TIMEOUT,
				timeoutMsg: 'Project input never became "Overdue task" after selecting the suggestion',
			});

			await browser.$(`.${modalCls} button:not(.mod-cta)`).click();
		});
	});

	describe("Set status via suggest modal", function () {
		const path = "Tasks/Today task.md";

		before(async function () {
			// Continues from "Cycle status" above, which leaves this note at
			// status=todo.
			await openFile(path);
		});

		it('sets status to "cancelled" via fuzzy search', async function () {
			await browser.executeObsidianCommand("obtask:set-status");
			const input = browser.$(".prompt-input");
			await input.waitForExist({ timeout: SELECT_TIMEOUT });
			await input.setValue("canc");
			await browser.$(".suggestion-item").waitForExist({ timeout: SELECT_TIMEOUT });
			await browser.keys("Enter");

			await waitForFrontmatter(path, "status", (v) => v === "cancelled", 'expected status="cancelled" via suggest modal');
			const fm = await frontmatterOf(path);
			expect(fm?.["status"]).toEqual("cancelled");
		});
	});

	describe("Settings round-trip", function () {
		const path = "Tasks/Today task.md";

		before(async function () {
			// Continues from "Set status via suggest modal" above, which leaves
			// this note at status=cancelled.
			await openFile(path);
		});

		it("picks up a status added to settings after a plugin reload", async function () {
			const newSettings: ObtaskSettings = {
				...DEFAULT_SETTINGS,
				statuses: [...DEFAULT_STATUSES, { id: "waiting" as StatusId, label: "Waiting", kind: "open" }],
			};

			// ObtaskPlugin exposes no public settings setter (`saveSettings` is
			// private), so settings are round-tripped the same way a user's
			// hand-edited data.json would be: persist via the inherited public
			// `Plugin.saveData`, then force a reload so `onload` -> `loadSettings`
			// re-parses it (`app.plugins.disable/enablePlugin` aren't in
			// obsidian.d.ts's public types, hence the cast — same allowance
			// AGENTS.md gives `app.plugins.getPlugin` in e2e).
			await browser.executeObsidian(
				async ({ app, plugins }, settings: ObtaskSettings) => {
					const plugin = plugins["obtask"];
					if (plugin === undefined) {
						throw new Error("obtask plugin is not installed");
					}
					await plugin.saveData(settings);
					const internalPlugins = (app as unknown as {
						plugins: {
							disablePlugin: (id: string) => Promise<void>;
							enablePlugin: (id: string) => Promise<void>;
						};
					}).plugins;
					await internalPlugins.disablePlugin("obtask");
					await internalPlugins.enablePlugin("obtask");
				},
				newSettings,
			);

			// The reload tears down and re-registers commands/views; re-open the
			// note so it's the active file again before dispatching a command.
			await openFile(path);

			await browser.executeObsidianCommand("obtask:set-status");
			const input = browser.$(".prompt-input");
			await input.waitForExist({ timeout: SELECT_TIMEOUT });
			await input.setValue("wait");
			await browser.$(".suggestion-item").waitForExist({ timeout: SELECT_TIMEOUT });
			await browser.keys("Enter");

			await waitForFrontmatter(path, "status", (v) => v === "waiting", 'expected status="waiting" after reload');
			const fm = await frontmatterOf(path);
			expect(fm?.["status"]).toEqual("waiting");
		});
	});

	describe("Create tasks base", function () {
		const path = "Tasks.base";

		it("does not overwrite an existing tasks base", async function () {
			const contentBefore = await readFileContent(path);

			await browser.executeObsidianCommand("obtask:create-tasks-base");

			// Poll rather than a single waitForExist: a `.notice` from an
			// earlier action in this suite could still be in the DOM, so check
			// that *some* current notice carries this command's message rather
			// than assuming the first `.notice` element is the new one.
			await browser.waitUntil(
				async () => {
					const notices = await browser.$$(".notice").getElements();
					const texts = await notices.map((notice) => notice.getText());
					return texts.some((text) => text.includes("already exists"));
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: 'expected a notice containing "already exists"' },
			);

			const contentAfter = await readFileContent(path);
			expect(contentAfter).toEqual(contentBefore);
		});
	});
});
