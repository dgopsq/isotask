import type { IsoDate, IsoDateTime } from "@/domain/dates";
import type { FrontmatterPatch, FrontmatterValue } from "@/domain/frontmatter";
import { isTaskNote, parseTask } from "@/domain/frontmatter";
import type { PropertyKeys } from "@/domain/property-keys";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import type { Task, TaskPath } from "@/domain/task";
import type { Clock } from "@/ports/clock";
import type { Notifier } from "@/ports/notifier";
import type { NewTaskFile, TaskStore, TaskStoreError } from "@/ports/task-store";

interface FakeNote {
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
}

export interface FakeTaskStoreOptions {
	readonly keys: PropertyKeys;
	readonly statuses: readonly StatusConfig[];
}

function basenameOf(path: TaskPath): string {
	const withoutExt = path.endsWith(".md") ? path.slice(0, -3) : path;
	const separatorIndex = withoutExt.lastIndexOf("/");
	return separatorIndex === -1 ? withoutExt : withoutExt.slice(separatorIndex + 1);
}

function pathOf(folder: string, basename: string): TaskPath {
	return (folder.length === 0 ? `${basename}.md` : `${folder}/${basename}.md`) as TaskPath;
}

/**
 * In-memory `TaskStore` for `app/` use-case tests: a `Map<TaskPath, { frontmatter, body }>`,
 * backing every port method with the same `domain/frontmatter.ts` parser the real
 * `VaultTaskStore` uses (so tests exercise the real parse/validate path, not a stub).
 */
export class FakeTaskStore implements TaskStore {
	readonly notes = new Map<TaskPath, FakeNote>();
	private readonly keys: PropertyKeys;
	private readonly statuses: readonly StatusConfig[];

	constructor(options: FakeTaskStoreOptions) {
		this.keys = options.keys;
		this.statuses = options.statuses;
	}

	/** Test setup helper: seeds a note directly, bypassing `create`. */
	seed(path: TaskPath, frontmatter: Readonly<Record<string, FrontmatterValue>>, body = ""): void {
		this.notes.set(path, { frontmatter: { ...frontmatter }, body });
	}

	read = async (path: TaskPath): Promise<Result<Task, TaskStoreError>> => {
		const note = this.notes.get(path);
		if (note === undefined) {
			return err({ kind: "not-found", path });
		}
		const result = parseTask(path, basenameOf(path), note.frontmatter, this.keys, this.statuses);
		return result.ok ? ok(result.value) : err({ kind: "invalid-task", path, errors: result.error });
	};

	list = async (): Promise<readonly Task[]> => {
		const tasks: Task[] = [];
		for (const [path, note] of this.notes) {
			if (!isTaskNote(note.frontmatter, this.keys)) {
				continue;
			}
			const result = parseTask(path, basenameOf(path), note.frontmatter, this.keys, this.statuses);
			if (result.ok) {
				tasks.push(result.value);
			}
		}
		return tasks;
	};

	updateProperties = async (path: TaskPath, patch: FrontmatterPatch): Promise<Result<void, TaskStoreError>> => {
		const note = this.notes.get(path);
		if (note === undefined) {
			return err({ kind: "not-found", path });
		}
		for (const [key, value] of Object.entries(patch)) {
			if (value === null) {
				Reflect.deleteProperty(note.frontmatter, key);
			} else {
				note.frontmatter[key] = value;
			}
		}
		return ok(undefined);
	};

	create = async (draft: NewTaskFile): Promise<Result<TaskPath, TaskStoreError>> => {
		const path = pathOf(draft.folder, draft.basename);
		if (this.notes.has(path)) {
			return err({ kind: "already-exists", path });
		}
		this.notes.set(path, { frontmatter: { ...draft.frontmatter }, body: draft.body });
		return ok(path);
	};

	exists = async (path: TaskPath): Promise<boolean> => this.notes.has(path);

	readBody = async (path: TaskPath): Promise<Result<string, TaskStoreError>> => {
		const note = this.notes.get(path);
		if (note === undefined) {
			return err({ kind: "not-found", path });
		}
		return ok(note.body);
	};

	rawFrontmatter = async (path: TaskPath): Promise<Result<Readonly<Record<string, FrontmatterValue>>, TaskStoreError>> => {
		const note = this.notes.get(path);
		if (note === undefined) {
			return err({ kind: "not-found", path });
		}
		return ok(note.frontmatter);
	};
}

/** Fixed-time `Clock` fake, mutable via `set` for tests that need `now`/`today` to change mid-test. */
export class FakeClock implements Clock {
	private currentNow: IsoDateTime;
	private currentToday: IsoDate;

	constructor(now: IsoDateTime, today: IsoDate) {
		this.currentNow = now;
		this.currentToday = today;
	}

	now = (): IsoDateTime => this.currentNow;
	today = (): IsoDate => this.currentToday;

	set(now: IsoDateTime, today: IsoDate): void {
		this.currentNow = now;
		this.currentToday = today;
	}
}

/** Records every `info`/`error` call instead of showing a real `Notice`. */
export class FakeNotifier implements Notifier {
	readonly infoMessages: string[] = [];
	readonly errorMessages: string[] = [];

	info = (message: string): void => {
		this.infoMessages.push(message);
	};

	error = (message: string): void => {
		this.errorMessages.push(message);
	};
}
