import type { DiffProvider } from "../ports/diff-provider.js";
import type { ReviewChangeInput } from "../../../domain/review/model/code-change.js";
import { resolveManualCodeChange } from "./resolve-manual-code-change.js";
import type { Severity } from "../../../domain/review/model/severity.js";
import {
    DiffResolutionError,
} from "../errors/review-execution-error.js";
import {
    reviewCodeChangeUseCase,
    type ReviewCodeChangeDependencies,
    type ReviewExecutionResult,
} from "./review-code-change-use-case.js";

/**
 * 手动评审用例所需的外部能力。
 */
export interface RunManualReviewDependencies extends ReviewCodeChangeDependencies {
    diffProvider: DiffProvider;
}

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
 * 编排手动评审：读取受控原始/安全 diff、调用分析器、应用质量门禁。
 */
export const runManualReviewUseCase = async (
    command: RunManualReviewCommand,
    dependencies: RunManualReviewDependencies,
): Promise<ManualReviewResult> => {
    let reviewInput: ReviewChangeInput;
    try {
        reviewInput = await resolveManualCodeChange(
            dependencies.diffProvider,
            command.target,
        );
    } catch (error) {
        throw new DiffResolutionError(error);
    }

    return reviewCodeChangeUseCase({
        reviewInput,
        failOn: command.failOn,
    }, dependencies);
};
