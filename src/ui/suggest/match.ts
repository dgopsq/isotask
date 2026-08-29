/**
 * Case-insensitive substring match shared by every `AbstractInputSuggest` in
 * `src/ui/suggest/`. Trims `query` so a stray leading/trailing space (or the
 * text after a comma in `TagSuggest`) doesn't hide every candidate.
 */
export function matchesQuery(candidate: string, query: string): boolean {
	const trimmed = query.trim().toLowerCase();
	return trimmed.length === 0 || candidate.toLowerCase().includes(trimmed);
}
