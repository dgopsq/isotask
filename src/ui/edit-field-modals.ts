import type { App } from "obsidian";

import type { AppError } from "@/app/errors";
import { describeAppError } from "@/app/errors";
import type { DateField, makeSetDate } from "@/app/set-date";
import type { makeSetDuration } from "@/app/set-duration";
import type { makeSetProject } from "@/app/set-project";
import type { makeSetRecurrence } from "@/app/set-recurrence";
import type { SetReminder } from "@/app/set-reminder";
import type { makeSetTags } from "@/app/set-tags";
import type { ReminderDefaults } from "@/domain/reminders";
import { reminderAnchor } from "@/domain/reminders";
import { fromNullable } from "@/domain/result";
import type { Result } from "@/domain/result";
import type { Task } from "@/domain/task";
import type { Notifier } from "@/ports/notifier";
import { DateModal } from "@/ui/date-modal";
import { DurationModal } from "@/ui/duration-modal";
import { ProjectModal } from "@/ui/project-modal";
import { RecurrenceModal } from "@/ui/recurrence-modal";
import { ReminderModal } from "@/ui/reminder-modal";
import { TagsModal } from "@/ui/tags-modal";

/**
 * Reports a use-case's error result via `notifier` — same shape every
 * caller of these helpers otherwise duplicated locally
 * (`commands/register-commands.ts`, `ui/task-edit-menu.ts`).
 */
function report(notifier: Notifier, result: Result<unknown, AppError>): void {
	if (!result.ok) {
		notifier.error(describeAppError(result.error));
	}
}

/**
 * "Read the current task, seed a modal from it, dispatch the matching
 * use-case on save" — the shape every editable-field surface repeats for
 * due/scheduled, duration, repeat, project and tags. Pulled out once shared
 * by three call sites (`commands/register-commands.ts`'s command-palette
 * commands, and the sidebar task panel, `views/task-panel/task-panel-view.ts`)
 * so a fourth didn't duplicate it again. `ui/task-edit-menu.ts` (the
 * file/editor-menu and feed-row context menu) and the feed's date chip stay
 * as they were — they build a `Menu`/chip around the same modals rather than
 * a bare button, so folding them in here would cost more than it saves.
 */
export function openDateModalFor(app: App, task: Task, field: DateField, setDate: ReturnType<typeof makeSetDate>, notifier: Notifier): void {
	new DateModal(app, {
		title: field === "due" ? "Set due date" : "Set scheduled date",
		initial: fromNullable(field === "due" ? task.due : task.scheduled),
		onSave: async (value) => {
			report(notifier, await setDate(task.path, field, value));
		},
	}).open();
}

export function openDurationModalFor(app: App, task: Task, setDuration: ReturnType<typeof makeSetDuration>, notifier: Notifier): void {
	new DurationModal(app, {
		initial: fromNullable(task.duration),
		onSave: async (value) => {
			report(notifier, await setDuration(task.path, value));
		},
	}).open();
}

export function openRecurrenceModalFor(app: App, task: Task, setRecurrence: ReturnType<typeof makeSetRecurrence>, notifier: Notifier): void {
	new RecurrenceModal(app, {
		initial: fromNullable(task.repeat),
		onSave: async (rule) => {
			report(notifier, await setRecurrence(task.path, rule));
		},
	}).open();
}

export function openReminderModalFor(
	app: App,
	task: Task,
	setReminder: SetReminder,
	getReminderDefaults: () => ReminderDefaults,
	notifier: Notifier,
): void {
	new ReminderModal(app, {
		initial: task.remind,
		anchor: reminderAnchor(task)?.at,
		defaults: getReminderDefaults(),
		onSave: async (specs) => {
			report(notifier, await setReminder(task.path, specs));
		},
	}).open();
}

export function openProjectModalFor(app: App, task: Task, setProject: ReturnType<typeof makeSetProject>, notifier: Notifier): void {
	new ProjectModal(app, {
		initial: task.project ?? null,
		onSave: async (project) => {
			report(notifier, await setProject(task.path, project));
		},
	}).open();
}

export function openTagsModalFor(app: App, task: Task, setTags: ReturnType<typeof makeSetTags>, notifier: Notifier): void {
	new TagsModal(app, {
		initial: task.tags,
		onSave: async (tags) => {
			report(notifier, await setTags(task.path, tags));
		},
	}).open();
}
