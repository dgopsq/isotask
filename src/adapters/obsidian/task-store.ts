import type { App } from "obsidian";
import { getFrontMatterInfo, normalizePath } from "obsidian";

import { applyFrontmatterPatch, extractBody, setAllFrontmatterValues } from "@/adapters/obsidian/task-store-helpers";
import type { FrontmatterPatch, FrontmatterValue } from "@/domain/frontmatter";
import { isTaskNote, parseTask } from "@/domain/frontmatter";
import type { PropertyKeys } from "@/domain/property-keys";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import type { Task, TaskPath } from "@/domain/task";
import type { NewTaskFile, TaskStore, TaskStoreError } from "@/ports/task-store";

export interface VaultTaskStoreDeps {
	readonly app: App;
	readonly getPropertyKeys: () => PropertyKeys;
	readonly getStatuses: () => readonly StatusConfig[];
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * `TaskStore` over Vault + MetadataCache + `fileManager.processFrontMatter`
 * (`docs/ARCHITECTURE.md#ports`). Frontmatter is read from the metadata
 * cache (never by re-parsing the file body) and written only through
 * `processFrontMatter`, per `AGENTS.md`'s Obsidian guideline rules.
 */
export class VaultTaskStore implements TaskStore {
	private readonly deps: VaultTaskStoreDeps;

	constructor(deps: VaultTaskStoreDeps) {
		this.deps = deps;
	}

	async read(path: TaskPath): Promise<Result<Task, TaskStoreError>> {
		const file = this.deps.app.vault.getFileByPath(normalizePath(path));
		if (file === null) {
			return err({ kind: "not-found", path });
		}

		const raw = this.deps.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const result = parseTask(path, file.basename, raw, this.deps.getPropertyKeys(), this.deps.getStatuses());
		return result.ok ? ok(result.value) : err({ kind: "invalid-task", path, errors: result.error });
	}

	async list(): Promise<readonly Task[]> {
		const keys = this.deps.getPropertyKeys();
		const statuses = this.deps.getStatuses();
		const tasks: Task[] = [];
		for (const file of this.deps.app.vault.getMarkdownFiles()) {
			const raw = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
			if (raw === undefined || !isTaskNote(raw, keys)) {
				continue;
			}
			const result = parseTask(file.path as TaskPath, file.basename, raw, keys, statuses);
			if (result.ok) {
				tasks.push(result.value);
			}
		}
		return tasks;
	}

	async updateProperties(path: TaskPath, patch: FrontmatterPatch): Promise<Result<void, TaskStoreError>> {
		const file = this.deps.app.vault.getFileByPath(normalizePath(path));
		if (file === null) {
			return err({ kind: "not-found", path });
		}

		try {
			await this.deps.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				applyFrontmatterPatch(frontmatter, patch);
			});
			return ok(undefined);
		} catch (error) {
			return err({ kind: "io-error", path, message: describeError(error) });
		}
	}

	async create(draft: NewTaskFile): Promise<Result<TaskPath, TaskStoreError>> {
		const folderPath = normalizePath(draft.folder);
		if (this.deps.app.vault.getFolderByPath(folderPath) === null) {
			await this.deps.app.vault.createFolder(folderPath);
		}

		const path = normalizePath(`${folderPath}/${draft.basename}.md`) as TaskPath;
		if (this.deps.app.vault.getFileByPath(path) !== null) {
			return err({ kind: "already-exists", path });
		}

		try {
			// Obsidian owns YAML serialisation: create the note empty, then let
			// `processFrontMatter` write the keys, then append the body.
			const file = await this.deps.app.vault.create(path, "");
			await this.deps.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				setAllFrontmatterValues(frontmatter, draft.frontmatter);
			});
			if (draft.body.length > 0) {
				await this.deps.app.vault.process(file, (data) => data + draft.body);
			}
			return ok(path);
		} catch (error) {
			return err({ kind: "io-error", path, message: describeError(error) });
		}
	}

	async exists(path: TaskPath): Promise<boolean> {
		return this.deps.app.vault.getFileByPath(normalizePath(path)) !== null;
	}

	async readBody(path: TaskPath): Promise<Result<string, TaskStoreError>> {
		const file = this.deps.app.vault.getFileByPath(normalizePath(path));
		if (file === null) {
			return err({ kind: "not-found", path });
		}

		try {
			const content = await this.deps.app.vault.cachedRead(file);
			const info = getFrontMatterInfo(content);
			return ok(extractBody(content, info.exists, info.contentStart));
		} catch (error) {
			return err({ kind: "io-error", path, message: describeError(error) });
		}
	}

	async rawFrontmatter(path: TaskPath): Promise<Result<Readonly<Record<string, FrontmatterValue>>, TaskStoreError>> {
		const file = this.deps.app.vault.getFileByPath(normalizePath(path));
		if (file === null) {
			return err({ kind: "not-found", path });
		}

		const raw = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
		if (raw === undefined) {
			return err({ kind: "invalid-task", path, errors: [{ kind: "not-a-task" }] });
		}
		return ok(raw as Readonly<Record<string, FrontmatterValue>>);
	}
}
