import type { RecurrenceError } from "@/domain/recurrence";
import type { StatusId, TaskPath } from "@/domain/task";
import type { TaskStoreError } from "@/ports/task-store";

/** Errors an `app` use-case can fail with, surfaced to the user via `describeAppError`. */
export type AppError =
	| { readonly kind: "store"; readonly error: TaskStoreError }
	| { readonly kind: "unknown-status"; readonly statusId: string }
	| { readonly kind: "invalid-rrule"; readonly reason: string }
	| { readonly kind: "not-a-task"; readonly path: TaskPath }
	| { readonly kind: "no-status-configured" };

/** Wraps a `TaskStoreError` (from `ports/task-store.ts`) as an `AppError`. */
export function storeError(error: TaskStoreError): AppError {
	return { kind: "store", error };
}

export function unknownStatusError(statusId: StatusId): AppError {
	return { kind: "unknown-status", statusId };
}

function describeStoreError(error: TaskStoreError): string {
	switch (error.kind) {
		case "not-found":
			return `Task not found: ${error.path}`;
		case "invalid-task":
			return `${error.path} could not be parsed as a task (${error.errors.map((e) => e.kind).join(", ")}).`;
		case "already-exists":
			return `A note already exists at ${error.path}.`;
		case "io-error":
			return `${error.path}: ${error.message}`;
		default: {
			const exhaustive: never = error;
			return exhaustive;
		}
	}
}

/** Human-readable message for a `Notifier.error` call. */
export function describeAppError(error: AppError): string {
	switch (error.kind) {
		case "store":
			return describeStoreError(error.error);
		case "unknown-status":
			return `Unknown status "${error.statusId}".`;
		case "invalid-rrule":
			return `Invalid recurrence rule: ${error.reason}`;
		case "not-a-task":
			return `${error.path} is not a task note.`;
		case "no-status-configured":
			return "No open status is configured.";
		default: {
			const exhaustive: never = error;
			return exhaustive;
		}
	}
}

/** Human-readable message for a `RecurrenceError` (`domain/recurrence.ts`'s `parseRRule`). */
export function describeRecurrenceError(error: RecurrenceError): string {
	switch (error.kind) {
		case "empty":
			return "Recurrence rule is empty.";
		case "contains-dtstart":
			return "Recurrence rule must not include DTSTART.";
		case "unparsable":
			return `Could not parse "${error.value}": ${error.reason}`;
		default: {
			const exhaustive: never = error;
			return exhaustive;
		}
	}
}
