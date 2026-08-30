import { emptyHistory, pushRedone, pushUndone, record, takeRedo, takeUndo } from "@/domain/history";
import type { History } from "@/domain/history";
import { none, some } from "@/domain/result";
import type { RescheduleEntry, RescheduleHistory } from "@/ports/reschedule-history";

/**
 * `domain/history.ts` is a pure `History<T> -> History<T>` transformer: it
 * has no notion of "the current one", only of a value handed in and a new
 * value handed back. Something has to hold the actual current value between
 * one gesture and the next — that is imperative-shell bookkeeping (a mutable
 * field, mutated in place), so it lives here in `adapters`, not in `domain`,
 * per the functional-core/imperative-shell split in `AGENTS.md`. This module
 * is the entire imperative half: a closure around one `History<RescheduleEntry>`
 * field, with every method just calling the matching pure function and
 * storing the result back.
 */
export function makeRescheduleHistory(limit = 20): RescheduleHistory {
	let history: History<RescheduleEntry> = emptyHistory();

	return {
		record: (entry) => {
			history = record(history, entry, limit);
		},
		takeUndo: () => {
			const result = takeUndo(history);
			if (!result.some) {
				return none();
			}
			history = result.value.next;
			return some(result.value.entry);
		},
		pushUndone: (entry) => {
			history = pushUndone(history, entry);
		},
		takeRedo: () => {
			const result = takeRedo(history);
			if (!result.some) {
				return none();
			}
			history = result.value.next;
			return some(result.value.entry);
		},
		pushRedone: (entry) => {
			history = pushRedone(history, entry);
		},
		clear: () => {
			history = emptyHistory();
		},
	};
}
