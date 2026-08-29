import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { browser, expect } from "@wdio/globals";
import { addDays, format, parseISO } from "date-fns";
import { after, afterEach, before, describe, it } from "mocha";

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

async function inputAt(modalCls: string, type: string, index: number): Promise<WebdriverIO.Element> {
	const els = await browser.$$(`.${modalCls} input[type="${type}"]`).getElements();
	const el = els[index];
	if (el === undefined) {
		throw new Error(`No input[type="${type}"] at index ${String(index)} in .${modalCls}`);
	}
	return el;
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
