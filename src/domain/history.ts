import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";

/**
 * A generic bounded undo/redo stack over immutable data: `past` is the undo
 * branch (most recent action last), `future` is the redo branch (most
 * recently undone action last). Kept generic and side-effect-free so it can
 * be unit-tested without a `TaskStore`; `adapters/history/reschedule-history.ts`
 * wraps one instance in mutable state for the actual reschedule use-cases.
 */
export interface History<T> {
	readonly past: readonly T[];
	readonly future: readonly T[];
}

export function emptyHistory<T>(): History<T> {
	return { past: [], future: [] };
}

/**
 * Appends `entry` to `past`, evicting the OLDEST entries once `past` would
 * exceed `limit`, and clears `future`. Clearing `future` is standard undo
 * semantics: once a new action has been recorded, whatever used to be
 * redoable no longer applies cleanly on top of it, so the redo branch is
 * discarded rather than left dangling.
 */
export function record<T>(history: History<T>, entry: T, limit: number): History<T> {
	const past = [...history.past, entry];
	const overflow = past.length - limit;
	return { past: overflow > 0 ? past.slice(overflow) : past, future: [] };
}

/**
 * Removes and returns the most recent `past` entry. `future` is deliberately
 * left untouched here — the caller only knows the undo actually happened
 * (rather than, say, the underlying write failing) once it has applied the
 * inverse patch, so committing to the redo branch is a separate `pushUndone`
 * call rather than something `takeUndo` does eagerly.
 */
export function takeUndo<T>(history: History<T>): Option<{ readonly entry: T; readonly next: History<T> }> {
	const entry = history.past.at(-1);
	if (entry === undefined) {
		return none();
	}
	return some({ entry, next: { past: history.past.slice(0, -1), future: history.future } });
}

/** Removes and returns the most recent `future` entry, mirroring `takeUndo` for the redo direction. */
export function takeRedo<T>(history: History<T>): Option<{ readonly entry: T; readonly next: History<T> }> {
	const entry = history.future.at(-1);
	if (entry === undefined) {
		return none();
	}
	return some({ entry, next: { past: history.past, future: history.future.slice(0, -1) } });
}

/** Commits a successfully-undone entry to the redo branch. Does not touch `past`. */
export function pushUndone<T>(history: History<T>, entry: T): History<T> {
	return { past: history.past, future: [...history.future, entry] };
}

/** Commits a successfully-redone entry back to the undo branch. Does not touch `future`. */
export function pushRedone<T>(history: History<T>, entry: T): History<T> {
	return { past: [...history.past, entry], future: history.future };
}
