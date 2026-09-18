import * as v from "valibot";

import type { Weekday } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import type { PropertyKeys } from "@/domain/property-keys";
import { DEFAULT_STATUSES } from "@/domain/status";
import type { StatusConfig } from "@/domain/status";
import type { StatusId } from "@/domain/task";

export interface IsotaskSettings {
	readonly version: 1;
	readonly taskFolder: string;
	readonly tasksBasePath: string;
	readonly propertyKeys: PropertyKeys;
	readonly statuses: readonly StatusConfig[];
	readonly newTaskFilenameTemplate: string;
	readonly spawnFilenameTemplate: string;
	readonly weekStart: Weekday;
	/**
	 * Set once the sidebar task panel has been auto-opened for the user
	 * (or that first-open opportunity has otherwise been used up — see
	 * `main.ts`'s `onLayoutReady` handler). Never reset, so the panel is
	 * auto-opened at most once per vault, even if the user closes it again.
	 */
	readonly taskPanelIntroduced: boolean;
	readonly hapticsEnabled: boolean;
	readonly reminders: ReminderSettings;
}

export interface NtfySettings {
	readonly enabled: boolean;
	readonly serverUrl: string;
	readonly topic: string;
	readonly token: string;
	/** Tiers 2 and 3 (wave 2b): stored now so the shape is final, no UI yet. */
	readonly scheduleAhead: boolean;
	readonly lookaheadHours: number;
	readonly serverSupportsUpdates: boolean;
}

export interface ReminderSettings {
	readonly remindByDefault: boolean;
	/** "HH:mm", the fire time for a date-only anchor. */
	readonly defaultTime: string;
	/** Reminders missed while the app was closed are replayed at most this far back. */
	readonly catchUpMinutes: number;
	readonly ntfy: NtfySettings;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
	remindByDefault: true,
	defaultTime: "09:00",
	catchUpMinutes: 60,
	ntfy: {
		enabled: false,
		serverUrl: "https://ntfy.sh",
		topic: "",
		token: "",
		scheduleAhead: false,
		lookaheadHours: 24,
		serverSupportsUpdates: false,
	},
};

export const DEFAULT_SETTINGS: IsotaskSettings = {
	version: 1,
	taskFolder: "Tasks",
	tasksBasePath: "Tasks.base",
	propertyKeys: DEFAULT_PROPERTY_KEYS,
	statuses: DEFAULT_STATUSES,
	newTaskFilenameTemplate: "{{title}}",
	spawnFilenameTemplate: "{{title}} {{due}}",
	weekStart: 0,
	taskPanelIntroduced: false,
	hapticsEnabled: true,
	reminders: DEFAULT_REMINDER_SETTINGS,
};

function fallbackString(defaultValue: string) {
	return v.fallback(v.string(), defaultValue);
}

const PropertyKeysSchema = v.fallback(
	v.object({
		markerKey: fallbackString(DEFAULT_PROPERTY_KEYS.markerKey),
		markerValue: fallbackString(DEFAULT_PROPERTY_KEYS.markerValue),
		status: fallbackString(DEFAULT_PROPERTY_KEYS.status),
		priority: fallbackString(DEFAULT_PROPERTY_KEYS.priority),
		due: fallbackString(DEFAULT_PROPERTY_KEYS.due),
		scheduled: fallbackString(DEFAULT_PROPERTY_KEYS.scheduled),
		duration: fallbackString(DEFAULT_PROPERTY_KEYS.duration),
		repeat: fallbackString(DEFAULT_PROPERTY_KEYS.repeat),
		project: fallbackString(DEFAULT_PROPERTY_KEYS.project),
		tags: fallbackString(DEFAULT_PROPERTY_KEYS.tags),
		created: fallbackString(DEFAULT_PROPERTY_KEYS.created),
		completed: fallbackString(DEFAULT_PROPERTY_KEYS.completed),
		remind: fallbackString(DEFAULT_PROPERTY_KEYS.remind),
	}),
	DEFAULT_PROPERTY_KEYS,
);

const STATUS_KINDS = ["open", "done"] as const;

const StatusConfigSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1)),
	label: v.pipe(v.string(), v.minLength(1)),
	kind: v.picklist(STATUS_KINDS),
	icon: v.optional(v.pipe(v.string(), v.minLength(1))),
});

type ParsedStatusConfig = v.InferOutput<typeof StatusConfigSchema>;

function hasUniqueIds(statuses: ParsedStatusConfig[]): boolean {
	return new Set(statuses.map((status) => status.id)).size === statuses.length;
}

function hasRequiredKinds(statuses: ParsedStatusConfig[]): boolean {
	return statuses.some((status) => status.kind === "open") && statuses.some((status) => status.kind === "done");
}

const StatusesSchema = v.fallback(
	v.pipe(
		v.array(StatusConfigSchema),
		v.check(hasUniqueIds, "Status ids must be unique."),
		v.check(hasRequiredKinds, "At least one open and one done status is required."),
	),
	DEFAULT_STATUSES,
);

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const NtfySettingsSchema = v.fallback(
	v.object({
		enabled: v.fallback(v.boolean(), DEFAULT_REMINDER_SETTINGS.ntfy.enabled),
		serverUrl: fallbackString(DEFAULT_REMINDER_SETTINGS.ntfy.serverUrl),
		topic: fallbackString(DEFAULT_REMINDER_SETTINGS.ntfy.topic),
		token: fallbackString(DEFAULT_REMINDER_SETTINGS.ntfy.token),
		scheduleAhead: v.fallback(v.boolean(), DEFAULT_REMINDER_SETTINGS.ntfy.scheduleAhead),
		lookaheadHours: v.fallback(v.pipe(v.number(), v.integer(), v.minValue(1)), DEFAULT_REMINDER_SETTINGS.ntfy.lookaheadHours),
		serverSupportsUpdates: v.fallback(v.boolean(), DEFAULT_REMINDER_SETTINGS.ntfy.serverSupportsUpdates),
	}),
	DEFAULT_REMINDER_SETTINGS.ntfy,
);

const ReminderSettingsSchema = v.fallback(
	v.object({
		remindByDefault: v.fallback(v.boolean(), DEFAULT_REMINDER_SETTINGS.remindByDefault),
		defaultTime: v.fallback(v.pipe(v.string(), v.regex(TIME_OF_DAY_RE)), DEFAULT_REMINDER_SETTINGS.defaultTime),
		catchUpMinutes: v.fallback(v.pipe(v.number(), v.integer(), v.minValue(0)), DEFAULT_REMINDER_SETTINGS.catchUpMinutes),
		ntfy: NtfySettingsSchema,
	}),
	DEFAULT_REMINDER_SETTINGS,
);

const WeekdaySchema = v.fallback(v.picklist([0, 1, 2, 3, 4, 5, 6]), DEFAULT_SETTINGS.weekStart);

const SettingsSchema = v.object({
	version: v.fallback(v.literal(1), 1),
	taskFolder: fallbackString(DEFAULT_SETTINGS.taskFolder),
	tasksBasePath: fallbackString(DEFAULT_SETTINGS.tasksBasePath),
	propertyKeys: PropertyKeysSchema,
	statuses: StatusesSchema,
	newTaskFilenameTemplate: fallbackString(DEFAULT_SETTINGS.newTaskFilenameTemplate),
	spawnFilenameTemplate: fallbackString(DEFAULT_SETTINGS.spawnFilenameTemplate),
	weekStart: WeekdaySchema,
	taskPanelIntroduced: v.fallback(v.boolean(), DEFAULT_SETTINGS.taskPanelIntroduced),
	hapticsEnabled: v.fallback(v.boolean(), DEFAULT_SETTINGS.hapticsEnabled),
	reminders: ReminderSettingsSchema,
});

function toStatusConfig(status: ParsedStatusConfig): StatusConfig {
	return {
		id: status.id as StatusId,
		label: status.label,
		kind: status.kind,
		...(status.icon !== undefined ? { icon: status.icon } : {}),
	};
}

/**
 * Parses persisted plugin data into `IsotaskSettings`, falling back to the
 * default for any field that's missing or fails validation — so a corrupt
 * or hand-edited `data.json` never breaks the plugin. `statuses` falls back
 * as a whole (rather than item-by-item): it must be a non-empty list of
 * status configs with unique ids and at least one `open` and one `done`
 * kind, or the entire list reverts to `DEFAULT_STATUSES`.
 */
export function parseSettings(raw: unknown): IsotaskSettings {
	if (typeof raw !== "object" || raw === null) {
		return DEFAULT_SETTINGS;
	}
	try {
		const parsed = v.parse(SettingsSchema, raw);
		return {
			...parsed,
			statuses: parsed.statuses.map(toStatusConfig),
		} satisfies IsotaskSettings;
	} catch {
		return DEFAULT_SETTINGS;
	}
}
