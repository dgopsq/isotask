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

/** The `.setting-item-description` text and class list of the panel's `Setting` row named `name` — e.g. asserting the "Reminder" row shows its default-value styling. */
async function panelRowDesc(name: string): Promise<{ text: string | null; classes: string[] }> {
	return browser.execute(
		(panelCls, wanted) => {
			const root = document.querySelector(`.${panelCls}`);
			const rows = root === null ? [] : Array.from(root.querySelectorAll(".setting-item"));
			const row = rows.find((r) => r.querySelector(".setting-item-name")?.textContent === wanted);
			const desc = row?.querySelector(".setting-item-description") ?? null;
			return { text: desc?.textContent ?? null, classes: desc === null ? [] : Array.from(desc.classList) };
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

/** Option texts of the reminder modal's preset dropdown, in DOM order — there is exactly one `<select>` until "Custom offset…" adds a second (unit) dropdown. */
async function reminderModalOptionTexts(): Promise<string[]> {
	return browser.execute((modalCls) => {
		const select = document.querySelector(`.${modalCls} select`);
		return select === null ? [] : Array.from(select.querySelectorAll("option")).map((option) => option.textContent);
	}, cssClass("reminder-modal"));
}

async function reminderModalDescriptionText(): Promise<string | null> {
	return browser.execute(
		(descCls) => document.querySelector(`.${descCls}`)?.textContent ?? null,
		cssClass("reminder-modal-description"),
	);
}

/** Obsidian's `DropdownComponent` listens for `change`, not `input` — setting `.value` alone never notifies it. */
async function selectReminderModalOption(text: string): Promise<void> {
	await browser.execute(
		(modalCls, wanted) => {
			const select = document.querySelector(`.${modalCls} select`);
			if (!(select instanceof HTMLSelectElement)) {
				return;
			}
			const option = Array.from(select.querySelectorAll("option")).find((o) => o.textContent === wanted);
			if (option === undefined) {
				return;
			}
			select.value = option.value;
			select.dispatchEvent(new Event("change", { bubbles: true }));
		},
		cssClass("reminder-modal"),
		text,
	);
}

async function clickReminderModalButton(text: string): Promise<void> {
	const buttons = await browser.$$(`.${cssClass("reminder-modal")} button`).getElements();
	for (const button of buttons) {
		if ((await button.getText()) === text) {
			await button.click();
			return;
		}
	}
	throw new Error(`no reminder modal button with text "${text}"`);
}

/** Best-effort cleanup for a test that fails mid-modal — an open modal left behind would block every later test's commands. */
async function closeLeftoverReminderModal(): Promise<void> {
	if (await browser.$(`.${cssClass("reminder-modal")}`).isExisting()) {
		await browser.keys("Escape");
	}
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
		expect(fieldNames).toEqual(["Done", "Priority", "Due", "Scheduled", "Duration", "Repeat", "Reminder", "Project", "Tags"]);

		// "Today task" has no `remind`, so the row falls back to the vault
		// default preset ("At time") and carries the default-value class.
		const reminderDesc = await panelRowDesc("Reminder");
		expect(reminderDesc.text).toEqual("At time");
		expect(reminderDesc.classes).toContain(cssClass("panel__default"));

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

	it("sets a reminder preset from the modal and writes remind to frontmatter", async function () {
		try {
			// Not left to the first test: E2E_GREP can filter that one out.
			await openTaskPanel();
			await browser.executeObsidianCommand("isotask:set-reminder");
			await browser.$(`.${cssClass("reminder-modal")}`).waitForExist({ timeout: SELECT_TIMEOUT });

			expect(await reminderModalOptionTexts()).toEqual([
				"At time",
				"15 min before",
				"1 hour before",
				"1 day before",
				"None",
				"Custom offset…",
				"At a specific time…",
			]);
			expect(await reminderModalDescriptionText()).toEqual("At time");

			if (process.env["E2E_SCREENSHOT"] === "1") {
				await saveScreenshot("reminder-modal");
			}

			await selectReminderModalOption("1 day before");
			expect(await reminderModalDescriptionText()).toEqual("1 day before");

			await clickReminderModalButton("Save");

			await waitForFrontmatter(
				path,
				"remind",
				(v) => Array.isArray(v) && v[0] === "1d",
				`${path} remind never became ["1d"] via the reminder modal`,
			);

			await browser.waitUntil(
				async () => {
					const desc = await panelRowDesc("Reminder");
					return desc.text === "1 day before" && !desc.classes.includes(cssClass("panel__default"));
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: 'task panel Reminder row never became "1 day before"' },
			);
		} finally {
			await closeLeftoverReminderModal();
			await restoreFixtureNote(path, task.frontmatter, task.body);
			await waitForFrontmatter(path, "remind", (v) => v === undefined, `${path} remind never restored to its fixture value`);
		}
	});

	it("Use default removes the remind property", async function () {
		try {
			await openTaskPanel();
			await restoreFixtureNote(path, { ...task.frontmatter, remind: "15m" }, task.body);
			await waitForFrontmatter(path, "remind", (v) => v === "15m", `${path} remind never seeded to "15m"`);

			await browser.waitUntil(
				async () => {
					const desc = await panelRowDesc("Reminder");
					return desc.text === "15 min before" && !desc.classes.includes(cssClass("panel__default"));
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: 'task panel Reminder row never became "15 min before"' },
			);

			await browser.executeObsidianCommand("isotask:set-reminder");
			await browser.$(`.${cssClass("reminder-modal")}`).waitForExist({ timeout: SELECT_TIMEOUT });

			await clickReminderModalButton("Use default");

			await waitForFrontmatter(path, "remind", (v) => v === undefined, `${path} remind never removed via "Use default"`);

			await browser.waitUntil(
				async () => {
					const desc = await panelRowDesc("Reminder");
					return desc.text === "At time" && desc.classes.includes(cssClass("panel__default"));
				},
				{ timeout: SELECT_TIMEOUT, timeoutMsg: 'task panel Reminder row never reverted to "At time" default' },
			);
		} finally {
			await closeLeftoverReminderModal();
			await restoreFixtureNote(path, task.frontmatter, task.body);
			await waitForFrontmatter(path, "remind", (v) => v === undefined, `${path} remind never restored to its fixture value`);
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

// Settings open in a separate Electron window this wdio session cannot see, so rows are read off the
// tab's own `containerEl` (same renderer) instead of `document`. `app.setting` is not in the public types.
interface AppWithSettingModal {
	readonly setting: {
		readonly open: () => void;
		readonly close: () => void;
		readonly openTabById: (id: string) => void;
		readonly pluginTabs: readonly { readonly id?: string; readonly containerEl?: HTMLElement }[];
	};
}

describe("Reminders", function () {
	it('shows a notice pointing at "Send via ntfy" when reminders are off', async function () {
		await browser.executeObsidianCommand("isotask:send-reminders-now");

		// Poll rather than a single waitForExist — same rationale as the "Create
		// tasks base" suite in views.e2e.ts: an earlier notice could still be around.
		await browser.waitUntil(
			async () => {
				const notices = await browser.$$(".notice").getElements();
				const texts = await notices.map((notice) => notice.getText());
				return texts.some((text) => text.includes("Send via ntfy"));
			},
			{ timeout: SELECT_TIMEOUT, timeoutMsg: 'expected a notice mentioning "Send via ntfy"' },
		);
	});

	it("shows the reminders controls in the Isotask settings tab", async function () {
		await browser.executeObsidian(({ app }) => {
			(app as unknown as AppWithSettingModal).setting.open();
		});
		try {
			const names = await browser.executeObsidian(({ app }) => {
				const setting = (app as unknown as AppWithSettingModal).setting;
				setting.openTabById("isotask");
				const tab = setting.pluginTabs.find((t) => t.id === "isotask");
				return tab?.containerEl === undefined ? [] : Array.from(tab.containerEl.querySelectorAll(".setting-item-name")).map((el) => el.textContent);
			});
			expect(names).toEqual(expect.arrayContaining(["Send via ntfy", "Lookahead", "Check ntfy server"]));
		} finally {
			await browser.executeObsidian(({ app }) => {
				(app as unknown as AppWithSettingModal).setting.close();
			});
		}
	});
});
