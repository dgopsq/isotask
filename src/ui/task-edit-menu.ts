import type { App, Menu } from "obsidian";

import type { AppError } from "@/app/errors";
import { describeAppError } from "@/app/errors";
import type { makeSetDate } from "@/app/set-date";
import type { makeSetDuration } from "@/app/set-duration";
import type { makeSetPriority } from "@/app/set-priority";
import type { makeSetProject } from "@/app/set-project";
import type { makeSetRecurrence } from "@/app/set-recurrence";
import type { makeSetStatus } from "@/app/set-status";
import type { makeSetTags } from "@/app/set-tags";
import { fromNullable } from "@/domain/result";
import type { Result } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import type { Task } from "@/domain/task";
import type { Notifier } from "@/ports/notifier";
import { DateModal } from "@/ui/date-modal";
import { DurationModal } from "@/ui/duration-modal";
import { buildPriorityMenu } from "@/ui/priority-menu";
import { ProjectModal } from "@/ui/project-modal";
import { RecurrenceModal } from "@/ui/recurrence-modal";
import { buildStatusMenu } from "@/ui/status-menu";
import { TagsModal } from "@/ui/tags-modal";

export interface TaskEditMenuCtx {
	readonly app: App;
	readonly statuses: readonly StatusConfig[];
	readonly setStatus: ReturnType<typeof makeSetStatus>;
	readonly setPriority: ReturnType<typeof makeSetPriority>;
	readonly setDate: ReturnType<typeof makeSetDate>;
	readonly setDuration: ReturnType<typeof makeSetDuration>;
	readonly setRecurrence: ReturnType<typeof makeSetRecurrence>;
	readonly setProject: ReturnType<typeof makeSetProject>;
	readonly setTags: ReturnType<typeof makeSetTags>;
	readonly notifier: Notifier;
}

function report(notifier: Notifier, result: Result<unknown, AppError>): void {
	if (!result.ok) {
		notifier.error(describeAppError(result.error));
	}
}

/**
 * Adds every editable task property to `menu`, one item/section per
 * property: Status and Priority as flat sections (a label item + one entry
 * per option — verified against the bundled `obsidian.d.ts`: this Obsidian
 * version's `MenuItem` has no `setSubmenu`/submenu API at all, not just on
 * mobile, so a nested submenu isn't an option), then
 * Due/Scheduled/Duration/Repeat/Project/Tags, each opening its modal and
 * dispatching the matching `app` use-case. Shared by the feed row's context
 * menu (`views/bases/feed/feed-view.ts`) and the file/editor menu
 * (`adapters/obsidian/menus.ts`).
 */
export function buildTaskEditMenu(menu: Menu, task: Task, ctx: TaskEditMenuCtx): void {
	menu.addItem((item) => item.setTitle("Status").setIsLabel(true));
	buildStatusMenu(menu, ctx.statuses, task.status, (status) => {
		void ctx.setStatus(task.path, status.id).then((result) => {
			report(ctx.notifier, result);
		});
	});

	menu.addSeparator();
	menu.addItem((item) => item.setTitle("Priority").setIsLabel(true));
	buildPriorityMenu(menu, task.priority, (priority) => {
		void ctx.setPriority(task.path, priority).then((result) => {
			report(ctx.notifier, result);
		});
	});

	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle("Due…")
			.setIcon("calendar")
			.onClick(() => {
				new DateModal(ctx.app, {
					title: "Set due date",
					initial: fromNullable(task.due),
					onSave: async (value) => {
						report(ctx.notifier, await ctx.setDate(task.path, "due", value));
					},
				}).open();
			}),
	);

	menu.addItem((item) =>
		item
			.setTitle("Scheduled…")
			.setIcon("calendar-clock")
			.onClick(() => {
				new DateModal(ctx.app, {
					title: "Set scheduled date",
					initial: fromNullable(task.scheduled),
					onSave: async (value) => {
						report(ctx.notifier, await ctx.setDate(task.path, "scheduled", value));
					},
				}).open();
			}),
	);

	menu.addItem((item) =>
		item
			.setTitle("Duration…")
			.setIcon("timer")
			.onClick(() => {
				new DurationModal(ctx.app, {
					initial: fromNullable(task.duration),
					onSave: async (value) => {
						report(ctx.notifier, await ctx.setDuration(task.path, value));
					},
				}).open();
			}),
	);

	menu.addItem((item) =>
		item
			.setTitle("Repeat…")
			.setIcon("repeat")
			.onClick(() => {
				new RecurrenceModal(ctx.app, {
					initial: fromNullable(task.repeat),
					onSave: async (rule) => {
						report(ctx.notifier, await ctx.setRecurrence(task.path, rule));
					},
				}).open();
			}),
	);

	menu.addItem((item) =>
		item
			.setTitle("Project…")
			.setIcon("folder")
			.onClick(() => {
				new ProjectModal(ctx.app, {
					initial: task.project ?? null,
					onSave: async (project) => {
						report(ctx.notifier, await ctx.setProject(task.path, project));
					},
				}).open();
			}),
	);

	menu.addItem((item) =>
		item
			.setTitle("Tags…")
			.setIcon("tag")
			.onClick(() => {
				new TagsModal(ctx.app, {
					initial: task.tags,
					onSave: async (tags) => {
						report(ctx.notifier, await ctx.setTags(task.path, tags));
					},
				}).open();
			}),
	);
}
