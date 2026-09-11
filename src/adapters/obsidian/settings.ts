/**
 * `IsotaskSettings` (type, defaults, and `parseSettings`) lives in
 * `src/domain/settings.ts` — it's pure valibot validation with no Obsidian
 * dependency, so the domain layer owns it. This file re-exports it so
 * existing `@/adapters/obsidian/settings` imports keep working.
 */
export type { IsotaskSettings } from "@/domain/settings";
export { DEFAULT_SETTINGS, parseSettings } from "@/domain/settings";
