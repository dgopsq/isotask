import type { IsoDateTime } from "@/domain/dates";
import type { PushMessage } from "@/domain/reminder-plan";
import type { ReminderId } from "@/domain/reminders";
import type { Result } from "@/domain/result";

export type PushError =
	| { readonly kind: "network"; readonly message: string }
	| { readonly kind: "auth" }
	| { readonly kind: "server"; readonly status: number; readonly message: string }
	| { readonly kind: "unsupported"; readonly message: string };

export interface PushPublishOptions {
	/** Tier 2: ask the server to hold the message until this local datetime. */
	readonly delayUntil?: IsoDateTime;
	/** Tier 3 (ntfy ≥ 2.16): a later publish with the same id replaces, `cancel` deletes. */
	readonly sequenceId?: string;
}

/** Push delivery for reminders. Implemented by `adapters/obsidian/ntfy-channel.ts`. */
export interface PushChannel {
	readonly publish: (message: PushMessage, options?: PushPublishOptions) => Promise<Result<void, PushError>>;
	readonly cancel: (id: ReminderId) => Promise<Result<void, PushError>>;
	/** Ids of reminders the server still holds; `[]` when it keeps no cache. */
	readonly listScheduled: () => Promise<Result<readonly ReminderId[], PushError>>;
}
