import type {Severity} from "../../../domain/review/model/severity.js";
import {
    type ReviewExecutionResult,
    type RunReviewRangeDependencies,
    runReviewRangeUseCase,
} from "./run-review-range-use-case.js";

/**
 * 手动评审用例所需的外部能力。
 */
export type RunManualReviewDependencies = RunReviewRangeDependencies;

/**
 * 执行一次手动评审所需的输入。
 */
export interface RunManualReviewCommand {
    target: string;
    failOn: readonly Severity[];
}

/**
 * 手动评审用例的完整执行结果。
 */
export type ManualReviewResult = ReviewExecutionResult;

/**
 * 手动评审的兼容包装；实际范围编排由平台无关用例完成。
 */
export const runManualReviewUseCase = async (
    command: RunManualReviewCommand,
    dependencies: RunManualReviewDependencies,
): Promise<ManualReviewResult> => runReviewRangeUseCase({
    range: {
        baseRef: command.target,
        headRef: "HEAD",
        comparison: "three-dot",
    },
    failOn: command.failOn,
}, dependencies);
