import type { Notifier } from "@/ports/notifier";

/** Web Clipboard API, not an Obsidian one — works on mobile, unlike `document.execCommand`. */
export async function copyToClipboard(text: string, notifier: Notifier, successMessage: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		notifier.info(successMessage);
	} catch (error) {
		notifier.error(`Could not copy to clipboard: ${error instanceof Error ? error.message : String(error)}`);
	}
}
