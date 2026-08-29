import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFixtures, noteContent } from "./fixtures.ts";

/**
 * Generates the date-relative task notes into `e2e/vault/Tasks/` before
 * `wdio` launches Obsidian. Run via `tsx` (not plain `node`) so the `@/`
 * path alias into `src/domain` resolves the same way it does for the specs
 * (see `e2e/tsconfig.json`) — `pnpm test:e2e` wires this in ahead of `wdio run`.
 *
 * `e2e/vault/Tasks/` is gitignored: every note here is regenerated fresh
 * (relative to "now") on every e2e run, never checked in.
 */

const tasksDir = join(fileURLToPath(new URL("./vault/Tasks/", import.meta.url)));

async function main(): Promise<void> {
	await rm(tasksDir, { recursive: true, force: true });
	await mkdir(tasksDir, { recursive: true });

	const fixtures = buildFixtures();

	for (const task of fixtures.tasks) {
		await writeFile(join(tasksDir, task.filename), noteContent(task.frontmatter, task.body), "utf8");
	}
	await writeFile(join(tasksDir, fixtures.invalid.filename), noteContent(fixtures.invalid.frontmatter, fixtures.invalid.body), "utf8");

	const written = await readdir(tasksDir);
	console.log(`[generate-fixtures] today=${fixtures.today} wrote ${String(written.length)} notes to ${tasksDir}:`);
	for (const task of fixtures.tasks) {
		console.log(`  - ${task.filename} (due=${task.frontmatter["due"] ?? "none"}, bucket=${task.bucket})`);
	}
	console.log(`  - ${fixtures.invalid.filename} (status=${fixtures.invalid.frontmatter["status"] ?? ""}, due=${fixtures.invalid.frontmatter["due"] ?? ""}, invalid on purpose)`);
}

await main();
