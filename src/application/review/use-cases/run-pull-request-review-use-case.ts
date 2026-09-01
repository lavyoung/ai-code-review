import type { DiffProvider } from "../ports/diff-provider.js";
import type { AiReviewPort } from "../ports/ai-review-port.js";
import type { Severity } from "../../../domain/review/model/severity.js";
import { resolvePullRequestCodeChange } from "./resolve-pull-request-code-change.js";
import {
    reviewCodeChangeUseCase,
    type ReviewExecutionResult,
} from "./review-code-change-use-case.js";
import {
    AiReviewExecutionError,
    DiffResolutionError,
} from "../errors/review-execution-error.js";

/** GitHub 等 PR 触发评审需要的外部能力。 */
export interface RunPullRequestReviewDependencies {
    diffProvider: DiffProvider;
    aiReviewPort: AiReviewPort;
}

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
): Promise<ReviewExecutionResult> => {
    try {
        const codeChange = await resolvePullRequestCodeChange(
            dependencies.diffProvider,
            command,
        );

        return reviewCodeChangeUseCase({
            codeChange,
            failOn: command.failOn,
        }, dependencies);
    } catch (error) {
        if (error instanceof DiffResolutionError) {
            throw error;
        }

        if (error instanceof AiReviewExecutionError) {
            throw error;
        }

        throw new DiffResolutionError(error);
    }
};
