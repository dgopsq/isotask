import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import { joinTaskPath } from "@/app/paths";
import type { TaskDate } from "@/domain/dates";
import { toDateOnly } from "@/domain/dates";
import type { FrontmatterValue } from "@/domain/frontmatter";
import { toWikilink } from "@/domain/frontmatter";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import { firstOpenStatus } from "@/domain/status";
import type { Minutes, Priority, RRuleString, TaskPath } from "@/domain/task";

/** Input to `createTask`: everything a new task note's frontmatter can carry. Only `title` is required. A new task always gets the first configured `open` status — there's no way to pick one at creation. */
export interface TaskDraft {
	readonly title: string;
	readonly folder?: string;
	readonly priority?: Priority;
	readonly due?: TaskDate;
	readonly scheduled?: TaskDate;
	readonly duration?: Minutes;
	readonly repeat?: RRuleString;
	readonly project?: string;
	readonly tags?: readonly string[];
}

/** Characters not allowed in an Obsidian filename. */
const INVALID_FILENAME_CHARS_RE = /[\\/:*?"<>|#^[\]]/g;

function sanitizeFilename(name: string): string {
	return name.replace(INVALID_FILENAME_CHARS_RE, "").trim();
}

function expandFilenameTemplate(template: string, title: string, due: TaskDate | undefined): string {
	const dueText = due !== undefined ? toDateOnly(due) : "";
	return template.replaceAll("{{title}}", title).replaceAll("{{due}}", dueText);
}

/** Appends " 2", " 3", ... (Obsidian's own convention) until `store.exists` reports the candidate path is free. */
async function resolveUniqueBasename(deps: AppDeps, folder: string, basename: string): Promise<string> {
	let candidate = basename;
	let suffix = 2;
	let exists = await deps.store.exists(joinTaskPath(folder, candidate));
	while (exists) {
		candidate = `${basename} ${String(suffix)}`;
		suffix += 1;
		exists = await deps.store.exists(joinTaskPath(folder, candidate));
	}
	return candidate;
}

/**
 * Creates a new task note: resolves the target status (always the first
 * configured `open` status — a new task never starts anywhere else),
 * builds frontmatter with only the configured keys that have a value,
 * expands the filename template, and de-duplicates against an existing
 * file the way Obsidian itself does (`" 2"`, `" 3"`, ...).
 */
export function makeCreateTask(deps: AppDeps) {
	return async (draft: TaskDraft): Promise<Result<TaskPath, AppError>> => {
		const settings = deps.settings();
		const keys = settings.propertyKeys;

		const statusResult = firstOpenStatus(settings.statuses);
		if (!statusResult.some) {
			return err({ kind: "no-status-configured" });
		}

		const folder = draft.folder ?? settings.taskFolder;
		const now = deps.clock.now();

		const frontmatter: Record<string, FrontmatterValue> = {
			[keys.markerKey]: keys.markerValue,
			[keys.status]: statusResult.value.id,
			[keys.created]: now,
		};
		if (draft.priority !== undefined) {
			frontmatter[keys.priority] = draft.priority;
		}
		if (draft.due !== undefined) {
			frontmatter[keys.due] = draft.due;
		}
		if (draft.scheduled !== undefined) {
			frontmatter[keys.scheduled] = draft.scheduled;
		}
		if (draft.duration !== undefined) {
			frontmatter[keys.duration] = draft.duration;
		}
		if (draft.repeat !== undefined) {
			frontmatter[keys.repeat] = draft.repeat;
		}
		if (draft.project !== undefined) {
			frontmatter[keys.project] = toWikilink(draft.project);
		}
		if (draft.tags !== undefined && draft.tags.length > 0) {
			frontmatter[keys.tags] = draft.tags;
		}

		const templatedBasename = sanitizeFilename(expandFilenameTemplate(settings.newTaskFilenameTemplate, draft.title, draft.due));
		const basename = templatedBasename.length === 0 ? sanitizeFilename(draft.title) : templatedBasename;
		const uniqueBasename = await resolveUniqueBasename(deps, folder, basename);

		const createResult = await deps.store.create({ folder, basename: uniqueBasename, frontmatter, body: "" });
		if (!createResult.ok) {
			return err(storeError(createResult.error));
		}

		return ok(createResult.value);
	};
}

export type CreateTask = ReturnType<typeof makeCreateTask>;
