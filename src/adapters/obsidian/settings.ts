import * as v from "valibot";

import type { Weekday } from "@/domain/dates";
import { DEFAULT_PROPERTY_KEYS } from "@/domain/property-keys";
import type { PropertyKeys } from "@/domain/property-keys";

export interface ObtaskSettings {
	readonly version: 1;
	readonly taskFolder: string;
	readonly propertyKeys: PropertyKeys;
	readonly weekStart: Weekday;
}

export const DEFAULT_SETTINGS: ObtaskSettings = {
	version: 1,
	taskFolder: "Tasks",
	propertyKeys: DEFAULT_PROPERTY_KEYS,
	weekStart: 0,
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
	}),
	DEFAULT_PROPERTY_KEYS,
);

const WeekdaySchema = v.fallback(v.picklist([0, 1, 2, 3, 4, 5, 6]), DEFAULT_SETTINGS.weekStart);

const SettingsSchema = v.object({
	version: v.fallback(v.literal(1), 1),
	taskFolder: fallbackString(DEFAULT_SETTINGS.taskFolder),
	propertyKeys: PropertyKeysSchema,
	weekStart: WeekdaySchema,
});

/**
 * Parses persisted plugin data into `ObtaskSettings`, falling back to the
 * default for any field that's missing or fails validation — so a corrupt
 * or hand-edited `data.json` never breaks the plugin.
 */
export function parseSettings(raw: unknown): ObtaskSettings {
	if (typeof raw !== "object" || raw === null) {
		return DEFAULT_SETTINGS;
	}
	try {
		return v.parse(SettingsSchema, raw) satisfies ObtaskSettings;
	} catch {
		return DEFAULT_SETTINGS;
	}
}
