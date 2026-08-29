import { describe, expect, it } from "vitest";

import { DEFAULT_FEED_VIEW_OPTIONS, parseFeedViewOptions, type FeedViewConfigSource } from "@/domain/feed-view-options";

function configFrom(values: Readonly<Record<string, unknown>>): FeedViewConfigSource {
	return {
		get: (key: string) => values[key],
	};
}

describe("parseFeedViewOptions", () => {
	it("returns all defaults for a config that returns undefined for every key", () => {
		expect(parseFeedViewOptions(configFrom({}))).toEqual(DEFAULT_FEED_VIEW_OPTIONS);
	});

	it("reads valid values for every field", () => {
		const options = parseFeedViewOptions(
			configFrom({ dateSource: "scheduled", showEmptyBuckets: true, completedAtBottom: false }),
		);
		expect(options).toEqual({ dateSource: "scheduled", showEmptyBuckets: true, completedAtBottom: false });
	});

	describe("dateSource", () => {
		it.each(["due", "scheduled", "earliest"] as const)("accepts %s", (value) => {
			expect(parseFeedViewOptions(configFrom({ dateSource: value })).dateSource).toBe(value);
		});

		it.each([undefined, null, "", "nope", 42, {}, ["due"]])("falls back to the default for %p", (value) => {
			expect(parseFeedViewOptions(configFrom({ dateSource: value })).dateSource).toBe(DEFAULT_FEED_VIEW_OPTIONS.dateSource);
		});
	});

	describe("showEmptyBuckets", () => {
		it.each([true, false])("accepts %s", (value) => {
			expect(parseFeedViewOptions(configFrom({ showEmptyBuckets: value })).showEmptyBuckets).toBe(value);
		});

		it.each([undefined, null, "true", 1, {}, []])("falls back to the default for %p", (value) => {
			expect(parseFeedViewOptions(configFrom({ showEmptyBuckets: value })).showEmptyBuckets).toBe(
				DEFAULT_FEED_VIEW_OPTIONS.showEmptyBuckets,
			);
		});
	});

	describe("completedAtBottom", () => {
		it.each([true, false])("accepts %s", (value) => {
			expect(parseFeedViewOptions(configFrom({ completedAtBottom: value })).completedAtBottom).toBe(value);
		});

		it.each([undefined, null, "false", 0, {}, []])("falls back to the default for %p", (value) => {
			expect(parseFeedViewOptions(configFrom({ completedAtBottom: value })).completedAtBottom).toBe(
				DEFAULT_FEED_VIEW_OPTIONS.completedAtBottom,
			);
		});
	});

	it("each field's fallback is independent — one bad key doesn't affect the others", () => {
		const options = parseFeedViewOptions(configFrom({ dateSource: "garbage", showEmptyBuckets: true, completedAtBottom: "nope" }));
		expect(options).toEqual({
			dateSource: DEFAULT_FEED_VIEW_OPTIONS.dateSource,
			showEmptyBuckets: true,
			completedAtBottom: DEFAULT_FEED_VIEW_OPTIONS.completedAtBottom,
		});
	});
});
