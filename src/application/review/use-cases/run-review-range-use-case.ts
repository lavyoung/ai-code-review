import type {Severity} from "../../../domain/review/model/severity.js";
import type {DiffProvider, DiffRange} from "../ports/diff-provider.js";
import {createReviewChangeInput} from "../changes/create-sanitized-code-change.js";
import {
    type ReviewCodeChangeDependencies,
    reviewCodeChangeUseCase,
    type ReviewExecutionResult,
} from "./review-code-change-use-case.js";
import {AiReviewExecutionError, DiffResolutionError} from "../errors/review-execution-error.js";

export type {ReviewExecutionResult} from "./review-code-change-use-case.js";

/** 统一处理已验证提交范围所需的外部依赖。 */
export interface RunReviewRangeDependencies extends ReviewCodeChangeDependencies {
    diffProvider: DiffProvider;
}

/** 统一处理已验证提交范围的输入。 */
export interface RunReviewRangeCommand {
    range: DiffRange;
    failOn: readonly Severity[];
}

/**
 * 对已解析的 Git 范围执行统一代码评审。
 *
 * Trigger Adapter 决定范围来源与 two-dot/three-dot 语义；本用例不感知
 * GitHub、CodeUp、GitLab 或本地手动触发方式。
 */
export const runReviewRangeUseCase = async (
    command: RunReviewRangeCommand,
    dependencies: RunReviewRangeDependencies,
): Promise<ReviewExecutionResult> => {
    try {
        const rawCodeChange = await dependencies.diffProvider.getRawCodeChange(command.range);
        return reviewCodeChangeUseCase({
            reviewInput: createReviewChangeInput(rawCodeChange),
            failOn: command.failOn,
        }, dependencies);
    } catch (error) {
        if (error instanceof DiffResolutionError || error instanceof AiReviewExecutionError) {
            throw error;
        }
        throw new DiffResolutionError(error);
    }
};
