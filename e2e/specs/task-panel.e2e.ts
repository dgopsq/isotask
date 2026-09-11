import { browser, expect } from "@wdio/globals";
import { after, afterEach, before, describe, it } from "mocha";

import { buildFixtures, noteContent } from "../fixtures.ts";
import { fileURLToPath, mkdir } from "../node-io.ts";
import { cssClass } from "@/plugin-id";

/**
 * Sidebar "Task" panel (`views/task-panel/task-panel-view.ts`) — a plain
 * `ItemView`, not a Bases view, so it gets its own spec file rather than
 * folding into `views.e2e.ts`'s Feed/Calendar suites. wdio-obsidian-service
 * launches a fresh Obsidian instance per spec *file* against a vault sandbox
 * shared across the whole `wdio run`, so every fixture mutation here is
 * restored before this file's tests finish — see `restoreFixtureNote` below,
 * mirroring `views.e2e.ts`'s own idiom.
 */

const fixtures = buildFixtures();

const SELECT_TIMEOUT = 5_000;

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));

async function saveScreenshot(name: string): Promise<void> {
	await mkdir(screenshotDir, { recursive: true });
	await browser.saveScreenshot(fileURLToPath(new URL(`../screenshots/${name}.png`, import.meta.url)));
}

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

/** Polls a frontmatter field until `predicate` matches — same rationale as `views.e2e.ts`'s helper of the same name: commands/panel actions dispatch their `app/` use-case as a fire-and-forget promise, so the write lands after the triggering interaction already resolved. */
async function waitForFrontmatter(path: string, key: string, predicate: (value: unknown) => boolean, timeoutMsg: string): Promise<void> {
	await browser.waitUntil(
		async () => {
			const fm = await frontmatterOf(path);
			return predicate(fm?.[key]);
		},
		{ timeout: SELECT_TIMEOUT, timeoutMsg },
	);
}

/** Restores a fixture note to exactly the content `generate-fixtures.mts` would have written for it — see `views.e2e.ts`'s identical helper for the full rationale (nothing resets the vault between spec files sharing one sandbox). */
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

async function deleteNoteIfExists(path: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, p: string) => {
		const file = app.vault.getFileByPath(p);
		if (file !== null) {
			await app.fileManager.trashFile(file);
		}
	}, path);
}

/** Opens the sidebar task panel via its command and waits for its root element to mount. */
async function openTaskPanel(): Promise<void> {
	await browser.executeObsidianCommand("isotask:open-task-panel");
	await browser.$(`.${cssClass("panel")}`).waitForExist({ timeout: SELECT_TIMEOUT });
}

async function panelTitleText(): Promise<string | null> {
	return browser.execute(
		(panelCls, titleCls) => document.querySelector(`.${panelCls} .${titleCls}`)?.textContent ?? null,
		cssClass("panel"),
		cssClass("panel__title"),
	);
}

async function panelEmptyText(): Promise<string | null> {
	return browser.execute(
		(panelCls, emptyCls) => document.querySelector(`.${panelCls} .${emptyCls}`)?.textContent ?? null,
		cssClass("panel"),
		cssClass("panel__empty"),
	);
}

/** Every `Setting` row name currently rendered in the panel, in DOM order — `.setting-item-name` is Obsidian's own class for a `Setting`'s label. */
async function panelFieldNames(): Promise<string[]> {
	return browser.execute((panelCls) => {
		const root = document.querySelector(`.${panelCls}`);
		if (root === null) {
			return [];
		}
		return Array.from(root.querySelectorAll(".setting-item-name")).map((el) => el.textContent);
	}, cssClass("panel"));
}

/** The panel's own row-lookup-by-label logic, factored out of `panelDropdownFor`/`panelToggleFor`: the index (in DOM order) of the `Setting` row named `name`, or -1 if there is none. */
async function panelRowIndex(name: string): Promise<number> {
	return browser.execute(
		(panelCls, wanted) => {
			const root = document.querySelector(`.${panelCls}`);
			if (root === null) {
				return -1;
			}
			const rows = Array.from(root.querySelectorAll(".setting-item"));
			return rows.findIndex((row) => row.querySelector(".setting-item-name")?.textContent === wanted);
		},
		cssClass("panel"),
		name,
	);
}

/** The `.checkbox-container` toggle control inside the panel's `Setting` row named `name` (e.g. "Done"); see `panelToggleChecked` for how its on/off state is read. */
async function panelToggleFor(name: string): Promise<WebdriverIO.Element> {
	const index = await panelRowIndex(name);
	if (index < 0) {
		throw new Error(`"${name}" row not found in the task panel`);
	}
	const rows = await browser.$$(`.${cssClass("panel")} .setting-item`).getElements();
	const row = rows[index];
	if (row === undefined) {
		throw new Error(`"${name}" row element missing at index ${String(index)}`);
	}
	const toggle = await row.$(".checkbox-container").getElement();
	if (!(await toggle.isExisting())) {
		throw new Error(`"${name}" row has no .checkbox-container toggle`);
	}
	return toggle;
}

/** Whether the panel's `Setting` row named `name` is a checked toggle — Obsidian's `ToggleComponent` renders `<label class="checkbox-container">` and adds `is-enabled` when on, rather than setting the underlying (visually hidden) checkbox input's `checked` property. */
async function panelToggleChecked(name: string): Promise<boolean> {
	const toggle = await panelToggleFor(name);
	const classAttr = await toggle.getAttribute("class");
	return classAttr.split(/\s+/).includes("is-enabled");
}

/** The "Convert to task" button's visible text, if the panel is currently showing the convert prompt. */
async function convertButtonText(): Promise<string | null> {
	return browser.execute(
		(panelCls) => document.querySelector(`.${panelCls} button`)?.textContent ?? null,
		cssClass("panel"),
	);
}

describe("Task panel", function () {
	const task = fixtures.tasks[1]; // "Today task" — has both `due` and `scheduled`, status "todo", no priority/project/tags/duration/repeat set.
	if (task === undefined) {
		throw new Error("expected fixtures.tasks[1] (Today task) to exist");
	}
	const path = `Tasks/${task.filename}`;
	const plainPath = "Task panel plain note.md";

	before(async function () {
		await openFile(path);
	});

	afterEach(async function () {
		if (this.currentTest?.state === "failed") {
			const slug = this.currentTest.fullTitle().replace(/[^a-z0-9]+/gi, "-").toLowerCase();
			await saveScreenshot(`failure-${slug}`);
		}
	});

	after(async function () {
		await deleteNoteIfExists(plainPath);
	});

	it("shows the task title and every field row for a valid task note", async function () {
		await openTaskPanel();

		await browser.waitUntil(async () => (await panelTitleText()) === task.title, {
			timeout: SELECT_TIMEOUT,
			timeoutMsg: `task panel title never became "${task.title}"`,
		});
		expect(await panelTitleText()).toEqual(task.title);

		const fieldNames = await panelFieldNames();
		expect(fieldNames).toEqual(["Done", "Priority", "Due", "Scheduled", "Duration", "Repeat", "Project", "Tags"]);

		// Taken here, not after the later tests in this file switch the panel
		// to a non-task note: the Bases containerEl-reuse pitfall (a screenshot
		// can show the last-rendered view instead of the current one) applies
		// to this panel's own contentEl re-render too, so the screenshot is
		// captured while the task form is unambiguously what's on screen.
		if (process.env["E2E_SCREENSHOT"] === "1") {
			await saveScreenshot("task-panel");
		}
	});

	it("toggles Done via the panel's checkbox and writes it to frontmatter", async function () {
		try {
			expect(await panelToggleChecked("Done")).toBe(false);

			const toggle = await panelToggleFor("Done");
			await toggle.click();

			await waitForFrontmatter(path, "status", (v) => v === "done", `${path} status never became done via the task panel`);
			const fm = await frontmatterOf(path);
			expect(fm?.["status"]).toEqual("done");
			expect(typeof fm?.["completed"]).toEqual("string");

			// The panel re-renders from the metadata cache's debounced `changed`
			// subscription (`REFRESH_DEBOUNCE_MS`, `task-panel-view.ts`) — poll
			// its own toggle state rather than reading it once immediately.
			await browser.waitUntil(async () => panelToggleChecked("Done"), {
				timeout: SELECT_TIMEOUT,
				timeoutMsg: "task panel's Done toggle never re-rendered as checked",
			});
		} finally {
			await restoreFixtureNote(path, task.frontmatter, task.body);
			await waitForFrontmatter(path, "status", (v) => v === "todo", `${path} status never restored to its fixture value`);
		}
	});

	it('shows "Not a task note yet." with a Convert to task button for a non-task note', async function () {
		await browser.executeObsidian(
			async ({ app }, p: string) => {
				await app.vault.create(p, "Just a plain note, no frontmatter.\n");
			},
			plainPath,
		);

		await openFile(plainPath);

		await browser.waitUntil(async () => (await panelEmptyText()) === "Not a task note yet.", {
			timeout: SELECT_TIMEOUT,
			timeoutMsg: 'task panel never showed "Not a task note yet." for the plain note',
		});
		expect(await panelEmptyText()).toEqual("Not a task note yet.");
		expect(await panelTitleText()).toEqual("Task panel plain note");
		expect(await convertButtonText()).toEqual("Convert to task");
	});
});
