/**
 * djb2a: `hash = (hash * 33) ^ code` over UTF-16 code units, seeded at 5381.
 * FROZEN — shared by `project-color.ts`'s palette hash and `reminders.ts`'s
 * reminder ids; changing it silently reassigns both.
 */
export function djb2a(input: string): number {
	let hash = 5381;
	for (let i = 0; i < input.length; i += 1) {
		hash = (hash * 33) ^ input.charCodeAt(i);
	}
	return hash;
}
