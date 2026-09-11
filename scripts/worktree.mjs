#!/usr/bin/env node
/**
 * Worktree helper — one command per task branch, optimized for cheap
 * parallel checkouts:
 *
 *   pnpm wt <branch>      create ../<repo>.worktrees/<branch> (branched off
 *                         main if new) and install dependencies there —
 *                         seconds, since pnpm hardlinks from its global
 *                         content-addressable store (no duplicate packages
 *                         on disk) and the Obsidian e2e cache is shared via
 *                         `wdio.conf.mts` (`~/.cache/isotask/obsidian-cache`).
 *   pnpm wt rm <branch>   remove that worktree (the branch survives).
 *   pnpm wt list          list all worktrees.
 *
 * Worktrees live OUTSIDE the repo (sibling `<repo>.worktrees/` directory) so
 * they never show up as untracked files, and a branch's slashes become
 * dashes in the directory name (feat/x -> feat-x).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

function out(cmd, args) {
	return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function run(cmd, args, cwd) {
	execFileSync(cmd, args, { stdio: "inherit", ...(cwd === undefined ? {} : { cwd }) });
}

// `--git-common-dir` points at the PRIMARY checkout's .git even when this
// script runs inside a worktree, so `pnpm wt` behaves identically anywhere.
const mainRoot = resolve(out("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "..");
const wtBase = resolve(mainRoot, "..", `${basename(mainRoot)}.worktrees`);

const argv = process.argv.slice(2);
const usage = "usage: pnpm wt <branch> | pnpm wt rm <branch> | pnpm wt list";

function dirFor(branch) {
	return resolve(wtBase, branch.replaceAll("/", "-"));
}

if (argv[0] === "list") {
	run("git", ["worktree", "list"]);
} else if (argv[0] === "rm") {
	const branch = argv[1];
	if (branch === undefined) {
		console.error(usage);
		process.exit(1);
	}
	run("git", ["worktree", "remove", dirFor(branch)]);
	console.log(`removed ${dirFor(branch)} (branch "${branch}" kept — delete with: git branch -d ${branch})`);
} else if (argv[0] !== undefined && !argv[0].startsWith("-")) {
	const branch = argv[0];
	const dir = dirFor(branch);
	if (existsSync(dir)) {
		console.error(`${dir} already exists — reuse it, or remove it first with: pnpm wt rm ${branch}`);
		process.exit(1);
	}
	const branchExists = (() => {
		try {
			out("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
			return true;
		} catch {
			return false;
		}
	})();
	if (branchExists) {
		run("git", ["worktree", "add", dir, branch]);
	} else {
		run("git", ["worktree", "add", "-b", branch, dir, "main"]);
	}
	run("pnpm", ["install", "--prefer-offline"], dir);
	console.log(`\nworktree ready: ${dir}`);
	console.log(`when done: push + open a PR (gh pr create), then: pnpm wt rm ${branch}`);
} else {
	console.error(usage);
	process.exit(1);
}
