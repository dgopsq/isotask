import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";

import { authHeaders, buildNtfyRequest, clickUrlFor, normalizeServerUrl, parseScheduledIds } from "@/adapters/obsidian/ntfy-request";
import type { ReminderId } from "@/domain/reminders";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { NtfySettings } from "@/domain/settings";
import type { PushChannel, PushError, PushPublishOptions } from "@/ports/push-channel";
import type { PushMessage } from "@/domain/reminder-plan";

export interface NtfyChannelDeps {
	readonly getConfig: () => NtfySettings;
	readonly getVaultName: () => string;
}

function describeThrown(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** `undefined` on 2xx; ntfy always returns a body on 4xx/5xx, so the first 200 chars are enough context without risking a huge Notice. */
function statusError(response: RequestUrlResponse): PushError | undefined {
	if (response.status === 401 || response.status === 403) {
		return { kind: "auth" };
	}
	if (response.status >= 400) {
		return { kind: "server", status: response.status, message: response.text.slice(0, 200) };
	}
	return undefined;
}

/** ntfy over `requestUrl` (CORS-free, unlike `fetch`). `publish`/`listScheduled` are tier 1; `cancel` and sequenced replace need ntfy ≥ 2.16 (tier 3, wave 2b). */
export function createNtfyChannel(deps: NtfyChannelDeps): PushChannel {
	return {
		publish: async (message: PushMessage, options?: PushPublishOptions): Promise<Result<void, PushError>> => {
			if (options?.sequenceId !== undefined) {
				return err({ kind: "unsupported", message: "Server-side replace needs ntfy 2.16 support (wave 2b)." });
			}
			const config = deps.getConfig();
			if (config.topic.trim() === "") {
				return err({ kind: "unsupported", message: "No ntfy topic configured." });
			}
			const clickUrl = clickUrlFor(deps.getVaultName(), message);
			const request = buildNtfyRequest(config, message, clickUrl, options);
			try {
				const response = await requestUrl({ url: request.url, method: request.method, headers: request.headers, body: request.body, throw: false });
				const error = statusError(response);
				return error === undefined ? ok(undefined) : err(error);
			} catch (error) {
				return err({ kind: "network", message: describeThrown(error) });
			}
		},

		cancel: async (id: ReminderId): Promise<Result<void, PushError>> => {
			return err({ kind: "unsupported", message: `Cancelling reminder ${id} needs ntfy 2.16 support (wave 2b).` });
		},

		listScheduled: async (): Promise<Result<readonly ReminderId[], PushError>> => {
			const config = deps.getConfig();
			if (config.topic.trim() === "") {
				return ok([]);
			}
			const base = normalizeServerUrl(config.serverUrl);
			const url = `${base}/${encodeURIComponent(config.topic)}/json?poll=1&sched=1`;
			try {
				const response = await requestUrl({ url, method: "GET", headers: authHeaders(config.token), throw: false });
				const error = statusError(response);
				return error === undefined ? ok(parseScheduledIds(response.text)) : err(error);
			} catch (error) {
				return err({ kind: "network", message: describeThrown(error) });
			}
		},
	};
}

/** Plain-string mapping for a Notice; `unsupported` already carries its own user-facing message. */
export function describePushError(error: PushError): string {
	switch (error.kind) {
		case "network":
			return `Could not reach the ntfy server: ${error.message}`;
		case "auth":
			return "ntfy rejected the token.";
		case "server":
			return `ntfy returned ${String(error.status)}: ${error.message}`;
		case "unsupported":
			return error.message;
		default: {
			const exhaustive: never = error;
			return exhaustive;
		}
	}
}
