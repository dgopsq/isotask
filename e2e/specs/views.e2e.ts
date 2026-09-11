import { browser, expect } from "@wdio/globals";
import { addDays, format, parseISO } from "date-fns";
import { after, afterEach, before, describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";

import { BUCKET_LABELS, buildFixtures, noteContent } from "../fixtures.ts";
import { dirname, fileURLToPath, join, mkdir, readFile } from "../node-io.ts";
import { BUCKET_ORDER } from "@/domain/buckets";
import type { Bucket } from "@/domain/buckets";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import type { IsotaskSettings } from "@/domain/settings";
import { PALETTE, paletteColorClass } from "@/domain/project-color";
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

/**
 * Reads/sets the real Obsidian window size through Electron's own
 * `BrowserWindow`, reached via the renderer's `window.require("electron")`.
 *
 * WebDriver's `browser.setWindowSize()` does NOT work against this Electron
 * session — it fails with "unknown command: 'Browser.getWindowForTarget'",
 * and wdio 9's `browser.emulate()` is Bidi-only, which this session is not.
 * Electron's own API is unaffected by either limitation, so this is how a
 * spec gets an actual phone-sized viewport rather than only the `is-mobile`
 * class that `app.emulateMobile()` flips.
 */
async function windowSize(): Promise<readonly [number, number]> {
	const size = await browser.execute(() => {
		const req = (window as unknown as { require?: (m: string) => unknown }).require;
		if (typeof req !== "function") {
			throw new Error("window.require is unavailable — not an Electron renderer");
		}
		const electron = req("electron") as { remote: { getCurrentWindow: () => { getSize: () => number[] } } };
		return electron.remote.getCurrentWindow().getSize();
	});
	const [width, height] = size;
	if (width === undefined || height === undefined) {
		throw new Error(`Electron getSize() returned an unusable value: ${JSON.stringify(size)}`);
	}
	return [width, height];
}

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

/** Clicks a feed row cell (by its `isotask-feed__*` class) in the row identified by title text (there's no per-row selector to key off otherwise). Native `.click()` inside the Obsidian window fires the same listeners a real click would. */
async function clickFeedCell(cellCls: string, title: string): Promise<void> {
	const clicked = await browser.execute(
		(rowCls, titleCls, cls, wantedTitle) => {
			for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
				const titleEl = row.querySelector(`.${titleCls}`);
				if (titleEl?.textContent === wantedTitle) {
					const cell = row.querySelector(`.${cls}`);
					if (cell instanceof HTMLElement) {
						cell.click();
						return true;
					}
				}
			}
			return false;
		},
		cssClass("feed__row"),
		cssClass("feed__title"),
		cellCls,
		title,
	);
	if (!clicked) {
		throw new Error(`"${cellCls}" cell for "${title}" not found in the feed`);
	}
}

/** Clicks a feed row's date chip by the row's title text. */
async function clickFeedDateChip(title: string): Promise<void> {
	await clickFeedCell(cssClass("feed__date"), title);
}

/**
 * Closes a Modal with Escape when its focused field is one of the
 * `AbstractInputSuggest`-backed text fields (`ProjectModal`'s Project field,
 * `TagsModal`'s Tags field) that auto-open a suggestion popover on focus even
 * with an empty query (`NoteSuggest`/`TagSuggest` match every candidate
 * against `""`) — the first `Escape` only dismisses that popover (Obsidian's
 * own suggest-vs-modal precedence), so a second is needed to actually close
 * the modal. Harmless when no popover is open: the extra key is sent only
 * after confirming the modal is still there.
 */
async function closeModalWithEscape(modalCls: string): Promise<void> {
	await browser.keys("Escape");
	if (await browser.$(`.${modalCls}`).isExisting()) {
		await browser.keys("Escape");
	}
	await browser.$(`.${modalCls}`).waitForExist({ timeout: SELECT_TIMEOUT, reverse: true });
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

/** Clicks a feed row's status control by the row's title text — same technique as `clickFeedPriorityControl`. */
async function clickFeedStatusControl(title: string): Promise<void> {
	const clicked = await browser.execute(
		(rowCls, titleCls, statusCls, wantedTitle) => {
			for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
				const titleEl = row.querySelector(`.${titleCls}`);
				if (titleEl?.textContent === wantedTitle) {
					const control = row.querySelector(`.${statusCls}`);
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
		cssClass("feed__status"),
		title,
	);
	if (!clicked) {
		throw new Error(`status control for "${title}" not found in the feed`);
	}
}

/**
 * Reads a feed row's priority mark text and classes (`.isotask-feed__priority`
 * — a clickable `feed__priority--empty` control rendering a muted icon
 * instead of a mark for a `normal` task, see `feed-view.ts#renderPriorityControl`)
 * and its project label's class list (`.isotask-feed__project`,
 * `feed-view.ts#renderProjectLink` — carries the project's resolved color
 * as a palette class or a scoped `--isotask-dot-color`, replacing the old
 * leading dot), by the row's title text — same lookup technique as
 * `clickFeedPriorityControl`.
 */
async function readFeedRowMarkers(title: string): Promise<{
	readonly priorityText: string | null;
	readonly priorityClasses: readonly string[];
	readonly priorityRole: string | null;
	readonly projectClasses: readonly string[];
} | null> {
	return browser.execute(
		(rowCls, titleCls, priorityCls, projectCls, wantedTitle) => {
			for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
				const titleEl = row.querySelector(`.${titleCls}`);
				if (titleEl?.textContent !== wantedTitle) {
					continue;
				}
				const priorityEl = row.querySelector(`.${priorityCls}`);
				const projectEl = row.querySelector(`.${projectCls}`);
				return {
					priorityText: priorityEl?.textContent ?? null,
					priorityClasses: priorityEl === null ? [] : Array.from(priorityEl.classList),
					priorityRole: priorityEl?.getAttribute("role") ?? null,
					projectClasses: projectEl === null ? [] : Array.from(projectEl.classList),
				};
			}
			return null;
		},
		cssClass("feed__row"),
		cssClass("feed__title"),
		cssClass("feed__priority"),
		cssClass("feed__project"),
		title,
	);
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
 * and `AbstractInputSuggest`, see the "Create task modal" describe's Project
 * suggester test below) for an item whose text contains `text`, returning it
 * once found and displayed.
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
 * `e2e/generate-fixtures.mts` only resets the vault ONCE, before `wdio`
 * starts — never between tests — so any test that mutates a fixture note's
 * frontmatter (a due-date/priority edit through the feed, a status change
 * that spawns a recurrence occurrence) leaves that change in place for every
 * later test in this file. Most such mutations are harmless (nothing else
 * reads that field), but a due-date change can silently move a task into a
 * different Feed bucket — including filling the one bucket a later test
 * relies on being empty. Restores `path` to exactly the content
 * `generate-fixtures.mts` would have written for it (via `noteContent`, the
 * same helper it uses), so a mutating test leaves the vault as it found it.
 */
async function restoreFixtureNote(path: string, frontmatter: Readonly<Record<string, string>>, body: string): Promise<void> {
	const content = noteContent(frontmatter, body);
	await browser.executeObsidian(
		async ({ app }, p: string, c: string) => {
			const file = app.vault.getFileByPath(p);
			if (file === null) {
				throw new Error(`cannot restore ${p}: file not found`);
			}
			await app.vault.modify(file, c);
		},
		path,
		content,
	);
}

/**
 * Deletes a note a test created or spawned (a recurrence occurrence, a
 * converted plain note, a note made via the create-task modal), if it still
 * exists — paired with `restoreFixtureNote` above for the same reason:
 * nothing else resets the vault between tests in this file.
 */
async function deleteNoteIfExists(path: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, p: string) => {
		const file = app.vault.getFileByPath(p);
		if (file !== null) {
			await app.fileManager.trashFile(file);
		}
	}, path);
}

/**
 * Re-opens Tasks.base and switches to the Feed view — used both to restore
 * the feed after a test navigates away from it (`describe("Feed view")`
 * below) and, at module scope, by the top-level `after` hook so its
 * `E2E_SCREENSHOT=1` "feed" screenshot actually shows the feed: Bases
 * reuses one `containerEl` across view switches, and the `describe("Calendar
 * view")` suite runs after `describe("Feed view")` in this same file and
 * leaves Calendar mounted, so without this the "feed" screenshot would
 * capture whatever the last-run Calendar test left on screen instead.
 * Mirrors the calendar suite's own `reopenCalendarView`
 * (`describe("Calendar view")` below): same "reopen, then loop opening the
 * views menu and picking the target view until it's actually mounted"
 * technique, which absorbs the same click-races-the-toolbar-reattaching
 * flake documented on that helper. The Tasks.base fixture names this view
 * instance "Feed" (`e2e/vault/Tasks.base`), not the plugin's registered
 * view-type name ("Isotask feed" — `views/bases/register.ts`).
 */
async function reopenFeedView(): Promise<void> {
	await browser.executeObsidian(({ app }) => app.workspace.openLinkText("Tasks.base", "", false));
	await browser.$(".workspace-leaf.mod-active .bases-toolbar-views-menu").waitForExist({ timeout: SELECT_TIMEOUT });

	const feedEl = browser.$(`.${cssClass("feed")}`);
	const feedMenuItem = browser.$(".bases-toolbar-menu-item-name=Feed");
	await browser.waitUntil(
		async () => {
			if (await feedEl.isExisting().catch(() => false)) {
				return true;
			}
			// Every click is best-effort: the element it targets can go away
			// mid-gesture (the menu can open and close again before the click
			// lands), and a throw here would abort the retry meant to recover
			// from it.
			if (await feedMenuItem.isDisplayed().catch(() => false)) {
				await feedMenuItem.click().catch(() => undefined);
			} else {
				await browser
					.$(".workspace-leaf.mod-active .bases-toolbar-views-menu .text-icon-button")
					.click()
					.catch(() => undefined);
			}
			return feedEl.isExisting().catch(() => false);
		},
		{ timeout: SELECT_TIMEOUT, timeoutMsg: "the feed view never mounted after picking it from the views menu" },
	);
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
			// This hook runs once, after every nested `describe` below —
			// including `describe("Calendar view")`, which leaves Calendar
			// mounted — so the feed has to be reopened here rather than
			// assumed still current (see `reopenFeedView`'s doc comment).
			await reopenFeedView();
			// Bases renders asynchronously as the query resolves — the feed's
			// own `containerEl` can exist (what `reopenFeedView` waits for)
			// before `onDataUpdated` has actually populated it with bucket
			// headers/rows, which would otherwise screenshot a blank pane.
			await browser.$(`.${cssClass("feed__bucket")}`).waitForExist({ timeout: SELECT_TIMEOUT });
			// The fixture set is long enough that the last bucket — "Errors",
			// per `domain/buckets.ts`'s `BUCKET_ORDER` — starts below the fold;
			// scroll its one row into view (aligned to the bottom) so the
			// screenshot shows both the "Errors" heading and its row, with the
			// tail end of "No date" right above — which is what actually
			// demonstrates the new inter-bucket spacing.
			await browser.execute((rowInvalidCls) => {
				document.querySelector(`.${rowInvalidCls}`)?.scrollIntoView({ block: "end" });
			}, cssClass("feed__row--invalid"));
			await saveScreenshot("feed");
		}
	});

	describe("Feed view", function () {
		let structure: readonly FeedStructureEntry[] = [];
		let invalidRowText: { readonly title: string; readonly errorText: string; readonly groupLabel: string | null } | undefined;

		before(async function () {
			// Bases renders asynchronously as the query resolves; wait for at least
			// one row (valid or invalid) to show up before reading the DOM.
			await browser.$(`.${cssClass("feed__row")}`).waitForExist({ timeout: SELECT_TIMEOUT });

			// `execute()` callbacks run inside the Obsidian window, not this Node
			// process, so the plugin-id-derived class names must be passed in as
			// arguments rather than closed over.
			// Headers/rows are children of the reconciled list (`.isotask-feed__list`,
			// `feed-view.ts`'s `listEl`), not the outer view container.
			structure = await browser.execute(
				(listCls, bucketCls, rowCls, rowInvalidCls, titleCls) => {
					const container = document.querySelector(`.${listCls}`);
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
				cssClass("feed__list"),
				cssClass("feed__bucket"),
				cssClass("feed__row"),
				cssClass("feed__row--invalid"),
				cssClass("feed__title"),
			);

			invalidRowText = await browser.execute(
				(bucketCls, rowInvalidCls, titleCls, errorCls) => {
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
					// Walk backwards through the row's preceding siblings to find the
					// bucket heading it's grouped under — asserts the invalid row
					// actually renders inside the "Errors" section, not just that an
					// "Errors" heading exists somewhere in the feed.
					let groupLabel: string | null = null;
					for (let sibling = row.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
						if (sibling.classList.contains(bucketCls)) {
							groupLabel = sibling.textContent;
							break;
						}
					}
					return { title, errorText, groupLabel };
				},
				cssClass("feed__bucket"),
				cssClass("feed__row--invalid"),
				cssClass("feed__title"),
				cssClass("feed__error"),
			);
		});

		it("renders exactly the non-empty bucket headers, in bucket order, with Errors last", function () {
			const byBucket = new Map<Bucket, string[]>();
			for (const task of fixtures.tasks) {
				const list = byBucket.get(task.bucket) ?? [];
				list.push(task.title);
				byBucket.set(task.bucket, list);
			}
			// The "errors" bucket has no date to compute from `bucketFor`, so it's
			// never in `byBucket` above — it's sized off the single `fixtures.invalid`
			// note instead (`domain/buckets.ts#visibleBuckets`), which is always
			// non-empty here, so it always renders, last (`BUCKET_ORDER`'s order).
			const expected: FeedStructureEntry[] = [...BUCKET_ORDER.filter((bucket) => byBucket.has(bucket)), "errors" as const].map(
				(bucket) => ({
					bucketLabel: BUCKET_LABELS[bucket],
					titles: byBucket.get(bucket) ?? [],
				}),
			);

			expect(structure.map((entry) => entry.bucketLabel)).toEqual(expected.map((entry) => entry.bucketLabel));
			expect(structure.at(-1)?.bucketLabel).toEqual("Errors");
		});

		it("places each generated task under its expected bucket", function () {
			for (const task of fixtures.tasks) {
				const entry = structure.find((s) => s.bucketLabel === BUCKET_LABELS[task.bucket]);
				expect(entry).toBeDefined();
				expect(entry?.titles).toContain(task.title);
			}
		});

		it('shows the invalid note under the "Errors" heading, with unknown-status and invalid-date errors', function () {
			expect(invalidRowText).toBeDefined();
			expect(invalidRowText?.groupLabel).toEqual("Errors");
			expect(invalidRowText?.title).toEqual(`Tasks/${fixtures.invalid.filename}`);
			expect(invalidRowText?.errorText).toEqual('Unknown status "banana" (allowed: todo, done), Invalid due "not-a-date"');
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
			expect(chipInfo?.priorityText).toEqual("!");
			expect(chipInfo?.priorityClasses).toContain(cssClass(priorityChipClass("high")));
			expect(chipInfo?.projectText).toEqual("Q3 Launch");
			expect(chipInfo?.tagTexts).toEqual(["#work", "#urgent"]);
		});

		/**
		 * Apple Reminders-style priority marks (`domain/task.ts#priorityMarks`,
		 * `feed-view.ts#renderPriorityControl`): `urgent` -> "!!", `high` ->
		 * "!" (already covered above via the "Overdue task" fixture), `normal`
		 * -> the same clickable control with a muted "no priority" icon
		 * (`priorityIcon("normal")`, `.isotask-feed__priority--empty`) instead
		 * of a `!`/`!!` text mark — no longer inert.
		 */
		it('renders "!!" for an urgent-priority row and a "no priority" icon control for a normal-priority row', async function () {
			const urgentTask = fixtures.tasks[6];
			if (urgentTask?.title !== "Team sync") {
				throw new Error("expected fixtures.tasks[6] (Team sync, priority: urgent) to exist");
			}
			const normalTask = fixtures.tasks[2];
			if (normalTask === undefined) {
				throw new Error("expected fixtures.tasks[2] (This week or next week task, priority: normal) to exist");
			}

			const urgentMarkers = await readFeedRowMarkers(urgentTask.title);
			expect(urgentMarkers?.priorityText).toEqual("!!");
			expect(urgentMarkers?.priorityRole).toEqual("button");

			const normalMarkers = await readFeedRowMarkers(normalTask.title);
			// `normal` now renders the same clickable control as every other
			// priority value, just with a muted "no priority" icon instead of
			// a `!`/`!!` text mark (`feed-view.ts#renderPriorityControl`) — so
			// it has no text content but IS a live click target.
			expect(normalMarkers?.priorityText).toEqual("");
			expect(normalMarkers?.priorityClasses).toContain(cssClass("feed__priority--empty"));
			expect(normalMarkers?.priorityRole).toEqual("button");
		});

		/**
		 * The feed's project label (`.isotask-feed__project`,
		 * `feed-view.ts#renderProjectLink`) — no more leading dot; the label
		 * itself carries the project's color, coloured by
		 * `domain/project-color.ts#resolveDotColor`:
		 *
		 * - "Overdue task" (`project: Q3 Launch`) resolves to
		 *   `e2e/vault/Q3 Launch.md`, which sets `color: red` explicitly ->
		 *   `isotask-color-red`.
		 * - "Later task" (`project: Design Revamp`) resolves to
		 *   `e2e/vault/Design Revamp.md`, which sets no `color` at all -> the
		 *   hashed palette fallback (`hashPaletteColor`) — some
		 *   `isotask-color-*` class, not a specific one (the hash is FROZEN
		 *   but asserting the exact color here would just be re-deriving the
		 *   algorithm rather than testing behaviour).
		 * - "No date task" has no `project` frontmatter at all -> the empty
		 *   placeholder span (`feed__project--empty`), which gets no
		 *   `isotask-color-*` class.
		 *
		 * Also asserts the old leading dot element is gone entirely.
		 */
		it("colors the feed's project label from the task's project, with a hash fallback and no color for a project-less row", async function () {
			const explicitColorTask = fixtures.tasks[0];
			const hashFallbackTask = fixtures.tasks[3];
			const noProjectTask = fixtures.tasks[4];
			if (explicitColorTask?.title !== "Overdue task") {
				throw new Error("expected fixtures.tasks[0] (Overdue task) to exist");
			}
			if (hashFallbackTask?.title !== "Later task") {
				throw new Error("expected fixtures.tasks[3] (Later task) to exist");
			}
			if (noProjectTask?.title !== "No date task") {
				throw new Error("expected fixtures.tasks[4] (No date task) to exist");
			}

			const explicitMarkers = await readFeedRowMarkers(explicitColorTask.title);
			expect(explicitMarkers?.projectClasses).toContain(cssClass(paletteColorClass("red")));

			const hashMarkers = await readFeedRowMarkers(hashFallbackTask.title);
			const paletteClasses = PALETTE.map((name) => cssClass(paletteColorClass(name)));
			expect(hashMarkers?.projectClasses.some((cls) => paletteClasses.includes(cls))).toBe(true);

			const noProjectMarkers = await readFeedRowMarkers(noProjectTask.title);
			expect(noProjectMarkers?.projectClasses.some((cls) => paletteClasses.includes(cls))).toBe(false);

			const dotEl = await browser.execute(() => document.querySelector(".isotask-feed__dot"));
			expect(dotEl).toBeNull();
		});

		it("date chip opens DateModal pre-filled and dispatches setDate on save", async function () {
			const task = fixtures.tasks[0];
			if (task === undefined) {
				throw new Error("expected fixtures.tasks[0] (Overdue task) to exist");
			}
			const path = `Tasks/${task.filename}`;

			try {
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
			} finally {
				// `newDue` (today + 10 days) lands in a different Feed bucket
				// than the pristine fixture's `due` — most likely "next-week",
				// which "Feed view options" below relies on being genuinely
				// empty. Restore before anything else in this file reads the
				// Feed's bucket structure.
				await restoreFixtureNote(path, task.frontmatter, task.body);
				await waitForFrontmatter(path, "due", (v) => v === task.frontmatter["due"], `${path} due date never restored to its fixture value`);
			}
		});

		it('clicking the empty project placeholder opens ProjectModal', async function () {
			const task = fixtures.tasks[4];
			if (task?.title !== "No date task") {
				throw new Error('expected fixtures.tasks[4] ("No date task") to exist');
			}

			await clickFeedCell(cssClass("feed__project--empty"), task.title);

			const modalCls = cssClass("project-modal");
			await browser.$(`.${modalCls}`).waitForExist({ timeout: SELECT_TIMEOUT });

			await closeModalWithEscape(modalCls);
		});

		it('clicking the empty tags placeholder opens TagsModal', async function () {
			const task = fixtures.tasks[4];
			if (task?.title !== "No date task") {
				throw new Error('expected fixtures.tasks[4] ("No date task") to exist');
			}

			await clickFeedCell(cssClass("feed__tags--empty"), task.title);

			const modalCls = cssClass("tags-modal");
			await browser.$(`.${modalCls}`).waitForExist({ timeout: SELECT_TIMEOUT });

			await closeModalWithEscape(modalCls);
		});

		it("priority control opens buildPriorityMenu and dispatches setPriority on pick", async function () {
			// Starts from a task whose fixture priority is already non-`normal`
			// so picking a new value is an observable change: `fixtures.tasks[5]`
			// ("Write M1 plan") is `priority: high`; picking "Urgent" changes the
			// rendered mark to "!!" (rather than re-picking the same "High").
			// A `normal`-priority row's control (Apple Reminders-style icon
			// instead of a `!`/`!!` mark, `feed-view.ts#renderPriorityControl`)
			// opens the exact same menu, so this fixture choice is just about
			// making the pick observable, not about which control is clickable.
			const task = fixtures.tasks[5];
			if (task === undefined) {
				throw new Error("expected fixtures.tasks[5] (Write M1 plan) to exist");
			}
			const path = `Tasks/${task.filename}`;

			try {
				await clickFeedPriorityControl(task.title);

				for (const label of ["Normal", "High", "Urgent"]) {
					await browser.$(`.menu-item-title=${label}`).waitForDisplayed({ timeout: SELECT_TIMEOUT });
				}

				if (process.env["E2E_SCREENSHOT"] === "1") {
					await saveScreenshot("feed-priority-menu");
				}

				await browser.$(".menu-item-title=Urgent").click();

				await waitForFrontmatter(path, "priority", (v) => v === "urgent", `${path} priority never updated via the feed's priority control`);
				const fm = await frontmatterOf(path);
				expect(fm?.["priority"]).toEqual("urgent");

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
						return rowPriorityText === "!!";
					},
					{ timeout: SELECT_TIMEOUT, timeoutMsg: `${task.title}'s priority chip never re-rendered as "!!"` },
				);
				expect(rowPriorityText).toEqual("!!");
			} finally {
				// This fixture's pristine priority is "high" (not "normal") —
				// restore it so nothing later in this file observes the
				// "urgent" this test set.
				await restoreFixtureNote(path, task.frontmatter, task.body);
				await waitForFrontmatter(path, "priority", (v) => v === "high", `${path} priority never restored to its fixture value`);
			}
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

		/**
		 * The feed's narrow-pane compaction feature: below `COMPACT_FEED_WIDTH`
		 * (`domain/feed-view-options.ts`), `.isotask-feed__row` drops its subgrid
		 * columns for a two-line layout — status + title on the first line, the
		 * metadata chips (date/priority/project/tags/generic) wrapped onto a
		 * second — instead of the wide layout's permanent horizontal scrollbar.
		 * Same window-resize technique as the calendar's own compaction test
		 * (`windowSize`/`setWindowSize`, both sidebars collapsed so a 390px
		 * Electron window is a fair narrow PANE rather than a broken desktop
		 * layout) — see that test's doc comment in `describe("Calendar view")`
		 * below for the full rationale.
		 */
		it("collapses to a two-line layout with no horizontal overflow on a narrow pane", async function () {
			const originalSize = await windowSize();
			await setWindowSize(390, 844);
			const wasLeftCollapsed = await browser.executeObsidian(({ app }) => app.workspace.leftSplit.collapsed);
			const wasRightCollapsed = await browser.executeObsidian(({ app }) => app.workspace.rightSplit.collapsed);
			await browser.executeObsidian(({ app }) => {
				app.workspace.leftSplit.collapse();
				app.workspace.rightSplit.collapse();
			});

			try {
				// Navigate fully away and back (rather than re-opening Tasks.base
				// while already on it, a no-op that wouldn't force a fresh mount)
				// so the feed mounts fresh and measures the current 390px width.
				await openFile("Tasks/Today task.md");
				await reopenFeedView();

				await browser.$(`.${cssClass("feed--compact")}`).waitForExist({ timeout: SELECT_TIMEOUT });

				const overflow = await browser.execute((cls) => {
					const el = document.querySelector(`.${cls}`);
					if (el === null) {
						return null;
					}
					return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
				}, cssClass("feed"));
				expect(overflow).not.toBeNull();
				expect(overflow?.scrollWidth ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((overflow?.clientWidth ?? 0) + 1);

				await browser.waitUntil(
					async () =>
						browser.execute(
							(rowCls, titleCls, wantedTitle) =>
								Array.from(document.querySelectorAll(`.${rowCls}`)).some(
									(row) => row.querySelector(`.${titleCls}`)?.textContent === wantedTitle,
								),
							cssClass("feed__row"),
							cssClass("feed__title"),
							"Write M1 plan",
						),
					{ timeout: SELECT_TIMEOUT, timeoutMsg: "the 'Write M1 plan' row never rendered in the compact feed" },
				);

				const rowLayout = await browser.execute(
					(rowCls, titleCls, metaCls, wantedTitle) => {
						for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
							const titleEl = row.querySelector(`.${titleCls}`);
							if (titleEl?.textContent !== wantedTitle) {
								continue;
							}
							const metaEl = row.querySelector(`.${metaCls}`);
							if (metaEl === null) {
								return null;
							}
							const titleRect = titleEl.getBoundingClientRect();
							const metaRect = metaEl.getBoundingClientRect();
							return {
								titleBottom: titleRect.bottom,
								metaTop: metaRect.top,
								metaText: metaEl.textContent,
							};
						}
						return null;
					},
					cssClass("feed__row"),
					cssClass("feed__title"),
					cssClass("feed__meta"),
					"Write M1 plan",
				);

				expect(rowLayout).not.toBeNull();
				expect(rowLayout?.metaTop ?? -Infinity).toBeGreaterThanOrEqual(rowLayout?.titleBottom ?? Infinity);
				expect(rowLayout?.metaText ?? "").toContain("Due:");

				await saveScreenshotAt(join(screenshotDir, "feed-compact-390.png"));
			} finally {
				await setWindowSize(originalSize[0], originalSize[1]);
				await browser.executeObsidian(
					({ app }, leftCollapsed: boolean, rightCollapsed: boolean) => {
						if (leftCollapsed) {
							app.workspace.leftSplit.collapse();
						} else {
							app.workspace.leftSplit.expand();
						}
						if (rightCollapsed) {
							app.workspace.rightSplit.collapse();
						} else {
							app.workspace.rightSplit.expand();
						}
					},
					wasLeftCollapsed,
					wasRightCollapsed,
				);
				await openFile("Tasks/Today task.md");
				await reopenFeedView();
			}
		});

		/**
		 * `e2e/vault/Tasks.base`'s Feed view filters `status != "done"` — a
		 * task marked done via the status control doesn't move to the bottom
		 * of its bucket, it disappears from the feed entirely (`completedAt
		 * Bottom` never gets a chance to apply since the row is filtered out
		 * upstream of the view). So (a) asserts disappearance rather than
		 * bucket position, and (b) reopens the note through the
		 * `isotask:toggle-done` command (rather than a second click on a
		 * control that no longer exists in the DOM) before asserting the row
		 * comes back.
		 *
		 * Uses "Deadline call" (`fixtures.tasks[9]`, due today at 14:30) —
		 * read only by the calendar suite's chip-ordering assertions
		 * elsewhere in this file, never mutated by any other test, and its
		 * "today" due bucket also holds "Today task", "Early ping" and "Late
		 * ping" at the point this suite runs (before the calendar suite's own
		 * drag test permanently moves "Early ping" elsewhere).
		 */
		describe("Feed done toggle", function () {
			const task = fixtures.tasks[9];
			if (task?.title !== "Deadline call") {
				throw new Error("expected fixtures.tasks[9] (Deadline call) to exist");
			}
			const path = `Tasks/${task.filename}`;

			async function feedRowExists(title: string): Promise<boolean> {
				return browser.execute(
					(rowCls, titleCls, wantedTitle) =>
						Array.from(document.querySelectorAll(`.${rowCls}`)).some((row) => row.querySelector(`.${titleCls}`)?.textContent === wantedTitle),
					cssClass("feed__row"),
					cssClass("feed__title"),
					title,
				);
			}

			async function feedRowStatusAriaLabel(title: string): Promise<string | null> {
				return browser.execute(
					(rowCls, titleCls, statusCls, wantedTitle) => {
						for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
							const titleEl = row.querySelector(`.${titleCls}`);
							if (titleEl?.textContent === wantedTitle) {
								return row.querySelector(`.${statusCls}`)?.getAttribute("aria-label") ?? null;
							}
						}
						return null;
					},
					cssClass("feed__row"),
					cssClass("feed__title"),
					cssClass("feed__status"),
					title,
				);
			}

			async function feedRowStatusAriaChecked(title: string): Promise<string | null> {
				return browser.execute(
					(rowCls, titleCls, statusCls, wantedTitle) => {
						for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
							const titleEl = row.querySelector(`.${titleCls}`);
							if (titleEl?.textContent === wantedTitle) {
								return row.querySelector(`.${statusCls}`)?.getAttribute("aria-checked") ?? null;
							}
						}
						return null;
					},
					cssClass("feed__row"),
					cssClass("feed__title"),
					cssClass("feed__status"),
					title,
				);
			}

			/** True once the row's status control has the optimistic `--checked` modifier class (set immediately on click, well before the delayed frontmatter write lands). */
			async function feedRowStatusChecked(title: string): Promise<boolean> {
				return browser.execute(
					(rowCls, titleCls, statusCls, checkedCls, wantedTitle) => {
						for (const row of Array.from(document.querySelectorAll(`.${rowCls}`))) {
							const titleEl = row.querySelector(`.${titleCls}`);
							if (titleEl?.textContent === wantedTitle) {
								return (row.querySelector(`.${statusCls}`)?.classList.contains(checkedCls) ?? false);
							}
						}
						return false;
					},
					cssClass("feed__row"),
					cssClass("feed__title"),
					cssClass("feed__status"),
					cssClass("feed__status--checked"),
					title,
				);
			}

			before(async function () {
				await reopenFeedView();
				await browser.$(`.${cssClass("feed__row")}`).waitForExist({ timeout: SELECT_TIMEOUT });
			});

			after(async function () {
				await restoreFixtureNote(path, task.frontmatter, task.body);
				await waitForFrontmatter(path, "status", (v) => v === "todo", `${path} status never restored to its fixture value`);
				await reopenFeedView();
			});

			it("marks the task done and removes its row from the feed", async function () {
				const ariaLabelBefore = await feedRowStatusAriaLabel(task.title);
				expect(ariaLabelBefore).toEqual("To do");
				expect(await feedRowStatusAriaChecked(task.title)).toEqual("false");

				await clickFeedStatusControl(task.title);

				// Optimistic UI: the control flips to checked immediately, well
				// before the actual frontmatter write, which `renderStatusControl`
				// (feed-view.ts) delays behind the ~380ms completion animation.
				// Proving this state exists (and capturing it) before waiting on
				// the frontmatter is the point of these two lines.
				await browser.waitUntil(async () => await feedRowStatusChecked(task.title), {
					timeout: SELECT_TIMEOUT,
					timeoutMsg: `${task.title}'s status control never got the optimistic --checked class after being clicked`,
				});
				await saveScreenshot("feed-check-completing");

				await waitForFrontmatter(path, "status", (v) => v === "done", `${path} status never became done via the feed's status control`);
				const fm = await frontmatterOf(path);
				expect(fm?.["status"]).toEqual("done");
				expect(typeof fm?.["completed"]).toEqual("string");

				// The base's Feed view filters `status != "done"` — a done task
				// is filtered out entirely rather than sinking to the bottom of
				// its bucket, so the row disappearing is the observable effect.
				await browser.waitUntil(async () => !(await feedRowExists(task.title)), {
					timeout: SELECT_TIMEOUT,
					timeoutMsg: `${task.title}'s row never disappeared from the feed after being marked done`,
				});
				expect(await feedRowExists(task.title)).toBe(false);
			});

			it("reopens the task via the toggle-done command and its row reappears", async function () {
				await openFile(path);
				await browser.executeObsidianCommand("isotask:toggle-done");

				await waitForFrontmatter(path, "status", (v) => v === "todo", `${path} status never became todo via isotask:toggle-done`);
				const fm = await frontmatterOf(path);
				expect(fm?.["status"]).toEqual("todo");
				expect(fm?.["completed"]).toBeUndefined();

				await reopenFeedView();
				await browser.waitUntil(async () => await feedRowExists(task.title), {
					timeout: SELECT_TIMEOUT,
					timeoutMsg: `${task.title}'s row never reappeared in the feed after being reopened`,
				});
				expect(await feedRowExists(task.title)).toBe(true);

				const ariaLabelAfter = await feedRowStatusAriaLabel(task.title);
				expect(ariaLabelAfter).toEqual("To do");
				expect(await feedRowStatusAriaChecked(task.title)).toEqual("false");
			});
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
	 * Bases' DOM, not isotask's) — flips the option programmatically instead,
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
			await browser.$(`.${cssClass("feed__row")}`).waitForExist({ timeout: SELECT_TIMEOUT });
			await saveScreenshotAt(join(screenshotDir, "feed-default-order.png"));

			const defaultOrder = await getFeedOrder();
			try {
				const genericCls = cssClass("feed__generic");
				const { usedSetOrder } = await setFeedOrder([...defaultOrder, "file.mtime"]);
				expect(usedSetOrder).toBe(true);

				await browser.$(`.${genericCls}`).waitForExist({ timeout: SELECT_TIMEOUT });
				await saveScreenshotAt(join(screenshotDir, "feed-generic-chip.png"));
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
				(rowCls, rowInvalidCls, titleCls, statusCls, wantedTitle) => {
					for (const row of Array.from(document.querySelectorAll(`.${rowCls}:not(.${rowInvalidCls})`))) {
						const titleEl = row.querySelector(`.${titleCls}`);
						if (titleEl?.textContent === wantedTitle) {
							return row.querySelector(`.${statusCls}`)?.getAttribute("aria-label") ?? null;
						}
					}
					return null;
				},
				cssClass("feed__row"),
				cssClass("feed__row--invalid"),
				cssClass("feed__title"),
				cssClass("feed__status"),
				"Toolbar new",
			);
			expect(statusLabel).toEqual("To do");
		});
	});

	/**
	 * `.ec` is Event Calendar's own root class (rendered inside our
	 * `.isotask-calendar` wrapper — see `calendar-view.ts`); `.ec-event` is
	 * its per-event element, which carries the extra classes
	 * `event-calendar-mapping.ts#toEventCalendarEvent` attaches
	 * (`isotask-event`, `isotask-event--due`/`--scheduled`,
	 * `isotask-priority-*`) alongside Event Calendar's own. Reads every
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
	 * `.isotask-event-time` label (empty string for a date-only chip, which
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
	 * Rendered geometry (not just text) of every TIMED all-day chip's
	 * time/title pair — used by the narrow-pane compaction test to prove the
	 * compact single-line contract: the time label hidden (zero rendered
	 * width) and the title genuinely visible, guarding both historical
	 * failure modes: the title squeezed out entirely (a 390px-wide column
	 * once rendered only the time, e.g. "11:45"), and the later wrap
	 * regression that put the title on a line under the leading project dot.
	 * A date-only chip (no `.isotask-event-time` node) is skipped, not
	 * asserted on — it never had either problem.
	 */
	async function readTimedAllDayChipLayouts(): Promise<
		{ readonly title: string; readonly titleWidth: number; readonly timeWidth: number }[]
	> {
		return browser.execute(
			(eventCls, timeCls) =>
				Array.from(document.querySelectorAll(`.ec-all-day .${eventCls}`))
					.map((el) => {
						const timeEl = el.querySelector(`.${timeCls}`);
						const titleEl = el.querySelector(".ec-event-title");
						if (timeEl === null || titleEl === null) {
							return null;
						}
						const timeRect = timeEl.getBoundingClientRect();
						const titleRect = titleEl.getBoundingClientRect();
						return {
							title: titleEl.textContent,
							titleWidth: titleRect.width,
							timeWidth: timeRect.width,
						};
					})
					.filter((chip): chip is NonNullable<typeof chip> => chip !== null),
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

	/**
	 * Number of day columns Event Calendar is currently rendering — the
	 * column-header cell (`.ec-col-head`) count is the same for month's
	 * day-grid and week/day's time-grid, so this works across all three
	 * views without caring which one is active. Used by the phone-viewport
	 * compaction tests below to assert a rolling 3-day window renders
	 * exactly 3 columns, never 7.
	 */
	async function readColumnHeaderCount(calendarClsArg: string): Promise<number> {
		return browser.execute((cls) => document.querySelectorAll(`.${cls} .ec-col-head`).length, calendarClsArg);
	}

	/**
	 * Geometry + visibility of every event in a compact MONTH cell — used by
	 * the narrow-pane compaction test to prove the dot-grid rewrite (`month`
	 * is back below `COMPACT_CALENDAR_WIDTH`, rendered as dots instead of the
	 * rolling 3-day fallback it used to collapse into): each dot's title text
	 * must stay in the DOM (`titleText`) but be visually clipped
	 * (`titleWidth` ~0, the same clip-to-1px treatment as the compact
	 * time-axis gutter's "all-day" label), and `visible` reads
	 * `.ec-event`'s own `visibility` (Event Calendar's own `dayMaxEvents`
	 * hide() sets `visibility: hidden` — not `display: none` — on whatever a
	 * busy day's cap hides). `date` is resolved the same geometry-overlap way
	 * the wide-pane "empty day cell" test resolves an event's day (events
	 * aren't nested inside their day cell's own DOM — a separate absolutely/
	 * grid-positioned overlay layer — so the correspondence has to be read
	 * from rendered rects, not `querySelector`).
	 */
	async function readCompactMonthDots(): Promise<
		{ readonly date: string; readonly visible: boolean; readonly titleText: string; readonly titleWidth: number }[]
	> {
		return browser.execute(
			(calendarCls, eventCls) => {
				const cells = Array.from(document.querySelectorAll(`.${calendarCls} .ec-day-grid .ec-day`)).map((cell) => ({
					date: cell.querySelector("time[datetime]")?.getAttribute("datetime") ?? "",
					rect: cell.getBoundingClientRect(),
				}));
				const events = Array.from(document.querySelectorAll(`.${calendarCls} .ec-day-grid .${eventCls}`));
				return events.map((el) => {
					const rect = el.getBoundingClientRect();
					const cell = cells.find(
						(c) => !(rect.right <= c.rect.left || rect.left >= c.rect.right || rect.bottom <= c.rect.top || rect.top >= c.rect.bottom),
					);
					const titleEl = el.querySelector(".ec-event-title");
					return {
						date: cell?.date ?? "",
						visible: getComputedStyle(el).visibility !== "hidden",
						titleText: titleEl?.textContent ?? "",
						titleWidth: titleEl?.getBoundingClientRect().width ?? 0,
					};
				});
			},
			cssClass("calendar"),
			cssClass("event"),
		);
	}

	/** Resolves the WebdriverIO element for a month-view day-grid cell by its `datetime`, for a click gesture. */
	async function monthDayCellByDate(dateIso: string): Promise<WebdriverIO.Element> {
		const index = await browser.execute(
			(calendarCls, iso) => {
				const cells = Array.from(document.querySelectorAll(`.${calendarCls} .ec-day-grid .ec-day`));
				return cells.findIndex((cell) => cell.querySelector("time[datetime]")?.getAttribute("datetime") === iso);
			},
			cssClass("calendar"),
			dateIso,
		);
		if (index < 0) {
			throw new Error(`no month-view day cell found for ${dateIso}`);
		}
		const cells = await browser.$$(`.${cssClass("calendar")} .ec-day-grid .ec-day`).getElements();
		const cell = cells[index];
		if (cell === undefined) {
			throw new Error(`could not resolve the day cell element for ${dateIso}`);
		}
		return cell;
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

		it("renders the Event Calendar root inside .isotask-calendar, in the default month view", async function () {
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
		 * Calendar event colouring follows the task's project, not its
		 * priority (2026-08-31 rework — see `domain/project-color.ts`). "Write
		 * M1 plan" is `priority: high` (still colours its `!` mark
		 * `isotask-priority-high`, `event-content.ts`) but its `project:
		 * "Q3 Launch"` resolves to `e2e/vault/Q3 Launch.md` (`color: red`), so
		 * the event's dot/pill gets `isotask-color-red` — a colour completely
		 * independent of the `high` priority, proving the dot no longer
		 * reads priority at all (the pre-rework CSS keyed a `high`-priority
		 * event's dot to `--color-orange` directly; that mapping is gone).
		 */
		it("colors the calendar event dot from the task's project, independent of its priority", async function () {
			await browser.waitUntil(
				async () => (await readCalendarEvents()).some((e) => e.title === "Write M1 plan"),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Write M1 plan event never appeared" },
			);

			const events = await readCalendarEvents();
			const event = events.find((e) => e.title === "Write M1 plan");
			expect(event).toBeDefined();
			expect(event?.className).toContain(cssClass(paletteColorClass("red")));
			expect(event?.className).toContain(cssClass(priorityChipClass("high")));
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
		 * `@container isotask-event` height-query rule (`calendar.css`) that
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
		 * time is shown as a separate `.isotask-event-time` label
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

			// Every date-only chip (no `.isotask-event-time` label, e.g. "Today
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
			// Wait on the toolbar, not `.isotask-feed`: the base reopens on
			// whichever view type it last showed (usually the calendar here),
			// and views now remove their container class on unload, so the
			// feed class is only present when the feed is actually mounted.
			await browser.$(".workspace-leaf.mod-active .bases-toolbar-views-menu").waitForExist({ timeout: SELECT_TIMEOUT });

			// Retries the whole open-menu-then-pick-Calendar cycle until the
			// calendar is ACTUALLY mounted, rather than until an intermediate
			// signal. Waiting only for the "Calendar" item to be displayed and
			// then clicking it looks equivalent but is racy: right after
			// `openLinkText` swaps the leaf's view back to a freshly mounted
			// Bases file the toolbar is still re-attaching its handlers, so the
			// menu can open and immediately close again in the window between
			// `isDisplayed()` returning true and the `click()` landing — the
			// click then hits nothing and the test fails on a calendar that was
			// never asked for. Observed as a roughly 1-in-5 flake. Looping on
			// the outcome absorbs it: a lost click just costs one more pass.
			const calendarEl = browser.$(`.${cssClass("calendar")} .ec`);
			const calendarMenuItem = browser.$(".bases-toolbar-menu-item-name=Calendar");
			await browser.waitUntil(
				async () => {
					if (await calendarEl.isExisting().catch(() => false)) {
						return true;
					}
					// Every click is best-effort: the element it targets can go
					// away mid-gesture for exactly the reason above, and a throw
					// here would abort the retry that is meant to recover from it.
					if (await calendarMenuItem.isDisplayed().catch(() => false)) {
						await calendarMenuItem.click().catch(() => undefined);
					} else {
						await browser
							.$(".workspace-leaf.mod-active .bases-toolbar-views-menu .text-icon-button")
							.click()
							.catch(() => undefined);
					}
					return calendarEl.isExisting().catch(() => false);
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "the calendar view never mounted after picking it from the views menu" },
			);
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

		/** A gesture that degraded into a cell click leaves the create-task modal over the calendar; a retry must clear it first. */
		async function dismissStrayModal(): Promise<void> {
			if (await browser.$(".modal").isExisting()) {
				await browser.keys("Escape");
				await browser.$(".modal").waitForExist({ timeout: SELECT_TIMEOUT, reverse: true }).catch(() => undefined);
			}
		}

		/**
		 * Drags "Today task"'s due-event chip (month view) to an empty cell in
		 * the same grid row — same gesture as the "dragging an event to a
		 * different day reschedules the task" test above, reused (rather than
		 * duplicated) by the undo/redo tests below, for which the drag is only
		 * a means to have something to undo/redo. `currentDue` (rather than a
		 * fixed `fixtures.today`) is excluded from the candidate target cells
		 * since an earlier test in this suite has already moved "Today task"'s
		 * due date once. Returns the target cell's date.
		 *
		 * Bounded retries with fresh, hit-tested rects: a compact-mode remount near
		 * `COMPACT_CALENDAR_WIDTH` can swap the chip out between plan and gesture (CI's pane sits on it).
		 */
		async function dragTodayTaskDueToEmptyCellSameRow(currentDue: string): Promise<string> {
			const maxAttempts = 3;
			let lastFailure = "";

			for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
				await dismissStrayModal();
				await browser.releaseActions();

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
						const source = { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 };
						// A remount can leave a stale rect; only a chip that is still on top is draggable.
						if (!document.elementsFromPoint(source.x, source.y).includes(sourceEl)) {
							return null;
						}
						return {
							date: targetDate,
							source,
							target: { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 },
						};
					},
					cssClass("calendar"),
					cssClass("event"),
					cssClass("event--due"),
					currentDue,
				);
				if (dragPlan === null) {
					lastFailure = 'could not resolve "Today task"\'s due event and a hit-testable, empty same-row day cell for the drag';
					continue;
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

				const landed = await browser
					.waitUntil(async () => (await frontmatterValueOnDisk("Tasks/Today task.md", "due")) === date, { timeout: 2_000 })
					.then(() => true)
					.catch(() => false);
				if (landed) {
					// `metadataCache` lags the on-disk write; undo's staleness check reads the cache and would refuse.
					await browser.waitUntil(async () => (await frontmatterOf("Tasks/Today task.md"))?.["due"] === date, {
						timeout: SELECT_TIMEOUT,
						timeoutMsg: `Today task's cached "due" never caught up to ${date} after the drag landed on disk`,
					});
					return date;
				}
				lastFailure = `Today task's on-disk "due" never became ${date} after the drag (attempt ${String(attempt)}/${String(maxAttempts)})`;
			}

			throw new Error(lastFailure);
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

			await browser.executeObsidianCommand("isotask:undo-reschedule");
			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Today task.md", "due")) === originalDue,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: '"Undo last calendar reschedule" never restored the original due date' },
			);
			expect(await frontmatterValueOnDisk("Tasks/Today task.md", "due")).toEqual(originalDue);

			await browser.executeObsidianCommand("isotask:redo-reschedule");
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
		it("undoes a drag with Cmd+Z straight after the drop, with no intervening click", async function () {
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

			// Deliberately NO click here. Event Calendar's drag ghost leaves
			// focus on `document.body` after a drop, which used to pop the
			// view's keymap scope and leave Cmd+Z dead exactly when an undo
			// had just become available; `onEventMoved` now takes focus back.
			// Clicking first would hide that regression.

			// "Mod" resolves to Cmd on macOS, Ctrl elsewhere — mirrors what
			// `Scope.register(["Mod"], "z", ...)` itself claims.
			const modifier = process.platform === "darwin" ? "Meta" : "Control";
			await browser.keys([modifier, "z"]);
			await browser.keys([modifier]);

			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Today task.md", "due")) === originalDue,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Cmd+Z straight after the drop never restored the original due date" },
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

			// Same bounded plan+gesture retry as `dragTodayTaskDueToEmptyCellSameRow`, for the same remount reason.
			const maxAttempts = 3;
			let landed = false;
			for (let attempt = 1; attempt <= maxAttempts && !landed; attempt += 1) {
				await dismissStrayModal();
				await browser.releaseActions();

				const plan = await browser.execute((calendarCls) => {
					const events = Array.from(document.querySelectorAll(`.${calendarCls} .ec-time-grid .ec-body .ec-event`));
					const source = events.find((el) => el.querySelector(".ec-event-title")?.textContent === "Planning session");
					const resizer = source === undefined ? undefined : source.querySelector(".ec-resizer");
					if (source === undefined || resizer === null || resizer === undefined) {
						return null;
					}
					resizer.scrollIntoView({ block: "center" });
					const resizerRect = resizer.getBoundingClientRect();
					const resizerPoint = { x: resizerRect.left + resizerRect.width / 2, y: resizerRect.top + resizerRect.height / 2 };
					if (!document.elementsFromPoint(resizerPoint.x, resizerPoint.y).includes(resizer)) {
						return null;
					}
					const slots = Array.from(document.querySelectorAll(`.${calendarCls} .ec-time-grid .ec-slot`));
					const targetSlot = slots.find((el) => el.querySelector("time[datetime]")?.getAttribute("datetime")?.includes("T16:00:00"));
					if (targetSlot === undefined) {
						return null;
					}
					const slotRect = targetSlot.getBoundingClientRect();
					return { resizer: resizerPoint, targetY: slotRect.top + slotRect.height / 2 };
				}, cssClass("calendar"));
				if (plan === null) {
					continue;
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

				landed = await browser
					.waitUntil(async () => (await frontmatterValueOnDisk("Tasks/Planning session.md", "duration")) !== originalDuration, {
						timeout: 2_000,
					})
					.then(() => true)
					.catch(() => false);
			}
			if (!landed) {
				throw new Error("Planning session's on-disk duration never changed after the resize");
			}

			const newDuration = await frontmatterValueOnDisk("Tasks/Planning session.md", "duration");
			expect(newDuration).toBeDefined();
			expect(Number(newDuration)).toBeGreaterThan(120);
			// A resize is a duration change only — the anchor itself never moves.
			expect(await frontmatterValueOnDisk("Tasks/Planning session.md", "scheduled")).toEqual(`${fixtures.today}T13:00`);
		});

		/**
		 * `isotask-calendar--resizing` (`calendar-view.ts`, `styles/calendar.css`)
		 * replaced a `:has(.ec-resizer:active)` CSS check the review bot flags —
		 * flagged on the calendar root, not the block, since Event Calendar's own
		 * Svelte binding overwrites a resized `.ec-event`'s `class` wholesale once
		 * the drag threshold is crossed (verified: a class added there is gone by
		 * the first qualifying move).
		 */
		it("marks the calendar root as resizing while a resize handle is held, and clears it on release", async function () {
			await setCalendarInitialView("week");
			await browser.$(`.${cssClass("calendar")} .ec-week-view`).waitForExist({ timeout: SELECT_TIMEOUT });

			const resizingCls = cssClass("calendar--resizing");
			const maxAttempts = 3;
			let plan: { x: number; y: number } | null = null;
			for (let attempt = 1; attempt <= maxAttempts && plan === null; attempt += 1) {
				await dismissStrayModal();
				await browser.releaseActions();

				plan = await browser.execute((calendarCls) => {
					const events = Array.from(document.querySelectorAll(`.${calendarCls} .ec-time-grid .ec-body .ec-event`));
					const source = events.find((el) => el.querySelector(".ec-event-title")?.textContent === "Planning session");
					const resizer = source === undefined ? undefined : source.querySelector(".ec-resizer");
					if (source === undefined || resizer === null || resizer === undefined) {
						return null;
					}
					resizer.scrollIntoView({ block: "center" });
					const rect = resizer.getBoundingClientRect();
					const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
					if (!document.elementsFromPoint(point.x, point.y).includes(resizer)) {
						return null;
					}
					return point;
				}, cssClass("calendar"));
			}
			if (plan === null) {
				throw new Error("Planning session's resize handle was never reliably grabbable");
			}

			// `perform(true)` keeps the pointer held so the mid-gesture DOM state below can be observed before release.
			await browser
				.action("pointer", { parameters: { pointerType: "mouse" } })
				.move({ x: Math.round(plan.x), y: Math.round(plan.y), origin: "viewport" })
				.down({ button: 0 })
				.pause(50)
				// Past the ~5px drag threshold, so Event Calendar has actually started the resize by the time this is checked.
				.move({ x: Math.round(plan.x), y: Math.round(plan.y) + 10, origin: "viewport", duration: 100 })
				.perform(true);

			expect(await browser.execute((cls) => document.querySelectorAll(`.${cls}`).length, resizingCls)).toBe(1);

			await browser.action("pointer", { parameters: { pointerType: "mouse" } }).up({ button: 0 }).perform();
			await browser.releaseActions();

			expect(await browser.execute((cls) => document.querySelectorAll(`.${cls}`).length, resizingCls)).toBe(0);
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
		/**
		 * Overlap-group geometry guard. EC lays an overlapping group out with
		 * inline `inset-inline-start`/`inline-size` percentages that assume a
		 * start-anchored box; two regressions have shipped against exactly
		 * this layout (a `justify-self: center` that pushed whole groups into
		 * the next day column, and corner marks drawn over sliver titles), so
		 * this test creates a real overlap at runtime — no permanent fixture:
		 * "Standup" is moved onto "Team sync"'s slot via `processFrontMatter`
		 * and restored afterwards — and asserts the group stays inside its
		 * day column with the same half-gap inset single blocks get.
		 */
		it("keeps an overlapping pair of timed blocks inside their day column (week view)", async function () {
			await setCalendarInitialView("week");
			await browser.$(`.${cssClass("calendar")} .ec-week-view`).waitForExist({ timeout: SELECT_TIMEOUT });
			const setStandupTime = async (time: string): Promise<void> => {
				await browser.executeObsidian(
					async ({ app }, t: string) => {
						const file = app.vault.getFileByPath("Tasks/Standup.md");
						if (file === null) {
							throw new Error("no Standup fixture");
						}
						await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
							fm["scheduled"] = (fm["scheduled"] as string).slice(0, 11) + t;
						});
					},
					time,
				);
			};
			await setStandupTime("09:30");
			try {
				await browser.waitUntil(
					async () =>
						browser.execute((eventCls) => {
							const els = Array.from(document.querySelectorAll(`.ec-time-grid .ec-body .${eventCls}`));
							return els.filter((el) => (el.getAttribute("style") ?? "").includes("inset-inline-start")).length >= 2;
						}, cssClass("event")),
					{ timeout: SELECT_TIMEOUT, timeoutMsg: "the runtime overlap never produced EC's overlap layout" },
				);
				const layout = await browser.execute((eventCls) => {
					const cols = Array.from(document.querySelectorAll(".ec-col-head")).map((el) => {
						const r = el.getBoundingClientRect();
						return { left: r.left, right: r.right };
					});
					return Array.from(document.querySelectorAll(`.ec-time-grid .ec-body .${eventCls}`)).map((el) => {
						const r = el.getBoundingClientRect();
						const col = cols.find((c) => c.left - 1 <= (r.left + r.right) / 2 && (r.left + r.right) / 2 <= c.right + 1);
						return col === undefined
							? null
							: { title: el.querySelector(".ec-event-title")?.textContent ?? "", leftInset: r.left - col.left, rightInset: col.right - r.right };
					});
				}, cssClass("event"));
				for (const block of layout) {
					expect(block).not.toBeNull();
					if (block !== null) {
						// Inside the column on both sides — an overflow into the
						// neighbouring day shows up as a negative inset here.
						expect(block.leftInset).toBeGreaterThanOrEqual(2);
						expect(block.rightInset).toBeGreaterThanOrEqual(2);
					}
				}
			} finally {
				await setStandupTime("11:00");
			}
		});

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

		/**
		 * M4 "Touch QA pass" (docs/ROADMAP.md): the tests above drive every
		 * calendar gesture with `pointerType: "mouse"` (`.click()` synthesises
		 * a MouseEvent even for the drag tests' `browser.action("pointer",
		 * ...)` calls, which default to `pointerType: "mouse"`) — these repeat
		 * the tap/drag/slot-tap gestures with `pointerType: "touch"` instead,
		 * so the actual runtime config (`longPressDelay: 500`, `dragScroll:
		 * true`, `event-calendar-renderer.ts`) is exercised, not just the
		 * shared mapping code both pointer types funnel through.
		 *
		 * Verified against the vendored Event Calendar source
		 * (`@event-calendar/core/dist/index.js`, `Interaction`'s `common()`/
		 * `move()`): for a non-mouse `jsEvent.pointerType`, `common()` arms a
		 * `setTimeout(..., longPressDelay)` on pointerdown that only then sets
		 * `interacting = true` and starts applying the drag — `move()`'s mouse
		 * branch (`distance() >= eventDragMinDistance`) is gated on
		 * `pointerType === "mouse"`, so a touch move before that timer fires
		 * is not treated as a drag at all (deliberately: it leaves the
		 * gesture free to be read as a page scroll instead). This was
		 * confirmed interactively before writing these assertions (see the
		 * task's own throwaway `e2e/specs/zz-probe.e2e.ts`, deleted afterward
		 * per `docs/CONVENTIONS.md`'s DOM-probing note) by running a short and
		 * a long touch press against the same event and reading the on-disk
		 * "due" after each.
		 */
		it("taps a calendar event with a touch pointer to open the task note", async function () {
			await setCalendarInitialView("month");
			await browser.$(`.${cssClass("calendar")} .ec-day-grid`).waitForExist({ timeout: SELECT_TIMEOUT });
			await browser.waitUntil(
				async () => (await readCalendarEvents()).some((e) => e.title === "Today task" && e.className.includes(cssClass("event--due"))),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Today task's due event never appeared for the touch-tap-to-open test" },
			);

			// Viewport-relative center coordinates via `getBoundingClientRect`,
			// not a WebdriverIO element handle — same reasoning as the mouse
			// drag test above (a pointerdown can flip the chip's own DOM node
			// into a "ghost"/ordinary re-render mid-gesture).
			const eventPoint = await browser.execute(
				(calendarCls, eventCls, dueCls, title) => {
					const el = Array.from(document.querySelectorAll(`.${calendarCls} .${eventCls}`)).find(
						(e) => e.querySelector(".ec-event-title")?.textContent === title && e.classList.contains(dueCls),
					);
					if (el === undefined) {
						return null;
					}
					const rect = el.getBoundingClientRect();
					return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
				},
				cssClass("calendar"),
				cssClass("event"),
				cssClass("event--due"),
				"Today task",
			);
			if (eventPoint === null) {
				throw new Error("could not resolve Today task's due event element for the touch tap");
			}

			// A real touch tap: down and up at (almost) the same point, well
			// under `longPressDelay` — driven through wdio's low-level pointer
			// Actions API (as the drag tests are) rather than `.click()`, so
			// this actually dispatches PointerEvents with `pointerType:
			// "touch"` instead of a synthetic mouse click.
			await browser
				.action("pointer", { parameters: { pointerType: "touch" } })
				.move({ x: Math.round(eventPoint.x), y: Math.round(eventPoint.y), origin: "viewport" })
				.down({ button: 0 })
				.pause(50)
				.up({ button: 0 })
				.perform();

			await browser.waitUntil(async () => (await activeFilePath()) === "Tasks/Today task.md", {
				timeout: SELECT_TIMEOUT,
				timeoutMsg: "tapping the event with a touch pointer never opened Tasks/Today task.md",
			});

			await reopenCalendarView();
		});

		it("tapping an empty day-grid cell with a touch pointer opens the create-task modal", async function () {
			await setCalendarInitialView("month");
			await browser.$(`.${cssClass("calendar")} .ec-day-grid`).waitForExist({ timeout: SELECT_TIMEOUT });
			await browser.waitUntil(async () => (await readCalendarEvents()).length > 0, {
				timeout: SELECT_TIMEOUT,
				timeoutMsg: "no calendar events rendered before locating an empty day cell",
			});

			// Same empty-cell geometry search as the mouse slot-tap test
			// above, but returning the cell's own center point too so the
			// touch gesture below doesn't need a separate element lookup.
			const emptyCell = await browser.execute(
				(calendarCls, eventCls) => {
					const cells = Array.from(document.querySelectorAll(`.${calendarCls} .ec-day-grid .ec-day`));
					const eventRects = Array.from(document.querySelectorAll(`.${calendarCls} .ec-day-grid .${eventCls}`)).map((el) =>
						el.getBoundingClientRect(),
					);
					for (const cell of cells) {
						const dateAttr = cell.querySelector("time[datetime]")?.getAttribute("datetime");
						if (dateAttr === null || dateAttr === undefined) {
							continue;
						}
						const rect = cell.getBoundingClientRect();
						const overlapsEvent = eventRects.some(
							(er) => !(er.right <= rect.left || er.left >= rect.right || er.bottom <= rect.top || er.top >= rect.bottom),
						);
						if (!overlapsEvent) {
							return { date: dateAttr, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
						}
					}
					return null;
				},
				cssClass("calendar"),
				cssClass("event"),
			);
			if (emptyCell === null) {
				throw new Error("could not find an empty day-grid cell to tap");
			}

			await browser
				.action("pointer", { parameters: { pointerType: "touch" } })
				.move({ x: Math.round(emptyCell.x), y: Math.round(emptyCell.y), origin: "viewport" })
				.down({ button: 0 })
				.pause(50)
				.up({ button: 0 })
				.perform();

			const modalCls = cssClass("create-task-modal");
			await browser.$(`.${modalCls}`).waitForExist({ timeout: SELECT_TIMEOUT });

			// Same reasoning as the mouse slot-tap test above: `events: both`
			// pre-fills Scheduled (the second `input[type="date"]`), which
			// pulls "More options" open automatically.
			const scheduledInput = await inputAt(modalCls, "date", 1);
			expect(await scheduledInput.getValue()).toEqual(emptyCell.date);

			await browser.keys("Escape");
			await browser.$(`.${modalCls}`).waitForExist({ timeout: SELECT_TIMEOUT, reverse: true });
		});

		/**
		 * Resolves "Today task"'s due chip and an empty same-row day-grid
		 * cell — the same target-selection logic as
		 * `dragTodayTaskDueToEmptyCellSameRow` above, factored out here
		 * (without performing the gesture) because the short- and long-press
		 * touch tests below need the identical source/target pair but drive
		 * it with different pointer-action timings.
		 */
		async function resolveTodayTaskDragPlan(excludeDate: string): Promise<{
			readonly date: string;
			readonly source: { readonly x: number; readonly y: number };
			readonly target: { readonly x: number; readonly y: number };
		}> {
			const plan = await browser.execute(
				(calendarCls, eventCls, dueCls, excludeDateArg) => {
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
						if (dateAttr === null || dateAttr === undefined || dateAttr === excludeDateArg) {
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
				excludeDate,
			);
			if (plan === null) {
				throw new Error('could not resolve "Today task"\'s due event and an empty same-row day cell for a touch drag');
			}
			return plan;
		}

		it("a short touch press-and-move on an event does not reschedule it (below the long-press delay)", async function () {
			await setCalendarInitialView("month");
			await browser.$(`.${cssClass("calendar")} .ec-day-grid`).waitForExist({ timeout: SELECT_TIMEOUT });
			await browser.waitUntil(
				async () => (await readCalendarEvents()).some((e) => e.title === "Today task" && e.className.includes(cssClass("event--due"))),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Today task's due event never appeared for the short-press test" },
			);

			const originalDue = await frontmatterValueOnDisk("Tasks/Today task.md", "due");
			if (originalDue === undefined) {
				throw new Error('Today task has no on-disk "due" to compare against');
			}
			const plan = await resolveTodayTaskDragPlan(originalDue);

			// Down, a small move well inside the 500ms `longPressDelay`, then
			// up — short enough overall (~200ms total) that the library's
			// per-pointerdown timer (see the doc comment above) never fires,
			// so `interacting` never becomes true and the move is ignored
			// rather than treated as a drag (a real touch device would let
			// this scroll the page instead).
			await browser
				.action("pointer", { parameters: { pointerType: "touch" } })
				.move({ x: Math.round(plan.source.x), y: Math.round(plan.source.y), origin: "viewport" })
				.down({ button: 0 })
				.pause(100)
				.move({ x: Math.round(plan.source.x) + 15, y: Math.round(plan.source.y) + 15, origin: "viewport", duration: 60 })
				.pause(50)
				.up({ button: 0 })
				.perform();

			// There's no frontmatter change to poll for here (this asserts a
			// non-event) — same "let the fire-and-forget handling settle,
			// then read" technique as "does not spawn a duplicate when
			// completed again" in the Actions suite below.
			await browser.pause(400);
			expect(await frontmatterValueOnDisk("Tasks/Today task.md", "due")).toEqual(originalDue);
		});

		it("a long-press past the 500ms delay, then drag, reschedules the event (touch)", async function () {
			await setCalendarInitialView("month");
			await browser.$(`.${cssClass("calendar")} .ec-day-grid`).waitForExist({ timeout: SELECT_TIMEOUT });
			await browser.waitUntil(
				async () => (await readCalendarEvents()).some((e) => e.title === "Today task" && e.className.includes(cssClass("event--due"))),
				{ timeout: SELECT_TIMEOUT, timeoutMsg: "Today task's due event never appeared for the long-press-drag test" },
			);

			const originalDue = await frontmatterValueOnDisk("Tasks/Today task.md", "due");
			if (originalDue === undefined) {
				throw new Error('Today task has no on-disk "due" to compare against');
			}
			const plan = await resolveTodayTaskDragPlan(originalDue);

			// Hold well past the 500ms `longPressDelay` before moving at all —
			// the library arms the drag machinery on pointerdown but (per the
			// short-press test above) only starts actually applying the move
			// once that timer fires, so the hold has to genuinely exceed
			// 500ms for this drag to take effect.
			await browser
				.action("pointer", { parameters: { pointerType: "touch" } })
				.move({ x: Math.round(plan.source.x), y: Math.round(plan.source.y), origin: "viewport" })
				.down({ button: 0 })
				.pause(650)
				.move({ x: Math.round(plan.source.x) + 10, y: Math.round(plan.source.y) + 10, origin: "viewport", duration: 100 })
				.move({ x: Math.round(plan.target.x), y: Math.round(plan.target.y), origin: "viewport", duration: 250 })
				.pause(50)
				.up({ button: 0 })
				.perform();

			await browser.waitUntil(
				async () => (await frontmatterValueOnDisk("Tasks/Today task.md", "due")) === plan.date,
				{ timeout: SELECT_TIMEOUT, timeoutMsg: `Today task's on-disk "due" never became ${plan.date} after the touch long-press drag` },
			);
			expect(await frontmatterValueOnDisk("Tasks/Today task.md", "due")).toEqual(plan.date);
		});

		/**
		 * M4 "Touch QA pass" mobile check: the calendar at an actual phone
		 * viewport, not merely under the mobile flags.
		 *
		 * Two independent things are needed and both are non-obvious.
		 * `app.emulateMobile(boolean)` is undocumented (present at runtime,
		 * not in `obsidian.d.ts`) and flips the `is-mobile`/`is-tablet` body
		 * classes and mobile API flags a real mobile client carries — but it
		 * does NOT resize anything. The resize has to come from Electron
		 * directly (`windowSize`/`setWindowSize` above), because WebDriver's
		 * own `setWindowSize` is unimplemented in this Electron session and
		 * wdio 9's `emulate()` is Bidi-only.
		 *
		 * 390x844 is an iPhone 14/15-class logical viewport — narrow enough
		 * that a toolbar or month grid that can't cope will visibly break.
		 * `E2E_SCREENSHOT=1` saves `calendar-mobile-emulated.png` for review.
		 */
		it("renders the calendar at a phone viewport under app.emulateMobile(true)", async function () {
			const originalSize = await windowSize();
			await setWindowSize(390, 844);
			await browser.executeObsidian(({ app }) => {
				(app as unknown as { emulateMobile: (v: boolean) => void }).emulateMobile(true);
			});

			try {
				// emulateMobile(true) tears down the active leaf's view (it
				// comes back as an empty "New tab" pane) rather than
				// re-rendering the Bases view in place, so the base and its
				// Calendar view have to be reopened — via the same hardened
				// helper the other tests use, which retries until the calendar
				// is really mounted rather than until the menu item appears.
				await reopenCalendarView();

				await browser.waitUntil(async () => (await readCalendarEvents()).length > 0, {
					timeout: SELECT_TIMEOUT,
					timeoutMsg: "no calendar events rendered under app.emulateMobile(true)",
				});
				await expect(browser.$(`.${cssClass("calendar")} .ec`)).toExist();

				if (process.env["E2E_SCREENSHOT"] === "1") {
					await saveScreenshot("calendar-mobile-emulated");
				}
			} finally {
				await browser.executeObsidian(({ app }) => {
					(app as unknown as { emulateMobile: (v: boolean) => void }).emulateMobile(false);
				});
				// Restore the desktop viewport before any later spec runs —
				// every other calendar test computes drag coordinates from
				// rendered element rects, which a 390px-wide window changes.
				await setWindowSize(originalSize[0], originalSize[1]);
				await reopenCalendarView();
			}
		});

		/**
		 * The calendar-compaction feature this test covers: below
		 * `COMPACT_CALENDAR_WIDTH` (`domain/calendar-view-options.ts`), month
		 * renders as a grid of small DOTS instead of chips (a 390px month
		 * cell is ~53px wide, room for a legible dot but not a chip's title),
		 * week still collapses to a rolling 3-day view, and tapping a compact
		 * month day cell drills into Day view instead of opening the
		 * create-task modal. There is no "Month falls back to 3 days" wart
		 * any more — `domain/calendar-view-options.ts` no longer remaps any
		 * view when compact, so the header keeps listing (and rendering)
		 * Month at every pane width; only its CHROME (dots vs. chips, no
		 * create-on-tap) changes below the threshold. Same window-resize
		 * technique as the test above (`windowSize`/`setWindowSize` —
		 * WebDriver's own `setWindowSize` doesn't work against this Electron
		 * session), but this one doesn't need `app.emulateMobile(true)` —
		 * compaction keys off the pane's own `clientWidth`, not `is-mobile`,
		 * so plain desktop-Electron-at-390px is enough to exercise it (and is
		 * closer to the narrow-*split-pane*-on-desktop case the feature also
		 * covers).
		 */
		it("renders a dot grid for compact month, keeps the rolling 3-day week view, and drills a tap into Day view", async function () {
			const originalSize = await windowSize();
			await setWindowSize(390, 844);
			// Unlike the `app.emulateMobile(true)` test above (which switches
			// Obsidian into its own mobile layout, hiding the sidebars), a plain
			// 390px desktop window keeps both docked sidebars at their normal
			// width — leaving so little room for the actual workspace leaf that
			// its own Bases toolbar buttons overlap and become unclickable.
			// Collapsing both sidebars is what makes this a fair "narrow PANE",
			// not a broken desktop layout — closer to the split-pane case the
			// compaction feature is meant to cover too. Their ORIGINAL collapsed
			// state is captured so the `finally` below can restore it exactly —
			// the right sidebar starts collapsed in this vault, and blindly
			// `.expand()`-ing it back would leave it open (and the middle Bases
			// pane visibly narrower than 640px) for every calendar test/screenshot
			// that runs after this one.
			const wasLeftCollapsed = await browser.executeObsidian(({ app }) => app.workspace.leftSplit.collapsed);
			const wasRightCollapsed = await browser.executeObsidian(({ app }) => app.workspace.rightSplit.collapsed);
			await browser.executeObsidian(({ app }) => {
				app.workspace.leftSplit.collapse();
				app.workspace.rightSplit.collapse();
			});

			try {
				// Navigate fully away and back (rather than re-opening Tasks.base
				// while already on it, a no-op that wouldn't force a fresh mount)
				// so the calendar mounts fresh and measures the current 390px
				// width — mirrors the mobile test above's own reasoning for why
				// it re-opens the base after `emulateMobile` tears the view down.
				await openFile("Tasks/Today task.md");
				await reopenCalendarView();

				// Tasks.base leaves `initialView` unset (defaults to "month"), and
				// compact no longer remaps that to anything else — the pane still
				// renders the full 7-column day-grid, just with dots instead of
				// chips (asserted below).
				await browser.$(`.${cssClass("calendar")} .ec-day-grid`).waitForExist({ timeout: SELECT_TIMEOUT });
				await expect(browser.$(`.${cssClass("calendar")} .ec-week-view`)).not.toExist();
				await browser.waitUntil(async () => (await readColumnHeaderCount(cssClass("calendar"))) === 7, {
					timeout: SELECT_TIMEOUT,
					timeoutMsg: "expected exactly 7 day columns in the compact month grid",
				});

				let textLabels = (await readToolbarButtons()).map((b) => b.text.trim()).filter((t) => t.length > 0);
				expect(textLabels).toContain("Month");
				expect(textLabels).toContain("3 days");
				expect(textLabels).toContain("Day");
				expect(textLabels).not.toContain("Week");
				const active = (await readToolbarButtons()).filter((b) => b.isActive);
				expect(active).toHaveLength(1);
				expect(active[0]?.text.trim()).toEqual("Month");

				// "Today" carries several due/scheduled fixtures (`e2e/fixtures.ts`:
				// "Today task", "Deadline call", "Early ping", "Late ping", "Team
				// sync", "Standup", "Planning session" — 7 candidates under the
				// default `events: both`), so its month cell is the busy day this
				// suite uses to prove the cap without adding any fixture of its own.
				await browser.waitUntil(async () => (await readCompactMonthDots()).some((d) => d.date === fixtures.today), {
					timeout: SELECT_TIMEOUT,
					timeoutMsg: "no compact month dots rendered for today",
				});
				const dots = await readCompactMonthDots();

				// No visible chip titles anywhere in the compact month grid: the
				// title text stays in the DOM (assistive tech still gets it) but
				// is clipped to ~0 rendered width, the same treatment already
				// proven for the compact time-axis gutter's "all-day" label.
				expect(dots.length).toBeGreaterThan(0);
				for (const dot of dots) {
					expect(dot.titleText.trim().length).toBeGreaterThan(0);
					expect(dot.titleWidth).toBeLessThanOrEqual(1);
				}

				// Today's cell: several tasks, but only a handful of dots actually
				// visible — `dayMaxEvents: true` (compact month only,
				// `event-calendar-renderer.ts`) plus `calendar.css`'s fixed
				// `--ec-row-height` cap the stack rather than letting it grow the
				// whole week row taller.
				const todayDots = dots.filter((d) => d.date === fixtures.today);
				expect(todayDots.length).toBeGreaterThan(4);
				const visibleTodayDots = todayDots.filter((d) => d.visible);
				expect(visibleTodayDots.length).toBeGreaterThan(1);
				expect(visibleTodayDots.length).toBeLessThanOrEqual(4);

				if (process.env["E2E_SCREENSHOT"] === "1") {
					await saveScreenshot("calendar-compact-month-390");
				}

				// Tapping a day cell — even a busy one, directly over its dots —
				// drills into Day view for that date instead of opening the
				// create-task modal (`calendar-view.ts#onSlotClick`). Clicking
				// squarely on a dot is deliberate here (not an "empty" cell like
				// the wide-pane click-to-create test needs): dots are
				// `pointer-events: none` precisely so this works.
				const todayCell = await monthDayCellByDate(fixtures.today);
				await todayCell.click();

				await browser.$(`.${cssClass("calendar")} .ec-day-view`).waitForExist({ timeout: SELECT_TIMEOUT });
				const modalCls = cssClass("create-task-modal");
				await expect(browser.$(`.${modalCls}`)).not.toExist();
				const shownDate = await browser.execute(
					(calendarCls) => document.querySelector(`.${calendarCls} .ec-day-view time[datetime]`)?.getAttribute("datetime") ?? null,
					cssClass("calendar"),
				);
				expect(shownDate).toEqual(fixtures.today);

				// The tap above navigated Event Calendar's OWN internal view to
				// "day" without touching the Bases `initialView` config (by
				// design — see `calendar-view.ts`'s `onSlotClick` doc comment:
				// the view never learns about a switch made through Event
				// Calendar itself). No Bases navigation happened either (unlike
				// clicking an EVENT, which opens the task note and replaces the
				// leaf), so the SAME calendar instance is still mounted — setting
				// `initialView` straight to "week" below still lands there: the
				// view's own change-detection compares against what it last
				// applied ("month", untouched by the tap), which differs from
				// "week" regardless of what Event Calendar is actually showing
				// right now.
				//
				// Week is unaffected by any of this — still the rolling 3-day view,
				// unchanged from before this feature (item kept "exactly as it
				// is"): same column count, same "3 days" label, and the same
				// stacked time-above-title chip layout at this column width.
				await setCalendarInitialView("week");
				await browser.$(`.${cssClass("calendar")} .ec-week-view`).waitForExist({ timeout: SELECT_TIMEOUT });
				await expect(browser.$(`.${cssClass("calendar")} .ec-day-grid`)).not.toExist();
				await browser.waitUntil(async () => (await readColumnHeaderCount(cssClass("calendar"))) === 3, {
					timeout: SELECT_TIMEOUT,
					timeoutMsg: "expected exactly 3 day columns in the compact rolling week view",
				});
				// The switcher itself lists the same three buttons regardless of
				// which one is currently active (Month included — there is no
				// "compact hides Month" suppression any more), only the currently
				// active one differs.
				textLabels = (await readToolbarButtons()).map((b) => b.text.trim()).filter((t) => t.length > 0);
				expect(textLabels).toContain("Month");
				expect(textLabels).toContain("3 days");
				expect(textLabels).toContain("Day");
				expect(textLabels).not.toContain("Week");
				const activeInWeek = (await readToolbarButtons()).filter((b) => b.isActive);
				expect(activeInWeek).toHaveLength(1);
				expect(activeInWeek[0]?.text.trim()).toEqual("3 days");

				// A timed all-day chip keeps ONE line at the narrow (~86px)
				// compact column by hiding its TIME label (`calendar.css`'s
				// compact all-day comment): an earlier `flex-wrap` fix stacked
				// time above title instead, but with the leading project dot that
				// wrap put the title on a line UNDER the dot. The title — the
				// part that identifies the task — must be genuinely visible
				// (rendered width, not just present in the DOM), and the time
				// label genuinely gone, not merely narrow.
				const timedChips = await readTimedAllDayChipLayouts();
				expect(timedChips.length).toBeGreaterThan(0);
				for (const chip of timedChips) {
					expect(chip.timeWidth).toBeLessThanOrEqual(1);
					expect(chip.title.trim().length).toBeGreaterThan(0);
					expect(chip.titleWidth).toBeGreaterThan(20);
				}

				if (process.env["E2E_SCREENSHOT"] === "1") {
					await saveScreenshot("calendar-compact-week-390");
				}
			} finally {
				// Restore the desktop viewport and each sidebar's ORIGINAL
				// collapsed state before any later calendar test/screenshot —
				// they assume the normal desktop layout, and compute drag
				// coordinates from rendered element rects.
				await setWindowSize(originalSize[0], originalSize[1]);
				await browser.executeObsidian(
					({ app }, leftCollapsed: boolean, rightCollapsed: boolean) => {
						if (leftCollapsed) {
							app.workspace.leftSplit.collapse();
						} else {
							app.workspace.leftSplit.expand();
						}
						if (rightCollapsed) {
							app.workspace.rightSplit.collapse();
						} else {
							app.workspace.rightSplit.expand();
						}
					},
					wasLeftCollapsed,
					wasRightCollapsed,
				);
				// Force a fresh mount at the restored width rather than trust
				// `onResize` to have already caught up by the time later
				// tests/screenshots run — navigating away and back (not a bare
				// `reopenCalendarView()`, a no-op re-open of the file already
				// active that never re-renders) guarantees the calendar leaves
				// this test in the normal, non-compact state.
				await openFile("Tasks/Today task.md");
				await reopenCalendarView();
			}
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
 * state left by an earlier test in this same file (e.g. "Settings
 * round-trip" acts on `Tasks/Today task.md`, still at its fixture default of
 * status=todo at that point) rather than each resetting the fixture — this
 * mirrors a real editing session and halves the number of `openFile`
 * round-trips. Each
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

		after(async function () {
			// Both tests above depend on the mutation/spawn persisting between
			// them, so cleanup runs once here rather than in `afterEach` — undo
			// the completion and remove the spawned occurrence so a "next-week"
			// due date doesn't linger for whatever runs the suite next.
			await restoreFixtureNote(originalPath, fixtures.recurring.frontmatter, fixtures.recurring.body);
			await deleteNoteIfExists(spawnPath);

			// Robustness check: prove the cleanup actually removed the spawned
			// occurrence — its `due` (today + 7 days) lands in "next-week", the
			// same Feed bucket a fresh vault has genuinely empty — rather than
			// merely running without throwing.
			const spawnStillExists = await browser.executeObsidian(({ app }, p: string) => app.vault.getFileByPath(p) !== null, spawnPath);
			expect(spawnStillExists).toBe(false);
		});

		it("marks the original done and spawns the next occurrence", async function () {
			await browser.executeObsidianCommand("isotask:complete-task");

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

			// The body is appended in a separate write after the frontmatter, so
			// the cache having the frontmatter doesn't yet mean the body is there.
			await browser.waitUntil(
				async () => {
					const spawnBody = await readFileContent(spawnPath);
					return spawnBody?.includes(fixtures.recurring.body) ?? false;
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: `${spawnPath} body never got the fixture text` },
			);
		});

		it("does not spawn a duplicate when completed again", async function () {
			// The original is already status=done; re-running complete-task is a
			// same-status no-op in applyStatusChange (domain/transitions.ts), so
			// no second spawn should appear.
			await browser.executeObsidianCommand("isotask:complete-task");

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

	describe("Convert note to task", function () {
		const path = "Plain.md";

		before(async function () {
			await browser.executeObsidian(async ({ app }, p: string) => {
				await app.vault.create(p, "Just a plain note, no frontmatter.\n");
			}, path);
			await openFile(path);
		});

		after(async function () {
			// `path` isn't a fixture note — generate-fixtures.mts deletes any
			// stray "Plain.md" before its NEXT run, but nothing removes it for
			// the rest of *this* run otherwise.
			await deleteNoteIfExists(path);
		});

		it("adds the task marker, an open status and a created date", async function () {
			await browser.executeObsidianCommand("isotask:convert-note-to-task");

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

		after(async function () {
			// Only the first `it` below creates this note; deleting
			// unconditionally after the describe block keeps it out of every
			// later test's Feed/vault-file-count assertions.
			await deleteNoteIfExists(createdPath);
		});

		it("creates a task from the modal and opens it", async function () {
			await browser.executeObsidianCommand("isotask:create-task");
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
			await browser.executeObsidianCommand("isotask:create-task");
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

	describe("Settings round-trip", function () {
		const path = "Tasks/Today task.md";

		before(async function () {
			// Still at its fixture default, status=todo — nothing earlier in
			// this describe touches "Today task.md".
			await openFile(path);
		});

		it("picks up a status added to settings after a plugin reload", async function () {
			// "waiting" (open-kind) is inserted BEFORE "todo", so — if picked up
			// — it becomes `firstOpenStatus`, the toggle's reopen target
			// (`domain/status.ts#toggleStatus`), letting this test tell "settings
			// re-read after reload" apart from "still running on the old,
			// cached list".
			const newSettings: IsotaskSettings = {
				...DEFAULT_SETTINGS,
				statuses: [{ id: "waiting" as StatusId, label: "Waiting", kind: "open" }, ...DEFAULT_STATUSES],
			};

			// IsotaskPlugin exposes no public settings setter (`saveSettings` is
			// private), so settings are round-tripped the same way a user's
			// hand-edited data.json would be: persist via the inherited public
			// `Plugin.saveData`, then force a reload so `onload` -> `loadSettings`
			// re-parses it (`app.plugins.disable/enablePlugin` aren't in
			// obsidian.d.ts's public types, hence the cast — same allowance
			// AGENTS.md gives `app.plugins.getPlugin` in e2e).
			await browser.executeObsidian(
				async ({ app, plugins }, settings: IsotaskSettings) => {
					const plugin = plugins["isotask"];
					if (plugin === undefined) {
						throw new Error("isotask plugin is not installed");
					}
					await plugin.saveData(settings);
					const internalPlugins = (app as unknown as {
						plugins: {
							disablePlugin: (id: string) => Promise<void>;
							enablePlugin: (id: string) => Promise<void>;
						};
					}).plugins;
					await internalPlugins.disablePlugin("isotask");
					await internalPlugins.enablePlugin("isotask");
				},
				newSettings,
			);

			// The reload tears down and re-registers commands/views; re-open the
			// note so it's the active file again before dispatching a command.
			await openFile(path);

			// Complete, then reopen: the reopen step is the one that resolves
			// `firstOpenStatus`, so its result is what actually proves the
			// reloaded list (with "waiting" first) was read.
			await browser.executeObsidianCommand("isotask:complete-task");
			await waitForFrontmatter(path, "status", (v) => v === "done", "expected status=done before reopening");

			await browser.executeObsidianCommand("isotask:toggle-done");
			await waitForFrontmatter(path, "status", (v) => v === "waiting", 'expected status="waiting" after reload');
			const fm = await frontmatterOf(path);
			expect(fm?.["status"]).toEqual("waiting");
			expect(fm?.["completed"]).toBeUndefined();
		});
	});

	describe("Create tasks base", function () {
		const path = "Tasks.base";

		it("does not overwrite an existing tasks base", async function () {
			const contentBefore = await readFileContent(path);

			await browser.executeObsidianCommand("isotask:create-tasks-base");

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
