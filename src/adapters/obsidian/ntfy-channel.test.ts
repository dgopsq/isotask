import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => ({
	requestUrl: vi.fn(),
}));

import { requestUrl } from "obsidian";
import type { RequestUrlResponse, RequestUrlParam } from "obsidian";

import { createNtfyChannel } from "@/adapters/obsidian/ntfy-channel";
import type { IsoDateTime } from "@/domain/dates";
import type { ReminderId } from "@/domain/reminders";
import type { NtfySettings } from "@/domain/settings";
import type { PushMessage } from "@/domain/reminder-plan";
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
		id: "isotask-abc" as ReminderId,
		path: "Tasks/Foo.md" as TaskPath,
		at: "2026-09-18T09:00:00" as IsoDateTime,
		title: "Buy milk",
		body: "Due today 09:00",
		priority: 3,
		tags: [],
		...overrides,
	};
}

function response(status: number, text: string): RequestUrlResponse {
	return {
		status,
		text,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		json: {},
	};
}

function lastRequest(): RequestUrlParam {
	const first = vi.mocked(requestUrl).mock.calls[0]?.[0];
	if (first === undefined || typeof first === "string") {
		throw new Error("expected a RequestUrlParam");
	}
	return first;
}

describe("createNtfyChannel", () => {
	beforeEach(() => {
		vi.mocked(requestUrl).mockReset();
	});

	describe("cancel", () => {
		it("returns ok on 200", async () => {
			vi.mocked(requestUrl).mockResolvedValueOnce(response(200, ""));

			const channel = createNtfyChannel({
				getConfig: () => config(),
				getVaultName: () => "My Vault",
			});

			const result = await channel.cancel("isotask-abc" as ReminderId);

			expect(result).toEqual({ ok: true, value: undefined });
		});

		it("passes DELETE method and correct URL", async () => {
			vi.mocked(requestUrl).mockResolvedValueOnce(response(200, ""));

			const channel = createNtfyChannel({
				getConfig: () => config(),
				getVaultName: () => "My Vault",
			});

			await channel.cancel("isotask-abc" as ReminderId);

			const call = lastRequest();
			expect(call.method).toBe("DELETE");
			expect(call.url).toContain("/my-topic/isotask-abc");
		});

		it("returns ok on 404 (already delivered or never held)", async () => {
			vi.mocked(requestUrl).mockResolvedValueOnce(response(404, ""));

			const channel = createNtfyChannel({
				getConfig: () => config(),
				getVaultName: () => "My Vault",
			});

			const result = await channel.cancel("isotask-abc" as ReminderId);

			expect(result).toEqual({ ok: true, value: undefined });
		});

		it("returns server error on 500 with status and message", async () => {
			vi.mocked(requestUrl).mockResolvedValueOnce(response(500, "boom"));

			const channel = createNtfyChannel({
				getConfig: () => config(),
				getVaultName: () => "My Vault",
			});

			const result = await channel.cancel("isotask-abc" as ReminderId);

			expect(result).toEqual({
				ok: false,
				error: { kind: "server", status: 500, message: "boom" },
			});
		});

		it("returns auth error on 401", async () => {
			vi.mocked(requestUrl).mockResolvedValueOnce(response(401, "unauthorized"));

			const channel = createNtfyChannel({
				getConfig: () => config(),
				getVaultName: () => "My Vault",
			});

			const result = await channel.cancel("isotask-abc" as ReminderId);

			expect(result).toEqual({ ok: false, error: { kind: "auth" } });
		});

		it("returns network error when requestUrl throws", async () => {
			vi.mocked(requestUrl).mockRejectedValueOnce(new Error("Network timeout"));

			const channel = createNtfyChannel({
				getConfig: () => config(),
				getVaultName: () => "My Vault",
			});

			const result = await channel.cancel("isotask-abc" as ReminderId);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("network");
			}
		});
	});

	describe("publish", () => {
		it("includes X-Sequence-ID header without Delay when no delayUntil", async () => {
			vi.mocked(requestUrl).mockResolvedValueOnce(response(200, ""));

			const channel = createNtfyChannel({
				getConfig: () => config(),
				getVaultName: () => "My Vault",
			});

			await channel.publish(message({ id: "isotask-123" as ReminderId }));

			const call = lastRequest();
			const headers = call.headers as Record<string, string | undefined>;
			expect(headers["X-Sequence-ID"]).toBe("isotask-123");
			expect(headers["Delay"]).toBeUndefined();
		});

		it("includes Delay header when delayUntil is provided", async () => {
			vi.mocked(requestUrl).mockResolvedValueOnce(response(200, ""));

			const channel = createNtfyChannel({
				getConfig: () => config(),
				getVaultName: () => "My Vault",
			});

			const delayUntil = "2026-09-18T10:00:00" as IsoDateTime;
			await channel.publish(message(), { delayUntil });

			const call = lastRequest();
			const headers = call.headers as Record<string, string | undefined>;
			expect(headers["Delay"]).toBeDefined();
		});

		it("returns unsupported error with empty topic and does not call requestUrl", async () => {
			const channel = createNtfyChannel({
				getConfig: () => config({ topic: "" }),
				getVaultName: () => "My Vault",
			});

			const result = await channel.publish(message());

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("unsupported");
				if (result.error.kind === "unsupported") {
					expect(typeof result.error.message).toBe("string");
				}
			}
			expect(vi.mocked(requestUrl)).not.toHaveBeenCalled();
		});
	});

	describe("listKnown", () => {
		it("builds GET request with poll, sched, and since query params", async () => {
			const now = Math.floor(Date.now() / 1000);
			const ndjson = JSON.stringify({ sequence_id: "isotask-1", time: now });
			vi.mocked(requestUrl).mockResolvedValueOnce(response(200, ndjson));

			const channel = createNtfyChannel({
				getConfig: () => config(),
				getVaultName: () => "My Vault",
			});

			await channel.listKnown({ sinceSeconds: 3600 });

			const call = lastRequest();
			expect(call.method).toBe("GET");
			expect(call.url).toContain("json?poll=1&sched=1&since=3600s");
		});

		it("returns array with exactly one entry from mixed ndjson", async () => {
			const now = Math.floor(Date.now() / 1000);
			const ndjson = [
				JSON.stringify({ sequence_id: "isotask-1", time: now }),
				JSON.stringify({ sequence_id: "foreign-id", time: now }),
			].join("\n");

			vi.mocked(requestUrl).mockResolvedValueOnce(response(200, ndjson));

			const channel = createNtfyChannel({
				getConfig: () => config(),
				getVaultName: () => "My Vault",
			});

			const result = await channel.listKnown({ sinceSeconds: 3600 });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(1);
				expect(result.value[0]?.id).toBe("isotask-1");
			}
		});

		it("returns empty array with empty topic and does not call requestUrl", async () => {
			const channel = createNtfyChannel({
				getConfig: () => config({ topic: "" }),
				getVaultName: () => "My Vault",
			});

			const result = await channel.listKnown({ sinceSeconds: 3600 });

			expect(result).toEqual({ ok: true, value: [] });
			expect(vi.mocked(requestUrl)).not.toHaveBeenCalled();
		});
	});
});
