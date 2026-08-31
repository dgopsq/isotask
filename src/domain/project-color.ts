import { cssClass } from "@/plugin-id";

/**
 * Project color resolution — pure domain logic mapping a project note's own
 * `color` frontmatter value (or its absence) to a `DotColor`, the thing
 * every card surface (feed row leading dot, calendar month dot/due-ring,
 * time-grid pill) ultimately keys its `--obtask-dot-color` custom property
 * off of. The shell (`adapters/obsidian/project-color-lookup.ts`) is what
 * actually reads a project note's frontmatter; this module never touches
 * the filesystem, the metadata cache, or the DOM — `resolveDotColor` takes
 * the raw frontmatter value as a plain `unknown` input.
 */

/** The eight palette names a project's `color` frontmatter can name, mapped 1:1 to Obsidian's `--color-*` theme variables (`styles/obtask.css`). */
export const PALETTE = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;

export type PaletteName = (typeof PALETTE)[number];

/** A project's resolved color: either one of the 8 named palette entries or a validated hex string (always lowercase, `#rgb` or `#rrggbb`). */
export type ProjectColor =
	| { readonly kind: "palette"; readonly name: PaletteName }
	| { readonly kind: "hex"; readonly value: string };

/**
 * What a card's dot/bar ultimately renders. Either the resolved color of
 * the task's project (`ProjectColor`), or `neutral` — a task with no
 * project at all, which falls back to `var(--text-faint)` wherever
 * `--obtask-dot-color` is consumed (`styles/calendar.css`,
 * `styles/obtask.css`) rather than getting a class at all.
 */
export type DotColor = ProjectColor | { readonly kind: "neutral" };

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;

/**
 * Parses a project note's raw `color` frontmatter value. Strings only —
 * anything else (a number, a boolean, an array, `null`/`undefined`) is
 * rejected outright, since `getFileCache(...)?.frontmatter?.["color"]` can
 * hand back any YAML scalar. Accepts, case- and whitespace-insensitively:
 *
 * - one of the 8 `PALETTE` names, or
 * - a `#rgb`/`#rrggbb` hex string, normalised to lowercase.
 *
 * Anything else — an empty/blank string, an unrecognised word, a malformed
 * hex (`#gg0000`, `#12345`) — returns `undefined`, so the caller
 * (`resolveDotColor`) falls back to the hashed palette color instead of
 * silently rendering a bad value.
 */
export function parseProjectColor(raw: unknown): ProjectColor | undefined {
	if (typeof raw !== "string") {
		return undefined;
	}
	const candidate = raw.trim().toLowerCase();
	if (candidate.length === 0) {
		return undefined;
	}
	if ((PALETTE as readonly string[]).includes(candidate)) {
		return { kind: "palette", name: candidate as PaletteName };
	}
	if (HEX_COLOR_RE.test(candidate)) {
		return { kind: "hex", value: candidate };
	}
	return undefined;
}

/**
 * Stable, deterministic hash of a project name onto one of the 8 palette
 * entries — gives every project a consistent color even when its note sets
 * no `color` (or an invalid one). Plain djb2a: `hash = (hash * 33) ^ code`
 * over UTF-16 code units, seeded at 5381, folded to an unsigned 32-bit int
 * and reduced mod 8.
 *
 * FROZEN: this algorithm is part of the plugin's user-visible behaviour —
 * it's what decides the color a project's dot renders with no explicit
 * `color` set. Changing it would silently recolor every such project in
 * every vault. Locked in by the exact-output assertions in
 * `project-color.test.ts`; treat a change here as a user-visible,
 * changelog-worthy decision, never a casual refactor.
 */
export function hashPaletteColor(projectName: string): PaletteName {
	let hash = 5381;
	for (let i = 0; i < projectName.length; i += 1) {
		hash = (hash * 33) ^ projectName.charCodeAt(i);
	}
	const index = (hash >>> 0) % PALETTE.length;
	return PALETTE[index] ?? PALETTE[0];
}

/**
 * `rawColor` (a project note's raw `color` frontmatter value, or
 * `undefined`/anything if there is no project note to read) + `project`
 * (the task's own `project` frontmatter, or `undefined`) -> the `DotColor`
 * the task's card should render with:
 *
 * - no project at all -> `neutral`.
 * - a project whose `color` parses successfully -> that `ProjectColor`.
 * - a project with no/invalid `color` -> the hashed palette color for its
 *   name (`hashPaletteColor`), so every project still gets a consistent,
 *   distinguishable dot.
 */
export function resolveDotColor(rawColor: unknown, project: string | undefined): DotColor {
	if (project === undefined) {
		return { kind: "neutral" };
	}
	const parsed = parseProjectColor(rawColor);
	if (parsed !== undefined) {
		return parsed;
	}
	return { kind: "palette", name: hashPaletteColor(project) };
}

/** CSS class suffix for a palette color, e.g. `"color-red"` — callers prefix it (`cssClass(paletteColorClass("red"))` -> `"obtask-color-red"`), mirroring `task.ts#priorityChipClass`. One class per `PaletteName` so `styles/obtask.css` can map each to a `--color-*` theme variable. */
export function paletteColorClass(name: PaletteName): string {
	return `color-${name}`;
}

/**
 * `DotColor` -> the (already `cssClass`-prefixed) CSS classes it maps to,
 * ready to add straight to an element's class list or an Event Calendar
 * `classNames` array. `palette` -> one `obtask-color-<name>` class
 * (`styles/obtask.css`'s 8-entry mapping to `--color-*`); `hex` and
 * `neutral` both map to no classes at all.
 *
 * `hex` has no class of its own — and, unlike palette, there is no
 * shared/static rule it could name ahead of time: a hex value is
 * arbitrary and only known at render time, one per project. Obsidian's
 * plugin guidelines forbid a plugin dynamically creating/attaching its own
 * `<style>`/`<link>` elements (`eslint-plugin-obsidianmd`'s
 * `no-forbidden-elements` — all plugin CSS must come from the static,
 * built-in `styles.css`), which rules out registering a rule for it at
 * runtime the way `paletteColorClass` classes are pre-declared. Instead,
 * a `hex` `DotColor` is applied directly as a scoped `--obtask-dot-color`
 * custom property on the specific element/event that needs it — the feed
 * (`views/bases/feed/feed-view.ts#renderDot`, via Obsidian's own
 * `setCssProps`) and the calendar (`event-calendar-mapping.ts`'s
 * `extendedProps.hexDotColor`, applied by
 * `event-calendar-renderer.ts`'s `eventDidMount` via the same
 * `setCssProps`) each do this themselves, since only they hold the actual
 * DOM element by the time it exists.
 */
export function dotColorClasses(dotColor: DotColor): readonly string[] {
	switch (dotColor.kind) {
		case "palette":
			return [cssClass(paletteColorClass(dotColor.name))];
		case "hex":
		case "neutral":
			return [];
		default: {
			const exhaustive: never = dotColor;
			return exhaustive;
		}
	}
}

/**
 * Inverse of `parseProjectColor`: a `ProjectColor` -> the string a project
 * note's `color` frontmatter should hold for it — a palette name, or the
 * already-normalised (lowercase) hex value. Used by
 * `ui/project-color-modal.ts` when writing a palette pick or a validated
 * custom-hex value back through `processFrontMatter`.
 */
export function serializeProjectColor(color: ProjectColor): string {
	switch (color.kind) {
		case "palette":
			return color.name;
		case "hex":
			return color.value;
		default: {
			const exhaustive: never = color;
			return exhaustive;
		}
	}
}
