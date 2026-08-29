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
	"**/adapters/**",
	"**/views/**",
	"**/ui/**",
	"**/settings/**",
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
		files: ["**/*.ts"],
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
								"Only src/views, src/ui, src/settings, src/adapters/obsidian and src/main.ts may import obsidian.",
						},
						{
							name: "electron",
							message:
								"Only src/views, src/ui, src/settings, src/adapters/obsidian and src/main.ts may import electron.",
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
								"src/domain, src/ports and src/app must not import from adapters/views/ui/settings.",
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
								"Only src/views, src/ui, src/settings, src/adapters/obsidian and src/main.ts may import obsidian.",
						},
						{
							name: "electron",
							message:
								"Only src/views, src/ui, src/settings, src/adapters/obsidian and src/main.ts may import electron.",
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
