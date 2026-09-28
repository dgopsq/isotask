/** Desktop-only count on the dock or taskbar icon. Implemented by `adapters/obsidian/app-badge.ts`. */
export interface AppBadge {
	readonly isAvailable: () => boolean;
	readonly set: (count: number) => void;
	readonly clear: () => void;
}
