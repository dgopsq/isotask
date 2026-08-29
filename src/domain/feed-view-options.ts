import * as v from "valibot";

import type { DateSource } from "@/domain/buckets";

export interface FeedViewOptions {
	readonly dateSource: DateSource;
	readonly showEmptyBuckets: boolean;
	readonly completedAtBottom: boolean;
}

export const DEFAULT_FEED_VIEW_OPTIONS: FeedViewOptions = {
	dateSource: "due",
	showEmptyBuckets: false,
	completedAtBottom: true,
};

/**
 * Duck-typed accessor for Bases' per-view config — not `BasesViewConfig`
 * itself, so this file stays free of an `obsidian` import (ESLint
 * layer-boundary rule for `src/domain`).
 */
export interface FeedViewConfigSource {
	get(key: string): unknown;
}

const DateSourceSchema = v.fallback(v.picklist(["due", "scheduled", "earliest"]), DEFAULT_FEED_VIEW_OPTIONS.dateSource);

function booleanSchema(defaultValue: boolean) {
	return v.fallback(v.boolean(), defaultValue);
}

/**
 * Parses Bases' per-view config into `FeedViewOptions`. Each field falls
 * back to its default independently when missing or malformed, so a
 * corrupt or hand-edited `.base` file never breaks the view.
 */
export function parseFeedViewOptions(config: FeedViewConfigSource): FeedViewOptions {
	return {
		dateSource: v.parse(DateSourceSchema, config.get("dateSource")),
		showEmptyBuckets: v.parse(booleanSchema(DEFAULT_FEED_VIEW_OPTIONS.showEmptyBuckets), config.get("showEmptyBuckets")),
		completedAtBottom: v.parse(booleanSchema(DEFAULT_FEED_VIEW_OPTIONS.completedAtBottom), config.get("completedAtBottom")),
	};
}
