import { homedir } from "node:os";
import { resolve } from "node:path";

import QuietReporter from "./e2e/quiet-reporter.ts";

/**
 * WebdriverIO + wdio-obsidian-service config: launches a real (non-headless
 * — Obsidian doesn't support headless) Obsidian window against the fixture
 * vault in `e2e/vault/`, with this plugin installed from the repo root.
 *
 * `pnpm test:e2e` builds the plugin, regenerates the date-relative fixture
 * notes (`e2e/generate-fixtures.mts`), then runs this config. The service
 * copies `e2e/vault/` into a temporary sandbox per run, so nothing here ever
 * mutates the checked-in vault.
 *
 * Output is quiet by default (`e2e/quiet-reporter.ts`, `logLevel: "silent"`)
 * since this is most often read by an AI agent that pays per token. Set
 * `E2E_VERBOSE=1` (or run `pnpm test:e2e:verbose`) for the full spec
 * reporter and wdio/service/Obsidian logging when debugging locally.
 */
const verbose = process.env["E2E_VERBOSE"] === "1";
const docsShots = process.env["E2E_DOCS_SHOTS"] === "1";

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",

	specs: ["./e2e/specs/**/*.e2e.ts"],
	// Excluded, not skipped inside the spec: every spec file boots its own Obsidian window.
	exclude: docsShots ? [] : ["./e2e/specs/docs-screenshots.e2e.ts"],

	maxInstances: 1,

	capabilities: [
		{
			browserName: "obsidian",
			"wdio:obsidianOptions": {
				// Latest stable Obsidian app + installer, per the maintainer's
				// e2e requirements — not pinned to manifest.json's minAppVersion.
				appVersion: "latest",
				installerVersion: "latest",
				plugins: ["."],
				vault: "e2e/vault",
			},
		},
	],

	services: ["obsidian"],
	reporters: verbose ? ["obsidian"] : [[QuietReporter, {}]],

	mochaOpts: {
		ui: "bdd",
		timeout: 120 * 1000,
		// Targeted debugging: E2E_GREP runs only tests whose full name
		// matches (mocha grep, substring or /regex/). Combine with wdio's
		// own `--spec <substring>` to skip whole spec files — each spec
		// file boots its own Obsidian window, so a debug loop on one test
		// should pass both, e.g.:
		//   E2E_GREP="drags a timed" pnpm test:e2e --spec views
		...(process.env["E2E_GREP"] === undefined ? {} : { grep: process.env["E2E_GREP"] }),
	},

	waitforInterval: 250,
	waitforTimeout: 10 * 1000,
	// "silent" by default (see the module doc above); "info" under
	// E2E_VERBOSE=1 shows wdio/service/Obsidian launch and command logs.
	logLevel: verbose ? "info" : "silent",

	// Shared across every checkout/worktree of this repo — the cache holds
	// downloaded Obsidian app/installer versions (~600MB), which would
	// otherwise be re-downloaded per worktree. Safe to share: versions are
	// written once and then only read. `OBSIDIAN_CACHE` overrides (CI, or a
	// deliberate per-checkout cache).
	cacheDir: process.env["OBSIDIAN_CACHE"] ?? resolve(homedir(), ".cache", "isotask", "obsidian-cache"),
};
