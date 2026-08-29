import WDIOReporter from "@wdio/reporter";
import type { RunnerStats, TestStats } from "@wdio/reporter";
import type { Reporters } from "@wdio/types";

interface FailureDetail {
	readonly title: string;
	readonly message: string;
	readonly stack: readonly string[];
}

/**
 * Default reporter for `pnpm test:e2e`. The default output of the "obsidian"
 * spec reporter (full per-test tree, Obsidian/installer banner, timings) is
 * fine for a human watching a terminal, but this suite is most often read by
 * an AI agent that pays per token — so on the success path this prints
 * exactly one line, and on failure it prints only what's needed to act:
 * failing test titles, their error message, and the first few stack lines
 * (not the full spec tree or passing-test noise).
 *
 * Use `pnpm test:e2e:verbose` (sets `E2E_VERBOSE=1`, see `wdio.conf.mts`)
 * for the full spec reporter + wdio/service logging when debugging locally.
 */
export default class QuietReporter extends WDIOReporter {
	private readonly failureDetails: FailureDetail[] = [];

	constructor(options: Partial<Reporters.Options>) {
		super({ ...options, stdout: true });
	}

	override onTestFail(testStats: TestStats): void {
		const error = testStats.errors?.[0] ?? testStats.error;
		const stack = (error?.stack ?? "").split("\n").slice(0, 5);
		this.failureDetails.push({
			title: testStats.fullTitle,
			message: error?.message ?? "(no error message)",
			stack,
		});
	}

	override onRunnerEnd(runnerStats: RunnerStats): void {
		const seconds = (runnerStats.duration / 1000).toFixed(1);
		const { passes, failures, skipping } = this.counts;

		if (failures === 0) {
			this.write(`e2e: ${String(passes)} passed in ${seconds}s\n`);
			return;
		}

		this.write(
			`e2e: ${String(failures)} failed, ${String(passes)} passed, ${String(skipping)} skipped in ${seconds}s\n\n`,
		);
		for (const failure of this.failureDetails) {
			this.write(`✗ ${failure.title}\n  ${failure.message}\n`);
			for (const line of failure.stack) {
				this.write(`  ${line}\n`);
			}
			this.write("\n");
		}
	}
}
