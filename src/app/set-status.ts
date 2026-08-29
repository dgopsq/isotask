import type { AppDeps } from "@/app/deps";
import { storeError, unknownStatusError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import { joinTaskPath, splitTaskPath } from "@/app/paths";
import type { Option, Result } from "@/domain/result";
import { err, none, ok, some } from "@/domain/result";
import { findStatus } from "@/domain/status";
import { applyStatusChange } from "@/domain/transitions";
import type { StatusId, TaskPath } from "@/domain/task";

export interface SetStatusOutcome {
	/** The spawned next occurrence's path, if a `done`-kind status transition triggered recurrence spawning. */
	readonly spawned: Option<TaskPath>;
}

/**
 * Sets a task's status: reads the task and its raw frontmatter, computes the
 * patch (and optional spawn plan) via `domain/transitions.ts`, writes the
 * patch, then — if the transition spawned a next occurrence — creates it
 * unless a note already exists at the spawn path (idempotent, per
 * `docs/DOMAIN-MODEL.md#recurrence-semantics`).
 */
export function makeSetStatus(deps: AppDeps) {
	return async (path: TaskPath, statusId: StatusId): Promise<Result<SetStatusOutcome, AppError>> => {
		const taskResult = await deps.store.read(path);
		if (!taskResult.ok) {
			return err(storeError(taskResult.error));
		}
		const rawResult = await deps.store.rawFrontmatter(path);
		if (!rawResult.ok) {
			return err(storeError(rawResult.error));
		}

		const settings = deps.settings();
		const toStatus = findStatus(settings.statuses, statusId);
		if (!toStatus.some) {
			return err(unknownStatusError(statusId));
		}

		const { folder, basename } = splitTaskPath(path);

		const { patch, spawn } = applyStatusChange({
			task: taskResult.value,
			raw: rawResult.value,
			basename,
			to: toStatus.value,
			statuses: settings.statuses,
			keys: settings.propertyKeys,
			now: deps.clock.now(),
			spawnTemplate: settings.spawnFilenameTemplate,
		});

		const updateResult = await deps.store.updateProperties(path, patch);
		if (!updateResult.ok) {
			return err(storeError(updateResult.error));
		}

		if (!spawn.some) {
			return ok({ spawned: none() });
		}

		const spawnPath = joinTaskPath(folder, spawn.value.basename);
		const alreadyExists = await deps.store.exists(spawnPath);
		if (alreadyExists) {
			deps.notifier.info(`Next occurrence already exists: ${spawnPath}`);
			return ok({ spawned: none() });
		}

		const bodyResult = await deps.store.readBody(path);
		if (!bodyResult.ok) {
			return err(storeError(bodyResult.error));
		}

		const createResult = await deps.store.create({
			folder,
			basename: spawn.value.basename,
			frontmatter: spawn.value.frontmatter,
			body: bodyResult.value,
		});
		if (!createResult.ok) {
			return err(storeError(createResult.error));
		}

		deps.notifier.info(`Created next occurrence: ${createResult.value}`);
		return ok({ spawned: some(createResult.value) });
	};
}

export type SetStatus = ReturnType<typeof makeSetStatus>;
