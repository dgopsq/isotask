import type { FrontmatterPatch, FrontmatterValue } from "@/domain/frontmatter";

/**
 * Pure helpers backing `adapters/obsidian/task-store.ts`. Kept free of the
 * `obsidian` import so they can be unit-tested with plain objects — the
 * adapter itself is thin and untestable under vitest (Obsidian isn't
 * importable there).
 */

/**
 * Applies a frontmatter patch to a plain object in place: `null` deletes the
 * key, any other value sets it. Keys absent from the patch are left
 * untouched. Mirrors the callback shape `Vault.FileManager.processFrontMatter`
 * expects.
 */
export function applyFrontmatterPatch(frontmatter: Record<string, unknown>, patch: FrontmatterPatch): void {
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) {
			Reflect.deleteProperty(frontmatter, key);
		} else {
			frontmatter[key] = value;
		}
	}
}

/**
 * Sets every key of `values` on a plain object in place, including literal
 * `null` values (unlike `applyFrontmatterPatch`, nothing here means
 * "delete"). Used to seed a freshly created note's frontmatter, where every
 * key is being set for the first time rather than patched.
 */
export function setAllFrontmatterValues(
	frontmatter: Record<string, unknown>,
	values: Readonly<Record<string, FrontmatterValue>>,
): void {
	for (const [key, value] of Object.entries(values)) {
		frontmatter[key] = value;
	}
}

/**
 * Extracts a note's body (everything after the frontmatter block) given the
 * full file content and the frontmatter offsets from Obsidian's
 * `getFrontMatterInfo`. Takes the two fields it needs as primitives rather
 * than importing `FrontMatterInfo` from `obsidian`, so this module stays
 * Obsidian-free.
 */
export function extractBody(content: string, hasFrontmatter: boolean, contentStart: number): string {
	return hasFrontmatter ? content.slice(contentStart) : content;
}
