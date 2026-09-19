import { describe, expect, it } from "vitest";

import { NTFY_CHECK_ID, makeCheckNtfyCapability } from "@/app/check-ntfy-capability";
import { FakeClock, FakePushChannel } from "@/app/test/fakes";
import type { IsoDate, IsoDateTime } from "@/domain/dates";

function clock(): FakeClock {
	return new FakeClock("2026-09-19T10:00" as IsoDateTime, "2026-09-19" as IsoDate);
}

describe("makeCheckNtfyCapability", () => {
	it("returns ready when the server echoes the check id, and cancels it", async () => {
		const channel = new FakePushChannel();
		const check = makeCheckNtfyCapability({ channel, clock: clock() });

		channel.known.push({ id: NTFY_CHECK_ID, at: "2026-09-19T10:01" as IsoDateTime });
		const result = await check();

		expect(result).toEqual({ ok: true, value: "ready" });
		expect(channel.cancelCalls).toEqual([NTFY_CHECK_ID]);
	});

	it("returns too-old when the check id isn't echoed back", async () => {
		const channel = new FakePushChannel();
		const check = makeCheckNtfyCapability({ channel, clock: clock() });

		const result = await check();

		expect(result).toEqual({ ok: true, value: "too-old" });
		expect(channel.cancelCalls).toEqual([NTFY_CHECK_ID]);
	});

	it("propagates a publish error", async () => {
		const channel = new FakePushChannel();
		channel.failNext({ kind: "auth" });
		const check = makeCheckNtfyCapability({ channel, clock: clock() });

		const result = await check();

		expect(result).toEqual({ ok: false, error: { kind: "auth" } });
		expect(channel.cancelCalls).toEqual([]);
	});

	it("propagates a listKnown error", async () => {
		const channel = new FakePushChannel();
		channel.failListWith({ kind: "network", message: "boom" });
		const check = makeCheckNtfyCapability({ channel, clock: clock() });

		const result = await check();

		expect(result).toEqual({ ok: false, error: { kind: "network", message: "boom" } });
		expect(channel.cancelCalls).toEqual([]);
	});
});
