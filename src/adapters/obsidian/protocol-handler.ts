import type { App, Plugin } from "obsidian";
import { normalizePath, Notice } from "obsidian";

import type { CompleteTask } from "@/app/complete-task";
import { describeAppError } from "@/app/errors";
import type { SnoozeReminder } from "@/app/snooze-reminder";
import { formatTime } from "@/domain/dates";
import { parseOffsetToken } from "@/domain/reminders";
import type { TaskPath } from "@/domain/task";
import { PROTOCOL_DONE_ACTION, PROTOCOL_OPEN_ACTION, PROTOCOL_SNOOZE_ACTION } from "@/plugin-id";
import type { Notifier } from "@/ports/notifier";

/** Pure so it's testable without a `Plugin`/`App`; `path` is the only param the handler needs, `vault` is consumed by Obsidian before the handler runs. */
export function parseOpenParams(params: Record<string, string>): { readonly path: string } | undefined {
	const path = params["path"];
	return path === undefined || path === "" ? undefined : { path };
}

/** `for` is a bare offset token (`1h`, `30m`, …), same grammar as `remind`; `0`, negative or unparsable all fail. */
export function parseSnoozeParams(params: Record<string, string>): { readonly path: string; readonly minutes: number } | undefined {
	const base = parseOpenParams(params);
	if (base === undefined) {
		return undefined;
	}
	const minutes = parseOffsetToken(params["for"] ?? "");
	return minutes === undefined ? undefined : { path: base.path, minutes };
}

/** Shared by the protocol handler and the desktop reminder notifier's click-through. Notices, rather than throwing, when the note is gone. */
export function openTaskNote(app: App, path: string): void {
	const normalized = normalizePath(path);
	if (app.vault.getFileByPath(normalized) === null) {
		new Notice(`Isotask: could not find ${normalized}.`);
		return;
	}
	void app.workspace.openLinkText(normalized, "", false);
}

export interface ProtocolHandlerDeps {
	readonly completeTask: CompleteTask;
	readonly snoozeReminder: SnoozeReminder;
	readonly notifier: Notifier;
}

/** `obsidian://<id>/open|done|snooze?vault=…&path=…&rid=…[&for=…]` — the deep links `ntfy-request.ts` builds. `rid` isn't read here: done/snooze act on the whole task, not one reminder instance. */
export function registerProtocolHandlers(plugin: Plugin, deps: ProtocolHandlerDeps): void {
	plugin.registerObsidianProtocolHandler(PROTOCOL_OPEN_ACTION, (params) => {
		const parsed = parseOpenParams(params);
		if (parsed === undefined) {
			return;
		}
		openTaskNote(plugin.app, parsed.path);
	});

	plugin.registerObsidianProtocolHandler(PROTOCOL_DONE_ACTION, (params) => {
		const parsed = parseOpenParams(params);
		if (parsed === undefined) {
			deps.notifier.error("Isotask: invalid done link.");
			return;
		}
		void (async () => {
			const result = await deps.completeTask(parsed.path as TaskPath);
			if (!result.ok) {
				deps.notifier.error(describeAppError(result.error));
				return;
			}
			deps.notifier.info(result.value.alreadyDone ? `"${result.value.title}" is already done.` : `Marked "${result.value.title}" as done.`);
		})();
	});

	plugin.registerObsidianProtocolHandler(PROTOCOL_SNOOZE_ACTION, (params) => {
		const parsed = parseSnoozeParams(params);
		if (parsed === undefined) {
			deps.notifier.error("Isotask: invalid snooze link.");
			return;
		}
		void (async () => {
			const result = await deps.snoozeReminder(parsed.path as TaskPath, parsed.minutes);
			if (!result.ok) {
				deps.notifier.error(describeAppError(result.error));
				return;
			}
			const outcome = result.value;
			switch (outcome.status) {
				case "snoozed":
					deps.notifier.info(`Snoozed "${outcome.title}" until ${formatTime(outcome.until)}.`);
					break;
				case "already-done":
					deps.notifier.info(`"${outcome.title}" is already done.`);
					break;
				case "invalid-remind":
					deps.notifier.error(`Isotask: fix the reminder on "${outcome.title}" before snoozing.`);
					break;
			}
		})();
	});
}
