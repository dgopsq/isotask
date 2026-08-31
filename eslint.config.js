// @ts-check
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

/**
 * Import specifier patterns that reach into layers a "pure" (Obsidian-free)
 * layer must never depend on.
 */
const crossLayerPatterns = [
	"@/adapters/**",
	"@/views/**",
	"@/ui/**",
	"@/settings/**",
	"@/commands/**",
	"**/adapters/**",
	"**/views/**",
	"**/ui/**",
	"**/settings/**",
	"**/commands/**",
];

const htmlInjectionSyntaxRules = [
	{
		selector:
			"AssignmentExpression[left.type='MemberExpression'][left.property.name='innerHTML']",
		message:
			"Do not assign to innerHTML. Use Obsidian DOM helpers (createEl, createDiv, createSpan, ...) or DOM APIs instead.",
	},
	{
		selector:
			"AssignmentExpression[left.type='MemberExpression'][left.property.name='outerHTML']",
		message:
			"Do not assign to outerHTML. Use Obsidian DOM helpers (createEl, createDiv, createSpan, ...) or DOM APIs instead.",
	},
	{
		selector:
			"CallExpression[callee.type='MemberExpression'][callee.property.name='insertAdjacentHTML']",
		message:
			"Do not use insertAdjacentHTML. Use Obsidian DOM helpers (createEl, createDiv, createSpan, ...) or DOM APIs instead.",
	},
];

export default defineConfig([
	{
		ignores: [
			"main.js",
			"styles.css",
			"node_modules/**",
			"esbuild.config.mjs",
			"version-bump.mjs",
			"scripts/**",
			"coverage/**",
		],
	},

	// Type-aware TypeScript rules apply only to .ts sources — scoping them via
	// `extends` (rather than spreading at the top level) keeps plain JS tooling
	// files (this file included) out of the type-checked program.
	{
		files: ["**/*.ts"],
		extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
	},

	...obsidianmd.configs.recommended,

	{
		files: ["**/*.ts", "**/*.mts", "**/*.cts"],
		// e2e/** and wdio.conf.mts get their own `project`-mode block below,
		// pointed explicitly at e2e/tsconfig.json — the project-service's
		// nearest-tsconfig walk resolves e2e/tsconfig.json fine for files
		// under e2e/, but (likely a project-service resolution quirk with
		// this tsconfig's `types` array / package.json `exports` subpaths)
		// produces different — wrong — type info than a plain `tsc -p
		// e2e/tsconfig.json` for a couple of WebdriverIO-typed expressions.
		// Classic `project` mode (same mechanism `tsc -p` uses) matches tsc.
		ignores: ["e2e/**", "wdio.conf.mts"],
		languageOptions: {
			parserOptions: {
				projectService: {
					// vitest.config.ts sits outside tsconfig.json's `include`; give it
					// an ad-hoc single-file program instead of erroring.
					allowDefaultProject: ["vitest.config.ts"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		// See the `ignores` note above.
		files: ["e2e/**/*.ts", "e2e/**/*.mts", "wdio.conf.mts"],
		languageOptions: {
			parserOptions: {
				project: ["./e2e/tsconfig.json"],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	// e2e/ (wdio-obsidian-service specs + fixtures) and wdio.conf.mts run
	// under Node/tsx, not the Obsidian sandbox esbuild bundles for src/ — Node
	// built-ins are expected, and this is glue/test code rather than plugin
	// UI, so the plugin-guideline console restriction doesn't apply.
	{
		files: ["e2e/**/*.ts", "e2e/**/*.mts", "wdio.conf.mts"],
		rules: {
			"no-console": "off",
			// Ambient namespaces such as `WebdriverIO` are type-only; tsc checks them.
			"no-undef": "off",
			"obsidianmd/no-nodejs-modules": "off",
			"obsidianmd/rule-custom-message": "off",
			// This Node script reads/writes the sandbox vault's `.obsidian/`
			// folder directly on disk (there's no running `Vault` instance to
			// ask for `configDir`) — the guideline this rule enforces is about
			// plugin runtime code, which none of e2e/ is.
			"obsidianmd/hardcoded-config-path": "off",
		},
	},
	{
		// `builtin-modules` mirrors the official obsidian-sample-plugin esbuild
		// config (it feeds esbuild's `external` list) and is deliberately kept.
		files: ["package.json"],
		rules: {
			"depend/ban-dependencies": [
				"error",
				{ presets: ["native", "microutilities", "preferred"], allowed: ["builtin-modules"] },
			],
		},
	},

	// --- Layer boundaries -----------------------------------------------
	//
	// Baseline: nothing under src/ may reach into Obsidian, Electron or the
	// calendar UI library. More specific blocks below re-open exactly the
	// door each layer is allowed to walk through.
	{
		files: ["src/**/*.ts"],
		rules: {
			"no-restricted-imports": "off",
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "obsidian",
							message:
								"Only src/views, src/ui, src/settings, src/commands, src/adapters/obsidian and src/main.ts may import obsidian.",
						},
						{
							name: "electron",
							message:
								"Only src/views, src/ui, src/settings, src/commands, src/adapters/obsidian and src/main.ts may import electron.",
						},
					],
					patterns: [
						{
							group: ["@event-calendar/*", "@event-calendar/**"],
							message:
								"Only src/adapters/calendar/** may import @event-calendar/*.",
						},
					],
				},
			],
		},
	},
	// The domain/ports/app core must stay free of Obsidian, Electron, the
	// calendar library, CodeMirror, and any import that reaches into an
	// outer layer (adapters/views/ui/settings).
	{
		files: ["src/domain/**/*.ts", "src/ports/**/*.ts", "src/app/**/*.ts"],
		rules: {
			"no-restricted-imports": "off",
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "obsidian",
							message: "src/domain, src/ports and src/app must stay Obsidian-free.",
						},
						{
							name: "electron",
							message: "src/domain, src/ports and src/app must stay Electron-free.",
						},
					],
					patterns: [
						{
							group: ["@event-calendar/*", "@event-calendar/**"],
							message:
								"src/domain, src/ports and src/app must not depend on the calendar UI library.",
						},
						{
							group: ["@codemirror/*", "@codemirror/**"],
							message: "src/domain, src/ports and src/app must not depend on CodeMirror.",
						},
						{
							group: crossLayerPatterns,
							message:
								"src/domain, src/ports and src/app must not import from adapters/views/ui/settings/commands.",
						},
					],
				},
			],
		},
	},
	// Only the calendar adapter may import @event-calendar/*.
	{
		files: ["src/adapters/calendar/**/*.ts"],
		rules: {
			"no-restricted-imports": "off",
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "obsidian",
							message:
								"Only src/views, src/ui, src/settings, src/commands, src/adapters/obsidian and src/main.ts may import obsidian.",
						},
						{
							name: "electron",
							message:
								"Only src/views, src/ui, src/settings, src/commands, src/adapters/obsidian and src/main.ts may import electron.",
						},
					],
				},
			],
		},
	},
	// The Obsidian-facing shell may use the Obsidian API, but still may not
	// reach into the calendar UI library directly.
	{
		files: [
			"src/views/**/*.ts",
			"src/ui/**/*.ts",
			"src/settings/**/*.ts",
			"src/commands/**/*.ts",
			"src/adapters/obsidian/**/*.ts",
			"src/main.ts",
		],
		rules: {
			"no-restricted-imports": "off",
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["@event-calendar/*", "@event-calendar/**"],
							message:
								"Only src/adapters/calendar/** may import @event-calendar/*.",
						},
					],
				},
			],
		},
	},

	// --- General TypeScript hygiene --------------------------------------
	{
		files: ["**/*.ts", "**/*.tsx"],
		rules: {
			"@typescript-eslint/consistent-type-imports": "error",
			"@typescript-eslint/switch-exhaustiveness-check": "error",
			"@typescript-eslint/no-floating-promises": "error",
			"no-restricted-syntax": ["error", ...htmlInjectionSyntaxRules],
		},
	},
]);
