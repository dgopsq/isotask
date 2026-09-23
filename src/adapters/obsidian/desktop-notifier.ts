import { Platform } from "obsidian";

import type { SystemNotification, SystemNotifier } from "@/ports/system-notifier";

/** OS `Notification` API, desktop only — Electron's renderer exposes it, mobile Obsidian does not. */
export function createDesktopNotifier(): SystemNotifier {
	return {
		isAvailable: (): boolean => Platform.isDesktopApp && typeof window.Notification === "function" && Notification.permission === "granted",

		requestPermission: async (): Promise<boolean> => {
			if (!Platform.isDesktopApp || typeof window.Notification !== "function") {
				return false;
			}
			if (Notification.permission === "granted") {
				return true;
			}
			if (Notification.permission === "denied") {
				return false;
			}
			const result = await Notification.requestPermission();
			return result === "granted";
		},

		show: (notification: SystemNotification, onClick: () => void): void => {
			const system = new Notification(notification.title, { body: notification.body, tag: notification.id });
			system.onclick = (): void => {
				window.focus();
				onClick();
			};
		},
	};
}
