import type { FrontmatterPatch, FrontmatterValue } from "@/domain/frontmatter";
import type { Result } from "@/domain/result";
import type { Task, TaskParseError, TaskPath } from "@/domain/task";

export type TaskStoreError =
	| { readonly kind: "not-found"; readonly path: TaskPath }
	| { readonly kind: "invalid-task"; readonly path: TaskPath; readonly errors: readonly TaskParseError[] }
	| { readonly kind: "already-exists"; readonly path: TaskPath }
	| { readonly kind: "io-error"; readonly path: TaskPath; readonly message: string };

/** Input for creating a new task note: folder + basename (no extension) + full frontmatter + body. */
export interface NewTaskFile {
	readonly folder: string;
	readonly basename: string;
	readonly frontmatter: Record<string, FrontmatterValue>;
	readonly body: string;
}

/** All task persistence. Implemented by `adapters/obsidian/task-store.ts` over Vault/MetadataCache/`processFrontMatter`. */
export interface TaskStore {
	/** Reads and parses a single task note (via `domain/frontmatter.ts`). */
	readonly read: (path: TaskPath) => Promise<Result<Task, TaskStoreError>>;
	/** Applies a frontmatter patch via `processFrontMatter` (`null` removes a key). */
	readonly updateProperties: (path: TaskPath, patch: FrontmatterPatch) => Promise<Result<void, TaskStoreError>>;
	/** Creates a new task note; fails idempotently if the target path already exists. */
	readonly create: (draft: NewTaskFile) => Promise<Result<TaskPath, TaskStoreError>>;
	readonly exists: (path: TaskPath) => Promise<boolean>;
	/** The note's body, excluding the frontmatter block. */
	readonly readBody: (path: TaskPath) => Promise<Result<string, TaskStoreError>>;
	/** The note's frontmatter exactly as stored, for callers (e.g. transitions) that need to copy properties verbatim. */
	readonly rawFrontmatter: (path: TaskPath) => Promise<Result<Readonly<Record<string, FrontmatterValue>>, TaskStoreError>>;
	/** Frontmatter as currently known without I/O: the store's own unexpired write, else the metadata cache, else `undefined`. */
	readonly peekFrontmatter: (path: TaskPath) => Readonly<Record<string, FrontmatterValue>> | undefined;
}
