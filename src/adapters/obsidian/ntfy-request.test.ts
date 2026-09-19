import { describe, expect, it } from "vitest";

import { fromJsDateTime } from "@/domain/dates";
import type { IsoDateTime } from "@/domain/dates";
import {
	buildCancelRequest,
	buildNtfyRequest,
	buildPollRequest,
	clickUrlFor,
	encodeHeaderValue,
	normalizeServerUrl,
	parseKnownReminders,
	serverUrlError,
} from "@/adapters/obsidian/ntfy-request";
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
		lookaheadHours: 72,
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

describe("buildNtfyRequest X-Sequence-ID header", () => {
	it("sets it to the message id when there is no delayUntil", () => {
		const request = buildNtfyRequest(config(), message({ id: "isotask-abc123" as ReminderId }), "obsidian://x");
		expect(request.headers["X-Sequence-ID"]).toBe("isotask-abc123");
	});

	it("sets it to the message id when there is a delayUntil", () => {
		const request = buildNtfyRequest(config(), message({ id: "isotask-abc123" as ReminderId }), "obsidian://x", {
			delayUntil: "2026-09-18T10:00:00" as IsoDateTime,
		});
		expect(request.headers["X-Sequence-ID"]).toBe("isotask-abc123");
	});
});

describe("buildCancelRequest", () => {
	it("builds a DELETE to the topic/id path with auth headers only", () => {
		const request = buildCancelRequest(config({ token: "tk_abc" }), "isotask-abc123" as ReminderId);
		expect(request.method).toBe("DELETE");
		expect(request.url).toBe("https://ntfy.sh/my-topic/isotask-abc123");
		expect(request.headers).toEqual({ Authorization: "Bearer tk_abc" });
	});

	it("encodes topic and id", () => {
		const request = buildCancelRequest(config({ topic: "my topic" }), "isotask-a/b" as ReminderId);
		expect(request.url).toBe(`https://ntfy.sh/${encodeURIComponent("my topic")}/${encodeURIComponent("isotask-a/b")}`);
	});
});

describe("buildPollRequest", () => {
	it("builds a GET with poll/sched/since query params and auth headers", () => {
		const request = buildPollRequest(config({ token: "tk_abc" }), 3600);
		expect(request.method).toBe("GET");
		expect(request.url).toBe("https://ntfy.sh/my-topic/json?poll=1&sched=1&since=3600s");
		expect(request.headers).toEqual({ Authorization: "Bearer tk_abc" });
	});

	it("floors fractional seconds", () => {
		const request = buildPollRequest(config(), 3600.7);
		expect(request.url).toContain("since=3600s");
	});

	it("floors non-positive input to 1 second", () => {
		expect(buildPollRequest(config(), 0).url).toContain("since=1s");
		expect(buildPollRequest(config(), -5).url).toContain("since=1s");
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

describe("parseKnownReminders", () => {
	it("keeps only isotask entries from a mixed ndjson sample, with the right `at`", () => {
		const heldTime = Math.floor(Date.now() / 1000) + 3600;
		const deliveredTime = Math.floor(Date.now() / 1000) - 60;
		const ndjson = [
			JSON.stringify({ id: "a", sequence_id: "isotask-one", time: heldTime }),
			JSON.stringify({ id: "b", sequence_id: "isotask-two", time: deliveredTime }),
			JSON.stringify({ id: "c", sequence_id: "other-app-three", time: heldTime }),
			JSON.stringify({ id: "d" }),
			"not json",
			"",
		].join("\n");

		expect(parseKnownReminders(ndjson)).toEqual([
			{ id: "isotask-one", at: fromJsDateTime(new Date(heldTime * 1000)) },
			{ id: "isotask-two", at: fromJsDateTime(new Date(deliveredTime * 1000)) },
		]);
	});
});
