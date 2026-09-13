import type { AppDeps } from "@/app/deps";
import { storeError, unknownStatusError } from "@/app/errors";
import type { AppError } from "@/app/errors";
import { joinTaskPath, splitTaskPath } from "@/app/paths";
import type { FrontmatterValue } from "@/domain/frontmatter";
import type { Option, Result } from "@/domain/result";
import { err, none, ok, some } from "@/domain/result";
import type { StatusConfig } from "@/domain/status";
import { findStatus } from "@/domain/status";
import { applyStatusChange } from "@/domain/transitions";
import type { StatusId, Task, TaskPath } from "@/domain/task";

export interface SetStatusOutcome {
	/** The spawned next occurrence's path, if a `done`-kind status transition triggered recurrence spawning. */
	readonly spawned: Option<TaskPath>;
}

export interface WriteStatusTransitionInput {
	readonly path: TaskPath;
	readonly task: Task;
	readonly raw: Readonly<Record<string, FrontmatterValue>>;
	readonly to: StatusConfig;
	/** Forwarded to `applyStatusChange` — see its own doc for why `app/reconcile-completion.ts` needs this. */
	readonly force?: boolean;
}

/**
 * Computes the patch (and optional spawn plan) for a status transition via
 * `domain/transitions.ts`, writes the patch, then — if the transition
 * spawned a next occurrence — creates it unless a note already exists at
 * the spawn path (idempotent, per `docs/DOMAIN-MODEL.md#recurrence-semantics`).
 * Shared by `makeSetStatus` below and `app/reconcile-completion.ts`'s
 * external-edit path, so the spawn/idempotency logic exists in one place.
 */
export function makeWriteStatusTransition(deps: AppDeps) {
	return async (input: WriteStatusTransitionInput): Promise<Result<SetStatusOutcome, AppError>> => {
		const settings = deps.settings();
		const { folder, basename } = splitTaskPath(input.path);

		const { patch, spawn } = applyStatusChange({
			task: input.task,
			raw: input.raw,
			basename,
			to: input.to,
			statuses: settings.statuses,
			keys: settings.propertyKeys,
			now: deps.clock.now(),
			spawnTemplate: settings.spawnFilenameTemplate,
			...(input.force !== undefined ? { force: input.force } : {}),
		});

		const updateResult = await deps.store.updateProperties(input.path, patch);
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

		const bodyResult = await deps.store.readBody(input.path);
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

/**
 * Sets a task's status: reads the task and its raw frontmatter, resolves
 * the target `StatusConfig`, then delegates to `makeWriteStatusTransition`.
 */
export function makeSetStatus(deps: AppDeps) {
	const writeStatusTransition = makeWriteStatusTransition(deps);

	return async (path: TaskPath, statusId: StatusId): Promise<Result<SetStatusOutcome, AppError>> => {
		const taskResult = await deps.store.read(path);
		if (!taskResult.ok) {
			return err(storeError(taskResult.error));
		}
		const rawResult = await deps.store.rawFrontmatter(path);
		if (!rawResult.ok) {
			return err(storeError(rawResult.error));
		}

		const toStatus = findStatus(deps.settings().statuses, statusId);
		if (!toStatus.some) {
			return err(unknownStatusError(statusId));
		}

		return writeStatusTransition({ path, task: taskResult.value, raw: rawResult.value, to: toStatus.value });
	};
}

export type SetStatus = ReturnType<typeof makeSetStatus>;
