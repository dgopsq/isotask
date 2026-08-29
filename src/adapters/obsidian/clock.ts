import { fromJsDate, fromJsDateTime } from "@/domain/dates";
import type { Clock } from "@/ports/clock";

/** Wraps the system clock. Not itself an Obsidian API consumer, but lives here per `docs/ARCHITECTURE.md`'s adapter grouping. */
export function createObsidianClock(): Clock {
	return {
		now: () => fromJsDateTime(new Date()),
		today: () => fromJsDate(new Date()),
	};
}
