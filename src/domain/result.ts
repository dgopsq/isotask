/**
 * `Result<T, E>` and `Option<T>` are the domain/app layers' replacement for
 * throwing exceptions or returning `null`/`undefined` ad hoc. Both are plain
 * discriminated unions with small helper functions — no classes.
 */

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
	return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T } {
	return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { readonly ok: false; readonly error: E } {
	return !result.ok;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
	return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
	return result.ok ? result : err(fn(result.error));
}

export function andThen<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
	return result.ok ? fn(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
	return result.ok ? result.value : fallback;
}

/**
 * Turns an array of `Result`s into a `Result` of an array, short-circuiting
 * on the first error.
 */
export function all<T, E>(results: readonly Result<T, E>[]): Result<readonly T[], E> {
	const values: T[] = [];
	for (const result of results) {
		if (!result.ok) {
			return result;
		}
		values.push(result.value);
	}
	return ok(values);
}

export type Option<T> = { readonly some: true; readonly value: T } | { readonly some: false };

export function some<T>(value: T): Option<T> {
	return { some: true, value };
}

export function none<T = never>(): Option<T> {
	return { some: false };
}

export function isSome<T>(option: Option<T>): option is { readonly some: true; readonly value: T } {
	return option.some;
}

export function isNone<T>(option: Option<T>): option is { readonly some: false } {
	return !option.some;
}

export function mapOption<T, U>(option: Option<T>, fn: (value: T) => U): Option<U> {
	return option.some ? some(fn(option.value)) : none();
}

export function getOrElse<T>(option: Option<T>, fallback: T): T {
	return option.some ? option.value : fallback;
}

export function fromNullable<T>(value: T | null | undefined): Option<T> {
	return value === null || value === undefined ? none() : some(value);
}
