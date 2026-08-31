import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFixtures, noteContent } from "./fixtures.ts";
import { PLUGIN_ID } from "@/plugin-id";

/**
 * Generates the date-relative task notes into `e2e/vault/Tasks/` before
 * `wdio` launches Obsidian. Run via `tsx` (not plain `node`) so the `@/`
 * path alias into `src/domain` resolves the same way it does for the specs
 * (see `e2e/tsconfig.json`) — `pnpm test:e2e` wires this in ahead of `wdio run`.
 *
 * `e2e/vault/Tasks/` is gitignored: every note here is regenerated fresh
 * (relative to "now") on every e2e run, never checked in.
 *
 * Idempotent: a file already holding the exact content it should have is
 * left untouched (mtime included) instead of rewritten — running this twice
 * on the same day (the common case for a local `pnpm test:e2e` re-run) does
 * no I/O beyond the directory listing and reads, so this step stays instant.
 */

const vaultDir = fileURLToPath(new URL("./vault/", import.meta.url));
const tasksDir = join(fileURLToPath(new URL("./vault/Tasks/", import.meta.url)));
const pluginDataPath = join(fileURLToPath(new URL("./vault/.obsidian/plugins/", import.meta.url)), PLUGIN_ID, "data.json");
const verbose = process.env["E2E_VERBOSE"] === "1";

/**
 * Pre-seeds the plugin's persisted settings (`src/domain/settings.ts`) in
 * the sandbox vault so `main.ts`'s one-time task-panel auto-open has
 * already "used up" its first-open on every e2e run — otherwise the right
 * sidebar would pop open on launch and perturb specs/screenshots that don't
 * expect it. wdio-obsidian-service's local-plugin install only overwrites
 * this vault's `data.json` when *this repo's own* (gitignored, dev-only)
 * root `data.json` exists (it normally doesn't), so writing it here is
 * enough — it isn't clobbered by the plugin install step.
 *
 * Only `taskPanelIntroduced` is set; every other field falls back to its
 * default via `parseSettings`, so this stays correct as the settings shape
 * evolves. `e2e/vault/.obsidian/plugins/` is gitignored (same blanket
 * `data.json` rule as the repo root) and regenerated here on every run, so
 * nothing plugin-settings-related needs to be checked in.
 */
async function writePluginData(): Promise<boolean> {
	const desired = `${JSON.stringify({ taskPanelIntroduced: true }, undefined, "\t")}\n`;
	const current = await readFile(pluginDataPath, "utf8").catch(() => undefined);
	if (current === desired) {
		return false;
	}
	await mkdir(join(pluginDataPath, ".."), { recursive: true });
	await writeFile(pluginDataPath, desired, "utf8");
	return true;
}

/**
 * Vault-root fixtures (outside `Tasks/`) that e2e "Actions" specs create
 * during a run (`e2e/specs/views.e2e.ts`'s convert-note-to-task test,
 * `e2e/specs/task-panel.e2e.ts`'s non-task-note test) and mutate in place —
 * unlike `Tasks/`, nothing here is desired at rest, so every run starts by
 * deleting them rather than diffing content.
 */
const staleVaultRootFiles = ["Plain.md", "Task panel plain note.md"];

async function main(): Promise<void> {
	await mkdir(tasksDir, { recursive: true });

	const pluginDataWritten = await writePluginData();

	await Promise.all(staleVaultRootFiles.map((name) => rm(join(vaultDir, name), { force: true })));

	const fixtures = buildFixtures();

	const desired = new Map<string, string>();
	for (const task of fixtures.tasks) {
		desired.set(task.filename, noteContent(task.frontmatter, task.body));
	}
	desired.set(fixtures.invalid.filename, noteContent(fixtures.invalid.frontmatter, fixtures.invalid.body));
	// The recurring fixture is mutated in place by the "Complete recurring
	// task" e2e test (status/completed change, a next-occurrence note is
	// spawned alongside it) — including it in `desired` means the diff below
	// rewrites it back to its pristine state whenever a previous run left it
	// mutated, and the stray-file sweep removes any spawned occurrence note
	// (e.g. "Recurring task 2026-09-05.md") since only the exact fixture
	// filenames below are kept.
	desired.set(fixtures.recurring.filename, noteContent(fixtures.recurring.frontmatter, fixtures.recurring.body));

	const existingFiles = await readdir(tasksDir);
	// Stray files not in this run's desired set (e.g. leftovers from a
	// previous day's date-relative filenames, or a previous e2e run's
	// spawned/created notes) get removed; matching files are checked below
	// and only rewritten if their content actually changed.
	await Promise.all(
		existingFiles.filter((name) => !desired.has(name)).map((name) => rm(join(tasksDir, name), { force: true })),
	);

	let writtenCount = 0;
	await Promise.all(
		Array.from(desired, async ([filename, content]) => {
			const target = join(tasksDir, filename);
			const current = await readFile(target, "utf8").catch(() => undefined);
			if (current !== content) {
				await writeFile(target, content, "utf8");
				writtenCount += 1;
			}
		}),
	);

	console.log(
		`[generate-fixtures] today=${fixtures.today} wrote ${String(writtenCount)}/${String(desired.size)} note(s) (rest unchanged) to ${tasksDir}; plugin data.json ${pluginDataWritten ? "written" : "unchanged"}`,
	);
	if (verbose) {
		for (const task of fixtures.tasks) {
			console.log(`  - ${task.filename} (due=${task.frontmatter["due"] ?? "none"}, bucket=${task.bucket})`);
		}
		console.log(
			`  - ${fixtures.invalid.filename} (status=${fixtures.invalid.frontmatter["status"] ?? ""}, due=${fixtures.invalid.frontmatter["due"] ?? ""}, invalid on purpose)`,
		);
	}
}

await main();
