import type { Option } from "@/domain/result";
import { none, some } from "@/domain/result";
import type { StatusId } from "@/domain/task";

export type StatusKind = "open" | "active" | "done" | "cancelled";

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
	{ id: statusId("in-progress"), label: "In progress", kind: "active" },
	{ id: statusId("done"), label: "Done", kind: "done" },
	{ id: statusId("cancelled"), label: "Cancelled", kind: "cancelled" },
];

export function isTerminal(kind: StatusKind): boolean {
	switch (kind) {
		case "done":
		case "cancelled":
			return true;
		case "open":
		case "active":
			return false;
		default: {
			const exhaustive: never = kind;
			return exhaustive;
		}
	}
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

/** Walks the configured status list in configured (array) order, wrapping around. Falls back to the first status if `currentId` isn't found. */
export function nextStatusInCycle(configs: readonly StatusConfig[], currentId: StatusId): Option<StatusConfig> {
	if (configs.length === 0) {
		return none();
	}
	const currentIndex = configs.findIndex((config) => config.id === currentId);
	const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % configs.length;
	const next = configs[nextIndex];
	return next === undefined ? none() : some(next);
}
