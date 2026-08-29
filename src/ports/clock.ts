import type { IsoDate, IsoDateTime } from "@/domain/dates";

/** The only source of "now" the core is allowed to use, so tests can inject a fixed time. */
export interface Clock {
	readonly now: () => IsoDateTime;
	readonly today: () => IsoDate;
}
