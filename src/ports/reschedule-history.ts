import type { FrontmatterPatch } from "@/domain/frontmatter";
import type { Option } from "@/domain/result";
import type { TaskPath } from "@/domain/task";

/**
 * One undoable calendar reschedule gesture (drag or resize). `undo` and
 * `redo` are both `FrontmatterPatch`es rather than a single "old value" /
 * "new value" pair because a resize gesture can touch more than one property
 * (`scheduled` and `duration` together) in one `updateProperties` call —
 * see `app/reschedule-task.ts`.
 */
export interface RescheduleEntry {
	readonly path: TaskPath;
	/** Patch restoring the property values as they were before the gesture. */
	readonly undo: FrontmatterPatch;
	/** Patch the gesture actually wrote — used to detect the note changing underneath us. */
	readonly redo: FrontmatterPatch;
}

/**
 * Session-only undo/redo storage for reschedule gestures. Deliberately not
 * persisted across reloads (see `adapters/history/reschedule-history.ts`);
 * `app/undo-reschedule.ts` is the only consumer.
 */
export interface RescheduleHistory {
	readonly record: (entry: RescheduleEntry) => void;
	readonly takeUndo: () => Option<RescheduleEntry>;
	readonly pushUndone: (entry: RescheduleEntry) => void;
	readonly takeRedo: () => Option<RescheduleEntry>;
	readonly pushRedone: (entry: RescheduleEntry) => void;
}
