import type { AppDeps } from "@/app/deps";
import { staleUndoError, storeError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import type { FrontmatterPatch, FrontmatterValue } from "@/domain/frontmatter";
import type { Option, Result } from "@/domain/result";
import { err, none, ok, some } from "@/domain/result";
import type { TaskPath } from "@/domain/task";
import type { RescheduleEntry } from "@/ports/reschedule-history";

/**
 * Whether a single stored value still matches what a past gesture expected
 * to find there. An absent key (`undefined`) and an explicit `null` both
 * mean "not set", so they compare equal to each other. Anything that isn't
 * a primitive (i.e. an array — the only non-primitive `FrontmatterValue`) is
 * treated as changed rather than compared structurally: obtask only ever
 * writes strings and numbers through a reschedule gesture, so seeing an
 * array here means some other write touched the property, and the
 * conservative answer is "stale".
 */
function valueMatches(stored: FrontmatterValue | undefined, expected: FrontmatterValue | null): boolean {
	const normalizedStored: FrontmatterValue | null = stored === undefined ? null : stored;
	if (normalizedStored === null || expected === null) {
		return normalizedStored === expected;
	}
	if (Array.isArray(normalizedStored) || Array.isArray(expected)) {
		return false;
	}
	return normalizedStored === expected;
}

/** True if the note's current frontmatter no longer matches every key `patch` describes. */
function isStale(raw: Readonly<Record<string, FrontmatterValue>>, patch: FrontmatterPatch): boolean {
	return Object.entries(patch).some(([key, expected]) => !valueMatches(raw[key], expected));
}

/**
 * Shared body of `makeUndoReschedule`/`makeRedoReschedule` — the two
 * use-cases are exact mirrors of each other (pop an entry, check it's still
 * safe to apply, write the inverse patch, commit to the other branch), so
 * the direction-specific pieces are passed in rather than duplicating the
 * five-step sequence twice.
 */
async function applyHistoryStep(
	deps: AppDeps,
	direction: "undo" | "redo",
	take: () => Option<RescheduleEntry>,
	staleAgainst: (entry: RescheduleEntry) => FrontmatterPatch,
	patchToWrite: (entry: RescheduleEntry) => FrontmatterPatch,
	commit: (entry: RescheduleEntry) => void,
): Promise<Result<Option<TaskPath>, AppError>> {
	const taken = take();
	if (!taken.some) {
		return ok(none());
	}
	const entry = taken.value;

	const rawResult = await deps.store.rawFrontmatter(entry.path);
	if (!rawResult.ok) {
		return err(storeError(rawResult.error));
	}

	// The note changed since the gesture (edited elsewhere, or acted on
	// again) — applying the stored inverse now would clobber whatever is
	// there. Drop the entry rather than writing over it or leaving it
	// available to try again: it's dead once the note has moved on.
	if (isStale(rawResult.value, staleAgainst(entry))) {
		return err(staleUndoError(entry.path, direction));
	}

	const updateResult = await deps.store.updateProperties(entry.path, patchToWrite(entry));
	if (!updateResult.ok) {
		return err(storeError(updateResult.error));
	}

	commit(entry);
	return ok(some(entry.path));
}

/**
 * Undoes the most recent reschedule gesture recorded in `deps.history`:
 * pops it from the undo branch, writes its `undo` patch, and — only once
 * that write has actually succeeded — pushes it onto the redo branch. An
 * empty undo branch is `ok(none())`, not an error: there is simply nothing
 * to undo, and it's up to the caller (a command/keybinding) to decide
 * whether that's worth telling the user about.
 */
export function makeUndoReschedule(deps: AppDeps) {
	return (): Promise<Result<Option<TaskPath>, AppError>> =>
		applyHistoryStep(
			deps,
			"undo",
			() => deps.history.takeUndo(),
			(entry) => entry.redo,
			(entry) => entry.undo,
			(entry) => {
				deps.history.pushUndone(entry);
			},
		);
}

/** Mirror of `makeUndoReschedule`: pops the redo branch, writes `redo`, then pushes back onto the undo branch. */
export function makeRedoReschedule(deps: AppDeps) {
	return (): Promise<Result<Option<TaskPath>, AppError>> =>
		applyHistoryStep(
			deps,
			"redo",
			() => deps.history.takeRedo(),
			(entry) => entry.undo,
			(entry) => entry.redo,
			(entry) => {
				deps.history.pushRedone(entry);
			},
		);
}

export type UndoReschedule = ReturnType<typeof makeUndoReschedule>;
export type RedoReschedule = ReturnType<typeof makeRedoReschedule>;
