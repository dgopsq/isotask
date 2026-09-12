import type { App, TFile } from "obsidian";
import { getFrontMatterInfo, normalizePath, Notice, parseYaml } from "obsidian";

import type { RecentWrite } from "@/adapters/obsidian/task-store-helpers";
import {
	applyFrontmatterPatch,
	extractBody,
	lookupFrontmatter,
	rememberWrite,
	setAllFrontmatterValues,
	shouldDropOverlayEntry,
} from "@/adapters/obsidian/task-store-helpers";
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

/** How long a just-written note's frontmatter is served from `recentWrites` before falling back to the cache/file — long enough to bridge an iCloud sync stall. */
const RECENT_WRITE_TTL_MS = 15_000;

/**
 * `TaskStore` over Vault + MetadataCache + `fileManager.processFrontMatter`
 * (`docs/ARCHITECTURE.md#ports`). Frontmatter is written only through
 * `processFrontMatter`, per `AGENTS.md`'s Obsidian guideline rules.
 */
export class VaultTaskStore implements TaskStore {
	private readonly deps: VaultTaskStoreDeps;
	/** Overlay of this store's own recent writes, keyed by path — masks the metadata-cache gap right after a write on iOS/iCloud. See `peekFrontmatter`/`frontmatterOf`. */
	private readonly recentWrites = new Map<string, RecentWrite>();

	constructor(deps: VaultTaskStoreDeps) {
		this.deps = deps;
	}

	/** Frontmatter as currently known without I/O: an unexpired recent write, else the metadata cache, else `undefined`. */
	peekFrontmatter(path: TaskPath): Readonly<Record<string, FrontmatterValue>> | undefined {
		const file = this.deps.app.vault.getFileByPath(normalizePath(path));
		if (file === null) {
			return undefined;
		}
		const cacheFm = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
		return lookupFrontmatter(cacheFm, this.recentWrites, file.path, Date.now(), RECENT_WRITE_TTL_MS) as
			| Readonly<Record<string, FrontmatterValue>>
			| undefined;
	}

	/** Narrows the overlay's masking window: once the cache re-indexes a path at all, trust it over a same-path overlay entry rather than waiting out the full TTL. */
	onCacheChanged(path: string): void {
		const file = this.deps.app.vault.getFileByPath(normalizePath(path));
		if (file === null) {
			return;
		}
		const cacheFm = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
		if (shouldDropOverlayEntry(cacheFm)) {
			this.recentWrites.delete(file.path);
		}
	}

	private async frontmatterOf(file: TFile): Promise<Record<string, unknown> | undefined> {
		const cacheFm = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
		const known = lookupFrontmatter(cacheFm, this.recentWrites, file.path, Date.now(), RECENT_WRITE_TTL_MS);
		if (known !== undefined) {
			return known;
		}

		const content = await this.deps.app.vault.cachedRead(file);
		const info = getFrontMatterInfo(content);
		if (info.exists) {
			try {
				const parsed: unknown = parseYaml(info.frontmatter);
				if (typeof parsed === "object" && parsed !== null) {
					return parsed as Record<string, unknown>;
				}
			} catch {
				// falls through to the diagnostic notice below
			}
		}

		// TEMP: removed before merge.
		new Notice(`isotask diag: path=${file.path} cacheFm=no overlay=no fmInfoExists=${String(info.exists)}`, 10000);
		return undefined;
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

	async list(): Promise<readonly Task[]> {
		const keys = this.deps.getPropertyKeys();
		const statuses = this.deps.getStatuses();
		const tasks: Task[] = [];

		for (const file of this.deps.app.vault.getMarkdownFiles()) {
			const cacheFm = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
			const raw = lookupFrontmatter(cacheFm, this.recentWrites, file.path, Date.now(), RECENT_WRITE_TTL_MS);
			if (raw === undefined || !isTaskNote(raw, keys)) {
				continue;
			}
			const result = parseTask(file.path as TaskPath, file.basename, raw, keys, statuses);
			if (result.ok) {
				tasks.push(result.value);
			}
			// Notes that match the marker but fail to parse are skipped here;
			// `adapters/obsidian/bases-entries.ts` is where they're surfaced as
			// "invalid" rows for the feed view.
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
				rememberWrite(this.recentWrites, file.path, frontmatter, Date.now(), RECENT_WRITE_TTL_MS);
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
				rememberWrite(this.recentWrites, file.path, frontmatter, Date.now(), RECENT_WRITE_TTL_MS);
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

		const raw = await this.frontmatterOf(file);
		if (raw === undefined) {
			return err({ kind: "invalid-task", path, errors: [{ kind: "not-a-task" }] });
		}
		return ok(raw as Readonly<Record<string, FrontmatterValue>>);
	}
}
