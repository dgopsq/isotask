/** Desktop-only count on the dock or taskbar icon. */
export interface AppBadge {
	readonly isAvailable: () => boolean;
	readonly set: (count: number) => void;
	readonly clear: () => void;
}
