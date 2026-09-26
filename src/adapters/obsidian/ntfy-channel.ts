import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";

import { buildCancelRequest, buildNtfyRequest, buildPollRequest, normalizeServerUrl, parseKnownReminders, serverUrlError } from "@/adapters/obsidian/ntfy-request";
import type { ReminderId } from "@/domain/reminders";
import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";
import type { NtfySettings } from "@/domain/settings";
import type { PushChannel, PushError, PushListOptions, PushPublishOptions } from "@/ports/push-channel";
import type { KnownReminder, PushMessage } from "@/domain/reminder-plan";

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

/** `undefined` when `config` has a usable topic and server URL; otherwise the `unsupported` error to return. */
function configError(config: NtfySettings): PushError | undefined {
	if (config.topic.trim() === "") {
		return { kind: "unsupported", message: "No ntfy topic configured." };
	}
	const urlError = serverUrlError(normalizeServerUrl(config.serverUrl));
	return urlError === undefined ? undefined : { kind: "unsupported", message: urlError };
}

/** ntfy over `requestUrl` (CORS-free, unlike `fetch`); needs ntfy >= 2.16 for sequence ids. */
export function createNtfyChannel(deps: NtfyChannelDeps): PushChannel {
	return {
		publish: async (message: PushMessage, options?: PushPublishOptions): Promise<Result<void, PushError>> => {
			const config = deps.getConfig();
			const configErr = configError(config);
			if (configErr !== undefined) {
				return err(configErr);
			}
			const request = buildNtfyRequest(config, message, deps.getVaultName(), options);
			try {
				const response = await requestUrl({
					url: request.url,
					method: request.method,
					headers: request.headers,
					throw: false,
					...(request.body !== undefined ? { body: request.body } : {}),
				});
				const error = statusError(response);
				return error === undefined ? ok(undefined) : err(error);
			} catch (error) {
				return err({ kind: "network", message: describeThrown(error) });
			}
		},

		cancel: async (id: ReminderId): Promise<Result<void, PushError>> => {
			const config = deps.getConfig();
			const configErr = configError(config);
			if (configErr !== undefined) {
				return err(configErr);
			}
			const request = buildCancelRequest(config, id);
			try {
				const response = await requestUrl({ url: request.url, method: request.method, headers: request.headers, throw: false });
				// 404 means already delivered or never held, not a failure to report.
				if (response.status === 404) {
					return ok(undefined);
				}
				const error = statusError(response);
				return error === undefined ? ok(undefined) : err(error);
			} catch (error) {
				return err({ kind: "network", message: describeThrown(error) });
			}
		},

		listKnown: async ({ sinceSeconds }: PushListOptions): Promise<Result<readonly KnownReminder[], PushError>> => {
			const config = deps.getConfig();
			if (config.topic.trim() === "") {
				return ok([]);
			}
			const configErr = configError(config);
			if (configErr !== undefined) {
				return err(configErr);
			}
			const request = buildPollRequest(config, sinceSeconds);
			try {
				const response = await requestUrl({ url: request.url, method: request.method, headers: request.headers, throw: false });
				const error = statusError(response);
				return error === undefined ? ok(parseKnownReminders(response.text)) : err(error);
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
