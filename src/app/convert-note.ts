import type { AppDeps } from "@/app/deps";
import { storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { FrontmatterPatch, FrontmatterValue } from "@/domain/frontmatter";
import { isTaskNote } from "@/domain/frontmatter";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import { firstOpenStatus } from "@/domain/status";
import type { TaskPath } from "@/domain/task";
import type { TaskStoreError } from "@/ports/task-store";

export interface ConvertNoteOutcome {
	/** `false` when the note already carried the marker — a no-op, reported via `notifier.info` rather than `AppError`. */
	readonly converted: boolean;
}

/**
 * `TaskStore.rawFrontmatter` reports a note with no frontmatter block at all
 * as `invalid-task`/`not-a-task` (see `adapters/obsidian/task-store.ts`) —
 * exactly the case this use-case exists to handle (a plain note becoming a
 * task for the first time), so it's treated as "no properties yet" here
 * rather than propagated as a failure.
 */
function isMissingFrontmatter(error: TaskStoreError): boolean {
	return error.kind === "invalid-task" && error.errors.length === 1 && error.errors[0]?.kind === "not-a-task";
}

/** Adds the marker (+ status and created, if absent) to turn a plain note into a task note. No-op if it already is one. */
export function makeConvertNote(deps: AppDeps) {
	return async (path: TaskPath): Promise<Result<ConvertNoteOutcome, AppError>> => {
		const rawResult = await deps.store.rawFrontmatter(path);
		let raw: Readonly<Record<string, FrontmatterValue>>;
		if (rawResult.ok) {
			raw = rawResult.value;
		} else if (isMissingFrontmatter(rawResult.error)) {
			raw = {};
		} else {
			return err(storeError(rawResult.error));
		}

		const keys = deps.settings().propertyKeys;
		if (isTaskNote(raw, keys)) {
			deps.notifier.info("Already a task.");
			return ok({ converted: false });
		}

		const openStatus = firstOpenStatus(deps.settings().statuses);
		if (!openStatus.some) {
			return err({ kind: "no-status-configured" });
		}

		const patch: FrontmatterPatch = {
			[keys.markerKey]: keys.markerValue,
			...(raw[keys.status] === undefined ? { [keys.status]: openStatus.value.id } : {}),
			...(raw[keys.created] === undefined ? { [keys.created]: deps.clock.now() } : {}),
		};

		const updateResult = await deps.store.updateProperties(path, patch);
		if (!updateResult.ok) {
			return err(storeError(updateResult.error));
		}

		return ok({ converted: true });
	};
}

export type ConvertNote = ReturnType<typeof makeConvertNote>;
