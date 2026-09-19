import type { IsoDateTime } from "@/domain/dates";
import type { KnownReminder, PushMessage } from "@/domain/reminder-plan";
import type { ReminderId } from "@/domain/reminders";
import type { Result } from "@/domain/result";

export type PushError =
	| { readonly kind: "network"; readonly message: string }
	| { readonly kind: "auth" }
	| { readonly kind: "server"; readonly status: number; readonly message: string }
	| { readonly kind: "unsupported"; readonly message: string };

export interface PushPublishOptions {
	/** Ask the server to hold the message until this local datetime; omitted = deliver now. */
	readonly delayUntil?: IsoDateTime;
}

export interface PushListOptions {
	/** How far back (seconds) the server is asked for delivered messages; held ones are always returned. */
	readonly sinceSeconds: number;
}

/** Push delivery for reminders. Implemented by `adapters/obsidian/ntfy-channel.ts`. */
export interface PushChannel {
	/** Publishes under `message.id` as the sequence id, so a later publish with the same id replaces. */
	readonly publish: (message: PushMessage, options?: PushPublishOptions) => Promise<Result<void, PushError>>;
	readonly cancel: (id: ReminderId) => Promise<Result<void, PushError>>;
	readonly listKnown: (options: PushListOptions) => Promise<Result<readonly KnownReminder[], PushError>>;
}
