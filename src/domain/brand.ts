/**
 * Attaches a nominal "brand" to a primitive type so structurally-identical
 * values (e.g. two different kinds of validated string) cannot be used in
 * place of one another without an explicit cast at the validation boundary.
 */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
