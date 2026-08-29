import { resolve } from "node:path";

/**
 * WebdriverIO + wdio-obsidian-service config: launches a real (non-headless
 * — Obsidian doesn't support headless) Obsidian window against the fixture
 * vault in `e2e/vault/`, with this plugin installed from the repo root.
 *
 * `pnpm test:e2e` builds the plugin, regenerates the date-relative fixture
 * notes (`e2e/generate-fixtures.mts`), then runs this config. The service
 * copies `e2e/vault/` into a temporary sandbox per run, so nothing here ever
 * mutates the checked-in vault.
 */
export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",

	specs: ["./e2e/specs/**/*.e2e.ts"],

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
	reporters: ["obsidian"],

	mochaOpts: {
		ui: "bdd",
		timeout: 120 * 1000,
	},

	waitforInterval: 250,
	waitforTimeout: 10 * 1000,
	// Keep logs quiet — only warnings/errors from wdio itself, not every
	// browser/driver command.
	logLevel: "warn",

	cacheDir: resolve(".obsidian-cache"),
};
