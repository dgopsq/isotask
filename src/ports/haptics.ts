export type HapticKind = "light" | "medium" | "success" | "error";

/** Feedback port for touch gestures. No-op when the platform has no haptics (desktop, most of Android). */
export interface Haptics {
	readonly trigger: (kind: HapticKind) => void;
}

export const NOOP_HAPTICS: Haptics = { trigger: () => undefined };
