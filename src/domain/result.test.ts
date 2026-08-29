import { describe, expect, it } from "vitest";

import {
	all,
	andThen,
	err,
	fromNullable,
	getOrElse,
	isErr,
	isNone,
	isOk,
	isSome,
	map,
	mapErr,
	mapOption,
	none,
	ok,
	some,
	unwrapOr,
} from "@/domain/result";

describe("Result", () => {
	it("ok/err carry their payload and discriminant", () => {
		expect(ok(1)).toEqual({ ok: true, value: 1 });
		expect(err("boom")).toEqual({ ok: false, error: "boom" });
	});

	it("isOk/isErr narrow correctly", () => {
		expect(isOk(ok(1))).toBe(true);
		expect(isOk(err("e"))).toBe(false);
		expect(isErr(ok(1))).toBe(false);
		expect(isErr(err("e"))).toBe(true);
	});

	it("map transforms the ok value and passes through errors", () => {
		expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
		expect(map(err<string>("e"), (n: number) => n * 2)).toEqual(err("e"));
	});

	it("mapErr transforms the error and passes through ok", () => {
		expect(mapErr(err("e"), (e) => e.toUpperCase())).toEqual(err("E"));
		expect(mapErr(ok<number>(1), (e: string) => e.toUpperCase())).toEqual(ok(1));
	});

	it("andThen chains fallible computations", () => {
		const parsePositive = (n: number) => (n > 0 ? ok(n) : err("not positive"));
		expect(andThen(ok(2), parsePositive)).toEqual(ok(2));
		expect(andThen(ok(-2), parsePositive)).toEqual(err("not positive"));
		expect(andThen(err<string>("upstream"), parsePositive)).toEqual(err("upstream"));
	});

	it("unwrapOr returns the value or a fallback", () => {
		expect(unwrapOr(ok(1), 0)).toBe(1);
		expect(unwrapOr(err("e"), 0)).toBe(0);
	});

	it("all collects values or short-circuits on the first error", () => {
		expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
		expect(all([ok(1), err("bad"), ok(3)])).toEqual(err("bad"));
	});
});

describe("Option", () => {
	it("some/none carry their payload and discriminant", () => {
		expect(some(1)).toEqual({ some: true, value: 1 });
		expect(none()).toEqual({ some: false });
	});

	it("isSome/isNone narrow correctly", () => {
		expect(isSome(some(1))).toBe(true);
		expect(isSome(none())).toBe(false);
		expect(isNone(some(1))).toBe(false);
		expect(isNone(none())).toBe(true);
	});

	it("mapOption transforms present values and skips absent ones", () => {
		expect(mapOption(some(2), (n) => n * 2)).toEqual(some(4));
		expect(mapOption(none<number>(), (n) => n * 2)).toEqual(none());
	});

	it("getOrElse returns the value or a fallback", () => {
		expect(getOrElse(some(1), 0)).toBe(1);
		expect(getOrElse(none<number>(), 0)).toBe(0);
	});

	it("fromNullable treats null and undefined as none", () => {
		expect(fromNullable(1)).toEqual(some(1));
		expect(fromNullable(null)).toEqual(none());
		expect(fromNullable(undefined)).toEqual(none());
	});
});
