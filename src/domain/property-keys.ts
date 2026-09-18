/**
 * Frontmatter property-key mapping: the marker key/value that identifies a
 * task note, plus every other property key. All configurable in settings;
 * this record holds whatever the user (or the defaults) chose.
 */
export interface PropertyKeys {
	readonly markerKey: string;
	readonly markerValue: string;
	readonly status: string;
	readonly priority: string;
	readonly due: string;
	readonly scheduled: string;
	readonly duration: string;
	readonly repeat: string;
	readonly project: string;
	readonly tags: string;
	readonly created: string;
	readonly completed: string;
	readonly remind: string;
}

export const DEFAULT_PROPERTY_KEYS: PropertyKeys = {
	markerKey: "type",
	markerValue: "task",
	status: "status",
	priority: "priority",
	due: "due",
	scheduled: "scheduled",
	duration: "duration",
	repeat: "repeat",
	project: "project",
	tags: "tags",
	created: "created",
	completed: "completed",
	remind: "remind",
};
