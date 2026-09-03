import type {Severity} from "../../../domain/review/model/severity.js";
import {
    type ReviewExecutionResult,
    type RunReviewRangeDependencies,
    runReviewRangeUseCase,
} from "./run-review-range-use-case.js";

/** GitHub 等 PR 触发评审需要的外部能力。 */
export type RunPullRequestReviewDependencies = RunReviewRangeDependencies;

/** GitHub 等 PR 触发评审的已提交范围与质量门禁输入。 */
export interface RunPullRequestReviewCommand {
    baseSha: string;
    headSha: string;
    failOn: readonly Severity[];
}

/**
 * 编排 PR 评审：获取 `baseSha...headSha` 变更后执行平台无关的 AI 评审。
 */
export const runPullRequestReviewUseCase = async (
    command: RunPullRequestReviewCommand,
    dependencies: RunPullRequestReviewDependencies,
): Promise<ReviewExecutionResult> => runReviewRangeUseCase({
    range: {
        baseRef: command.baseSha,
        headRef: command.headSha,
        comparison: "three-dot",
    },
    failOn: command.failOn,
}, dependencies);
