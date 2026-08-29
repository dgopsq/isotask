import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
 *
 * Idempotent: a file already holding the exact content it should have is
 * left untouched (mtime included) instead of rewritten — running this twice
 * on the same day (the common case for a local `pnpm test:e2e` re-run) does
 * no I/O beyond the directory listing and reads, so this step stays instant.
 */

const tasksDir = join(fileURLToPath(new URL("./vault/Tasks/", import.meta.url)));
const verbose = process.env["E2E_VERBOSE"] === "1";

async function main(): Promise<void> {
	await mkdir(tasksDir, { recursive: true });

	const fixtures = buildFixtures();

	const desired = new Map<string, string>();
	for (const task of fixtures.tasks) {
		desired.set(task.filename, noteContent(task.frontmatter, task.body));
	}
	desired.set(fixtures.invalid.filename, noteContent(fixtures.invalid.frontmatter, fixtures.invalid.body));

	const existingFiles = await readdir(tasksDir);
	// Stray files not in this run's desired set (e.g. leftovers from a
	// previous day's date-relative filenames) get removed; matching files
	// are checked below and only rewritten if their content actually changed.
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
		`[generate-fixtures] today=${fixtures.today} wrote ${String(writtenCount)}/${String(desired.size)} note(s) (rest unchanged) to ${tasksDir}`,
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
