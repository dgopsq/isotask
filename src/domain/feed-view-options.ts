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
 * Below this pane width (px), the row's fixed metadata columns (date,
 * priority, project, tags, generic — one `max-content` track each) cannot
 * fit beside a readable title, so `styles/isotask.css`'s permanent-horizontal-
 * scrollbar wide layout stops being usable and rows collapse to two lines
 * instead (status + title on line one, metadata wrapped onto line two). This
 * is a LAYOUT threshold on the feed pane's own `clientWidth`
 * (`views/bases/feed/feed-view.ts`), never on `is-mobile`: a narrow split
 * pane on desktop crosses it too, and a full-width pane on a phone in
 * landscape doesn't. Mirrors `domain/calendar-view-options.ts`'s
 * `COMPACT_CALENDAR_WIDTH` — same pane-width-fact rationale, same
 * single-source-of-truth relationship with its view's `isotask-feed--compact`
 * CSS class.
 */
export const COMPACT_FEED_WIDTH = 560;

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
