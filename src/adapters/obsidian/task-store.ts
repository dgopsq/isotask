import type { App, EventRef, TFile } from "obsidian";
import { getFrontMatterInfo, normalizePath, Notice, parseYaml } from "obsidian";

import {
	applyFrontmatterPatch,
	extractBody,
	frontmatterReflectsPatch,
	setAllFrontmatterValues,
} from "@/adapters/obsidian/task-store-helpers";
import type { FrontmatterPatch, FrontmatterValue } from "@/domain/frontmatter";
import { parseTask } from "@/domain/frontmatter";
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

interface FrontmatterAttempt {
	readonly frontmatter: Record<string, unknown> | undefined;
	readonly cacheDefined: boolean;
	readonly cacheFmDefined: boolean;
	readonly contentLength: number | undefined;
	readonly fmInfoExists: boolean | undefined;
}

/**
 * `TaskStore` over Vault + MetadataCache + `fileManager.processFrontMatter`
 * (`docs/ARCHITECTURE.md#ports`). Frontmatter is written only through
 * `processFrontMatter`, per `AGENTS.md`'s Obsidian guideline rules.
 */
export class VaultTaskStore implements TaskStore {
	private readonly deps: VaultTaskStoreDeps;

	constructor(deps: VaultTaskStoreDeps) {
		this.deps = deps;
	}

	private wait(ms: number): Promise<void> {
		return new Promise((resolve) => {
			window.setTimeout(resolve, ms);
		});
	}

	private async attemptFrontmatterLookup(file: TFile): Promise<FrontmatterAttempt> {
		const cache = this.deps.app.metadataCache.getFileCache(file);
		const cacheFm = cache?.frontmatter;
		if (cacheFm !== undefined) {
			return {
				frontmatter: cacheFm,
				cacheDefined: cache !== null,
				cacheFmDefined: true,
				contentLength: undefined,
				fmInfoExists: undefined,
			};
		}

		const content = await this.deps.app.vault.cachedRead(file);
		const info = getFrontMatterInfo(content);
		const base = { cacheDefined: cache !== null, cacheFmDefined: false, contentLength: content.length, fmInfoExists: info.exists };
		if (!info.exists) {
			return { frontmatter: undefined, ...base };
		}

		try {
			const parsed: unknown = parseYaml(info.frontmatter);
			const frontmatter = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
			return { frontmatter, ...base };
		} catch {
			return { frontmatter: undefined, ...base };
		}
	}

	/** Cache (and even the freshly-read file) can lag right after a write, especially over iCloud sync; retry a few times before giving up. */
	private async frontmatterOf(file: TFile): Promise<Record<string, unknown> | undefined> {
		const maxRetries = 3;
		let currentFile = file;
		let lastAttempt: FrontmatterAttempt | undefined;
		let sameFileAsPrevious = true;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const result = await this.attemptFrontmatterLookup(currentFile);
			lastAttempt = result;
			if (result.frontmatter !== undefined) {
				return result.frontmatter;
			}

			if (attempt === maxRetries) {
				break;
			}

			await this.wait(200);
			const refreshed = this.deps.app.vault.getFileByPath(currentFile.path);
			sameFileAsPrevious = refreshed === currentFile;
			if (refreshed !== null) {
				currentFile = refreshed;
			}
		}

		// TEMP: removed before merge.
		const contentLen = lastAttempt?.contentLength === undefined ? "n/a" : String(lastAttempt.contentLength);
		const fmInfoExists = lastAttempt?.fmInfoExists === undefined ? "n/a" : String(lastAttempt.fmInfoExists);
		new Notice(
			`isotask diag: path=${file.path} cacheFm=${lastAttempt?.cacheFmDefined ? "yes" : "no"} cache=${lastAttempt?.cacheDefined ? "yes" : "no"} contentLen=${contentLen} fmInfoExists=${fmInfoExists} attempts=${String(maxRetries + 1)} sameFile=${sameFileAsPrevious ? "yes" : "no"}`,
			10000,
		);
		return undefined;
	}

	/**
	 * Resolves once the metadata cache reflects a just-written patch, or after `timeoutMs` —
	 * timing out isn't an error, callers proceed regardless (iCloud can stall the "changed" event).
	 */
	private async awaitCacheSettled(file: TFile, patch: FrontmatterPatch, timeoutMs = 2000): Promise<void> {
		const cachedFm = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
		if (frontmatterReflectsPatch(cachedFm, patch)) {
			return;
		}

		return new Promise((resolve) => {
			let settled = false;
			let ref: EventRef | undefined;
			let timer: number | undefined;

			const cleanup = (): void => {
				if (settled) {
					return;
				}
				settled = true;
				if (ref !== undefined) {
					this.deps.app.metadataCache.offref(ref);
				}
				if (timer !== undefined) {
					window.clearTimeout(timer);
				}
				resolve();
			};

			// Compare by path, not reference: iCloud can hand back a new TFile instance for the same file.
			ref = this.deps.app.metadataCache.on("changed", (changedFile) => {
				if (changedFile.path === file.path) {
					cleanup();
				}
			});
			timer = window.setTimeout(cleanup, timeoutMs);
		});
	}

	async read(path: TaskPath): Promise<Result<Task, TaskStoreError>> {
		const file = this.deps.app.vault.getFileByPath(normalizePath(path));
		if (file === null) {
			return err({ kind: "not-found", path });
		}

		const raw = (await this.frontmatterOf(file)) ?? {};
		const result = parseTask(path, file.basename, raw, this.deps.getPropertyKeys(), this.deps.getStatuses());
		return result.ok ? ok(result.value) : err({ kind: "invalid-task", path, errors: result.error });
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
			await this.awaitCacheSettled(file, patch);
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
			await this.awaitCacheSettled(file, draft.frontmatter);
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

		const raw = await this.frontmatterOf(file);
		if (raw === undefined) {
			return err({ kind: "invalid-task", path, errors: [{ kind: "not-a-task" }] });
		}
		return ok(raw as Readonly<Record<string, FrontmatterValue>>);
	}
}
