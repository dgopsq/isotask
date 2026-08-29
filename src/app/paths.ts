import type { TaskPath } from "@/domain/task";

/** A task path split into its containing folder (possibly empty, vault root) and extension-less basename. */
export interface SplitTaskPath {
	readonly folder: string;
	readonly basename: string;
}

/** Splits a `TaskPath` (e.g. `Tasks/Buy milk.md`) into folder + basename, dropping the `.md` extension. */
export function splitTaskPath(path: TaskPath): SplitTaskPath {
	const withoutExt = path.endsWith(".md") ? path.slice(0, -3) : path;
	const separatorIndex = withoutExt.lastIndexOf("/");
	if (separatorIndex === -1) {
		return { folder: "", basename: withoutExt };
	}
	return { folder: withoutExt.slice(0, separatorIndex), basename: withoutExt.slice(separatorIndex + 1) };
}

/** Inverse of `splitTaskPath`: joins a folder (possibly empty) and basename into a `TaskPath`, appending `.md`. */
export function joinTaskPath(folder: string, basename: string): TaskPath {
	const trimmedFolder = folder.trim();
	return (trimmedFolder.length === 0 ? `${basename}.md` : `${trimmedFolder}/${basename}.md`) as TaskPath;
}
