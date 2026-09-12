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

/** One write `VaultTaskStore` remembers, to serve reads until the metadata cache catches up. */
export interface RecentWrite {
	readonly frontmatter: Record<string, unknown>;
	readonly at: number;
}

/** Records a write and drops any entry older than `ttl`, keyed by path — mutates `writes` in place. */
export function rememberWrite(
	writes: Map<string, RecentWrite>,
	path: string,
	frontmatter: Record<string, unknown>,
	now: number,
	ttl: number,
): void {
	for (const [key, entry] of writes) {
		if (now - entry.at > ttl) {
			writes.delete(key);
		}
	}
	writes.set(path, { frontmatter: { ...frontmatter }, at: now });
}

/** The overlaid frontmatter for `path` if its write is still within `ttl`, else `undefined`. */
export function recentWrite(
	writes: ReadonlyMap<string, RecentWrite>,
	path: string,
	now: number,
	ttl: number,
): Record<string, unknown> | undefined {
	const entry = writes.get(path);
	return entry !== undefined && now - entry.at <= ttl ? entry.frontmatter : undefined;
}

/** Once the cache has *any* frontmatter for a path, it has re-indexed past the pre-write snapshot the overlay was masking — safe to stop overriding it. */
export function shouldDropOverlayEntry(cacheFrontmatter: Record<string, unknown> | undefined): boolean {
	return cacheFrontmatter !== undefined;
}

/** Recent write wins over a stale-but-still-defined cache entry; only an expired overlay falls back to the cache. */
export function lookupFrontmatter(
	cacheFrontmatter: Record<string, unknown> | undefined,
	writes: ReadonlyMap<string, RecentWrite>,
	path: string,
	now: number,
	ttl: number,
): Record<string, unknown> | undefined {
	return recentWrite(writes, path, now, ttl) ?? cacheFrontmatter;
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
