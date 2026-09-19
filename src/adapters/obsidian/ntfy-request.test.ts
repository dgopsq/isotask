import { describe, expect, it } from "vitest";

import type { IsoDateTime } from "@/domain/dates";
import { buildNtfyRequest, clickUrlFor, encodeHeaderValue, normalizeServerUrl, parseScheduledIds, serverUrlError } from "@/adapters/obsidian/ntfy-request";
import type { PushMessage } from "@/domain/reminder-plan";
import type { ReminderId } from "@/domain/reminders";
import type { NtfySettings } from "@/domain/settings";
import { PROTOCOL_OPEN_ACTION } from "@/plugin-id";
import type { TaskPath } from "@/domain/task";

function config(overrides: Partial<NtfySettings> = {}): NtfySettings {
	return {
		enabled: true,
		serverUrl: "https://ntfy.sh",
		topic: "my-topic",
		token: "",
		scheduleAhead: false,
		lookaheadHours: 24,
		serverSupportsUpdates: false,
		...overrides,
	};
}

function message(overrides: Partial<PushMessage> = {}): PushMessage {
	return {
		id: "isotask-abc123" as ReminderId,
		path: "Tasks/Foo.md" as TaskPath,
		at: "2026-09-18T09:00:00" as IsoDateTime,
		title: "Buy milk",
		body: "Due today 09:00",
		priority: 3,
		tags: ["alarm_clock"],
		...overrides,
	};
}

describe("normalizeServerUrl", () => {
	it("strips a single trailing slash", () => {
		expect(normalizeServerUrl("https://ntfy.sh/")).toBe("https://ntfy.sh");
	});

	it("strips multiple trailing slashes", () => {
		expect(normalizeServerUrl("https://ntfy.sh///")).toBe("https://ntfy.sh");
	});

	it("adds https:// when no scheme is given", () => {
		expect(normalizeServerUrl("ntfy.sh")).toBe("https://ntfy.sh");
	});

	it("keeps http:// for a LAN server", () => {
		expect(normalizeServerUrl("http://192.168.1.5:8080/")).toBe("http://192.168.1.5:8080");
	});

	it("trims surrounding whitespace", () => {
		expect(normalizeServerUrl("  ntfy.sh  ")).toBe("https://ntfy.sh");
	});

	it("keeps a bare scheme as-is instead of doubling it", () => {
		expect(normalizeServerUrl("https://")).toBe("https://");
	});
});

describe("serverUrlError", () => {
	it("accepts a well-formed server URL", () => {
		expect(serverUrlError("https://ntfy.sh")).toBeUndefined();
	});

	it("rejects a bare scheme with no host", () => {
		expect(serverUrlError("https://")).toBe("Invalid ntfy server URL.");
	});

	it("rejects an unparsable URL", () => {
		expect(serverUrlError("not a url")).toBe("Invalid ntfy server URL.");
	});
});

describe("buildNtfyRequest auth header", () => {
	it("omits Authorization when the token is empty", () => {
		const request = buildNtfyRequest(config({ token: "" }), message(), "obsidian://x");
		expect(request.headers["Authorization"]).toBeUndefined();
	});

	it("sends Bearer for a plain token", () => {
		const request = buildNtfyRequest(config({ token: "tk_abc" }), message(), "obsidian://x");
		expect(request.headers["Authorization"]).toBe("Bearer tk_abc");
	});

	it("sends Basic for a user:pass token", () => {
		const request = buildNtfyRequest(config({ token: "alice:secret" }), message(), "obsidian://x");
		expect(request.headers["Authorization"]).toBe(`Basic ${btoa("alice:secret")}`);
	});

	it("trims the token before deciding bearer vs basic", () => {
		const request = buildNtfyRequest(config({ token: "  tk_abc  " }), message(), "obsidian://x");
		expect(request.headers["Authorization"]).toBe("Bearer tk_abc");
	});
});

describe("encodeHeaderValue", () => {
	it("leaves an ASCII title unchanged", () => {
		expect(encodeHeaderValue("Buy milk")).toBe("Buy milk");
	});

	it("RFC 2047 encodes a non-ASCII title", () => {
		const encoded = encodeHeaderValue("Café run");
		expect(encoded).toBe(`=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode("Café run")))}?=`);
	});
});

describe("buildNtfyRequest Delay header", () => {
	it("omits Delay when no delayUntil is given", () => {
		const request = buildNtfyRequest(config(), message(), "obsidian://x");
		expect(request.headers["Delay"]).toBeUndefined();
	});

	it("converts delayUntil to a unix-seconds string", () => {
		const delayUntil = "2026-09-18T10:00:00" as IsoDateTime;
		const request = buildNtfyRequest(config(), message(), "obsidian://x", { delayUntil });
		expect(request.headers["Delay"]).toBe(String(Math.floor(new Date(delayUntil).getTime() / 1000)));
	});
});

describe("clickUrlFor", () => {
	it("encodes a path with spaces and slashes", () => {
		const url = clickUrlFor("My Vault", message({ path: "Tasks/Buy milk & eggs.md" as TaskPath, id: "isotask-xyz" as ReminderId }));
		expect(url).toBe(
			`obsidian://${PROTOCOL_OPEN_ACTION}?vault=${encodeURIComponent("My Vault")}&path=${encodeURIComponent("Tasks/Buy milk & eggs.md")}&rid=${encodeURIComponent("isotask-xyz")}`,
		);
	});
});

describe("parseScheduledIds", () => {
	it("keeps isotask ids from a mixed ndjson sample and skips the rest", () => {
		const ndjson = [
			JSON.stringify({ id: "a", click: "obsidian://isotask/open?vault=V&path=P&rid=isotask-one" }),
			"",
			"not json",
			JSON.stringify({ id: "b", click: "https://example.com/no-query" }),
			JSON.stringify({ id: "c", click: "obsidian://other-app/open?rid=not-ours" }),
			JSON.stringify({ id: "d" }),
			JSON.stringify({ id: "e", click: "obsidian://isotask/open?vault=V&path=P&rid=isotask-two" }),
		].join("\n");

		expect(parseScheduledIds(ndjson)).toEqual(["isotask-one", "isotask-two"]);
	});
});
