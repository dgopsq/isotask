import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";
import type { StatusId } from "@/domain/task";

export type StatusKind = "open" | "done";

export interface StatusConfig {
	readonly id: StatusId;
	readonly label: string;
	readonly kind: StatusKind;
	readonly icon?: string;
}

function statusId(value: string): StatusId {
	return value as StatusId;
}

export const DEFAULT_STATUSES: readonly StatusConfig[] = [
	{ id: statusId("todo"), label: "To do", kind: "open" },
	{ id: statusId("done"), label: "Done", kind: "done" },
];

export function isTerminal(kind: StatusKind): boolean {
	return kind === "done";
}

export function findStatus(configs: readonly StatusConfig[], id: StatusId): Option<StatusConfig> {
	const found = configs.find((config) => config.id === id);
	return found === undefined ? none() : some(found);
}

/** The first configured status with kind `open`, used as the reopen/spawn target. */
export function firstOpenStatus(configs: readonly StatusConfig[]): Option<StatusConfig> {
	const found = configs.find((config) => config.kind === "open");
	return found === undefined ? none() : some(found);
}

/** The first configured status with kind `done`, used as the feed toggle's "mark as done" target. */
export function firstDoneStatus(configs: readonly StatusConfig[]): Option<StatusConfig> {
	const found = configs.find((config) => config.kind === "done");
	return found === undefined ? none() : some(found);
}

/**
 * The feed status circle's toggle target: a `done`-kind status toggles to
 * the first configured `open` status (reopen); any other status — `open`
 * or an unknown/unconfigured id — toggles to the first configured `done`
 * status (mark as done). Returns `none()` when the target kind isn't
 * configured.
 */
export function toggleStatus(configs: readonly StatusConfig[], currentId: StatusId): Option<StatusConfig> {
	const current = findStatus(configs, currentId);
	if (current.some && isTerminal(current.value.kind)) {
		return firstOpenStatus(configs);
	}
	return firstDoneStatus(configs);
}
