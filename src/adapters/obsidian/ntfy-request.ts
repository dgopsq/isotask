import { fromJsDateTime, toJsDate } from "@/domain/dates";
import type { KnownReminder, PushMessage } from "@/domain/reminder-plan";
import type { ReminderId } from "@/domain/reminders";
import type { NtfySettings } from "@/domain/settings";
import { PROTOCOL_DONE_ACTION, PROTOCOL_OPEN_ACTION, PROTOCOL_SNOOZE_ACTION } from "@/plugin-id";
import type { PushPublishOptions } from "@/ports/push-channel";

// No `obsidian` import on purpose: keeps request building unit-testable without mocking the plugin API.

/** Adds `https://` before stripping trailing slashes, so a bare scheme like `"https://"` doesn't become `"https://https:"`. */
export function normalizeServerUrl(raw: string): string {
	const trimmed = raw.trim();
	const match = /^(https?:\/\/)?(.*)$/i.exec(trimmed);
	const [, scheme, rest] = match ?? [undefined, undefined, trimmed];
	return `${scheme ?? "https://"}${rest.replace(/\/+$/, "")}`;
}

/** `undefined` when `base` is a usable ntfy server URL; otherwise a user-facing reason. */
export function serverUrlError(base: string): string | undefined {
	try {
		const url = new URL(base);
		return url.host === "" ? "Invalid ntfy server URL." : undefined;
	} catch {
		return "Invalid ntfy server URL.";
	}
}

function isAscii(value: string): boolean {
	for (let i = 0; i < value.length; i += 1) {
		if (value.charCodeAt(i) > 127) {
			return false;
		}
	}
	return true;
}

/** ntfy headers must be latin-1/ASCII; a non-ASCII title is RFC 2047 encoded-word'd instead of sent raw. */
export function encodeHeaderValue(value: string): string {
	if (isAscii(value)) {
		return value;
	}
	const bytes = new TextEncoder().encode(value);
	const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
	return `=?UTF-8?B?${btoa(binary)}?=`;
}

/** A `user:pass` token (detected by the colon) goes Basic; anything else is treated as a bearer token. Empty/blank tokens send no header at all. */
export function authHeaders(token: string): Record<string, string> {
	const trimmed = token.trim();
	if (trimmed === "") {
		return {};
	}
	return trimmed.includes(":") ? { Authorization: `Basic ${btoa(trimmed)}` } : { Authorization: `Bearer ${trimmed}` };
}

/** Every reminder-push deep link's shared param set; `encodeURIComponent` on `path` also keeps a comma/semicolon in it from breaking the ntfy Actions header, which uses both as delimiters. */
function reminderActionUrl(action: string, vaultName: string, message: PushMessage, extra: readonly (readonly [string, string])[] = []): string {
	const params = [["vault", vaultName], ["path", message.path], ["rid", message.id], ...extra]
		.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
		.join("&");
	return `obsidian://${action}?${params}`;
}

/** The deep link a fired notification opens; `protocol-handler.ts` parses it back on the receiving device. */
export function clickUrlFor(vaultName: string, message: PushMessage): string {
	return reminderActionUrl(PROTOCOL_OPEN_ACTION, vaultName, message);
}

/** The reminder push's "Done" action link. */
export function doneUrlFor(vaultName: string, message: PushMessage): string {
	return reminderActionUrl(PROTOCOL_DONE_ACTION, vaultName, message);
}

/** The reminder push's "Snooze" action link; fixed at 1h — the Actions header only has room for one quick duration. */
export function snoozeUrlFor(vaultName: string, message: PushMessage): string {
	return reminderActionUrl(PROTOCOL_SNOOZE_ACTION, vaultName, message, [["for", "1h"]]);
}

/** ntfy's "simple" Actions format: up to 3 `view, <label>, <url>, clear=true` entries, `;`-separated. */
function buildActionsHeader(vaultName: string, message: PushMessage): string {
	const actions: readonly (readonly [string, string])[] = [
		["Done", doneUrlFor(vaultName, message)],
		["Snooze 1h", snoozeUrlFor(vaultName, message)],
		["Open", clickUrlFor(vaultName, message)],
	];
	return actions.map(([label, url]) => `view, ${label}, ${url}, clear=true`).join("; ");
}

export interface NtfyRequest {
	readonly url: string;
	readonly method: "POST" | "DELETE" | "GET";
	readonly headers: Record<string, string>;
	readonly body?: string;
}

/** Builds the `POST` publish request, always keyed by `message.id` as the sequence id (ntfy >= 2.16). */
export function buildNtfyRequest(config: NtfySettings, message: PushMessage, vaultName: string, options?: PushPublishOptions): NtfyRequest {
	const base = normalizeServerUrl(config.serverUrl);
	const headers: Record<string, string> = {
		Title: encodeHeaderValue(message.title),
		Priority: String(message.priority),
		Tags: message.tags.join(","),
		Click: clickUrlFor(vaultName, message),
		Actions: buildActionsHeader(vaultName, message),
		"X-Sequence-ID": message.id,
		...authHeaders(config.token),
	};
	if (options?.delayUntil !== undefined) {
		headers["Delay"] = String(Math.floor(toJsDate(options.delayUntil).getTime() / 1000));
	}
	return {
		url: `${base}/${encodeURIComponent(config.topic)}`,
		method: "POST",
		headers,
		body: message.body,
	};
}

/** Builds the `DELETE` request that cancels a still-held message by its sequence id. */
export function buildCancelRequest(config: NtfySettings, id: ReminderId): NtfyRequest {
	const base = normalizeServerUrl(config.serverUrl);
	return {
		url: `${base}/${encodeURIComponent(config.topic)}/${encodeURIComponent(id)}`,
		method: "DELETE",
		headers: authHeaders(config.token),
	};
}

/** Builds the `GET .../json?poll=1&sched=1&since=` request; `since` is floored to whole seconds, minimum 1. */
export function buildPollRequest(config: NtfySettings, sinceSeconds: number): NtfyRequest {
	const base = normalizeServerUrl(config.serverUrl);
	const since = Math.max(1, Math.floor(sinceSeconds));
	return {
		url: `${base}/${encodeURIComponent(config.topic)}/json?poll=1&sched=1&since=${String(since)}s`,
		method: "GET",
		headers: authHeaders(config.token),
	};
}

/** Parses each ndjson line; an unparsable line (partial poll output, a foreign topic's message) is skipped rather than failing the whole batch. */
export function parseKnownReminders(ndjson: string): readonly KnownReminder[] {
	const reminders: KnownReminder[] = [];
	for (const line of ndjson.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") {
			continue;
		}
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (typeof parsed !== "object" || parsed === null) {
				continue;
			}
			const record = parsed as Record<string, unknown>;
			const sequenceId = record["sequence_id"];
			const time = record["time"];
			if (typeof sequenceId !== "string" || !sequenceId.startsWith("isotask-") || typeof time !== "number" || !Number.isFinite(time)) {
				continue;
			}
			reminders.push({ id: sequenceId as ReminderId, at: fromJsDateTime(new Date(time * 1000)) });
		} catch {
			continue;
		}
	}
	return reminders;
}
