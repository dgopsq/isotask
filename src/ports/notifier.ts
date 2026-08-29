/** User-visible feedback without coupling `app` to Obsidian's `Notice`. */
export interface Notifier {
	readonly info: (message: string) => void;
	readonly error: (message: string) => void;
}
